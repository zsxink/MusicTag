'use strict';
// 幂等 Integrate 节点 runner：按 checkpoint 状态机依次执行
//   archive → commit → sync-main → push → get-or-create-pr → wait-required-ci → merge → verify-remote → cleanup-local
// 每步先查询远端/本地事实再决定是否执行，成功后立即持久化 checkpoint（state.api.setCheckpoint）。
// PR diff 必须同时包含实现、归档规格与 canonical spec 更新；archive 及其提交 MUST 在 PR 之前完成。
// 远端事实（PR 存在、required checks、merged）是权威来源：resume 从下一个未完成 checkpoint 继续，
// 绝不重复创建 PR / 重复等待一轮 CI / 重复 merge。
// 所有外部副作用经可注入 adapter（git 命令 + GitHub adapter）表达，测试用 fake adapter 记录调用并返回确定性事实。

const path = require('node:path');
const fs = require('node:fs');
const { makeRunCommand } = require('./command-adapter.js');
const stateApi = require('./state.js');

// 固定 checkpoint 顺序。
const CHECKPOINTS = [
  'archive',
  'commit',
  'sync-main',
  'push',
  'get-or-create-pr',
  'wait-required-ci',
  'merge',
  'verify-remote',
  'cleanup-local',
];

// ---------- 默认真实 adapter（command + argv） ----------

function makeGitAdapter(execCommand) {
  const out = async (args, root, timeoutMs = 60_000) => {
    const r = await execCommand({ command: 'git', args, cwd: root, timeoutMs });
    return r;
  };
  return {
    head: (root) => out(['rev-parse', 'HEAD'], root).then((r) => (r.ok ? r.outputTail.trim() : null)),
    branch: (root) => out(['branch', '--show-current'], root).then((r) => (r.ok ? r.outputTail.trim() : null)),
    fetchMain: (root) => out(['fetch', 'origin', 'main'], root, 120_000).then((r) => ({ ok: r.ok, error: r.ok ? null : { kind: r.errorKind || 'command', message: r.outputTail || r.error } })),
    behindMain: (root) => out(['rev-list', '--count', 'HEAD..origin/main'], root).then((r) => (r.ok ? { ok: true, behind: Number(r.outputTail.trim()) > 0, count: Number(r.outputTail.trim()) } : { ok: false })),
    rebaseMain: (root) => out(['rebase', 'origin/main'], root, 180_000).then((r) => (r.ok ? { ok: true, conflict: false } : { ok: false, conflict: /rebase|conflict|CONFLICT/i.test(`${r.outputTail || ''} ${r.error || ''}`), error: r.outputTail || r.error })),
    push: (root, branch) => out(['push', '-u', 'origin', branch], root, 180_000).then((r) => ({ ok: r.ok, error: r.ok ? null : { kind: r.errorKind || 'command', message: r.outputTail || r.error } })),
    diffNameOnly: (root, range) => out(['diff', '--name-only', range], root).then((r) => (r.ok ? r.outputTail.split(/\r?\n/).filter(Boolean) : [])),
    deleteLocalBranch: (root, branch) => out(['branch', '-d', branch], root).then((r) => ({ ok: r.ok, error: r.ok ? null : r.outputTail || r.error })),
  };
}

function makeGithubAdapter(execCommand) {
  const ghJson = async (args, timeoutMs = 120_000) => {
    // args 必须已自带 `--json <fields>`（gh 各子命令字段不同，统一追加裸 --json 会破坏真实 gh CLI）。
    const r = await execCommand({ command: 'gh', args, timeoutMs });
    if (!r.ok) return { ok: false, error: { kind: r.errorKind || 'command', message: r.outputTail || r.error } };
    try { return { ok: true, data: JSON.parse(r.outputTail) }; }
    catch (_) { return { ok: false, error: { kind: 'protocol', message: 'gh 输出非 JSON' } }; }
  };
  return {
    async listPRsByHead(head) {
      const r = await ghJson(['pr', 'list', '--head', head, '--state', 'all', '--json', 'number,state,url,title']);
      if (!r.ok) return r;
      const items = r.data || [];
      if (items.length === 0) return { ok: true, data: null };
      const open = items.find((p) => p.state === 'OPEN') || items.find((p) => p.state === 'MERGED') || items[0];
      return {
        ok: true, data: {
          number: open.number, state: open.state, url: open.url, title: open.title, mergeable: open.mergeable,
        },
      };
    },
    async createPR({ head, title, body }) {
      const r = await execCommand({ command: 'gh', args: ['pr', 'create', '--base', 'main', '--head', head, '--title', title, ...(body ? ['--body', body] : [])], timeoutMs: 180_000 });
      return r.ok ? { ok: true, prUrl: r.outputTail.trim() } : { ok: false, error: { kind: r.errorKind || 'command', message: r.outputTail || r.error } };
    },
    async viewPR(number) {
      const r = await ghJson(['pr', 'view', String(number), '--json', 'state,url,mergeStateStatus']);
      if (!r.ok) return r;
      return { ok: true, data: r.data };
    },
    async requiredChecks(number) {
      // `gh pr checks --required` 只返回 required checks；JSON 字段为 name/state。
      const r = await ghJson(['pr', 'checks', String(number), '--required', '--json', 'name,state']);
      if (!r.ok) return r;
      const runs = r.data || [];
      return { ok: true, data: { runs, required: runs } };
    },
    async waitRequiredChecks(number, { pollMs = 15_000, timeoutMs = 30 * 60_000 } = {}) {
      const deadline = Date.now() + timeoutMs;
      const stateOf = (c) => String(c.state || c.status || c.conclusion || '').toUpperCase();
      for (;;) {
        const r = await this.requiredChecks(number);
        if (!r.ok) return { ok: false, error: r.error };
        const pending = r.data.required.filter((c) => ['PENDING', 'IN_PROGRESS', 'QUEUED', 'EXPECTED', 'WAITING'].includes(stateOf(c)));
        if (pending.length === 0) {
          const failed = r.data.required.filter((c) => ['FAILURE', 'FAILING', 'CANCELLED', 'TIMED_OUT', 'ERROR'].includes(stateOf(c)));
          if (failed.length) return { ok: false, error: { kind: 'command', message: `required checks 失败：${failed.map((c) => `${c.name}=${stateOf(c)}`).join(', ')}` } };
          return { ok: true, data: r.data };
        }
        if (Date.now() > deadline) return { ok: false, error: { kind: 'timeout', message: `等待 required checks 超时（${Math.round(timeoutMs / 60000)}min）` } };
        await new Promise((res) => setTimeout(res, pollMs));
      }
    },
    async mergePR(number) {
      const r = await execCommand({ command: 'gh', args: ['pr', 'merge', String(number), '--squash'], timeoutMs: 180_000 });
      return r.ok ? { ok: true } : { ok: false, error: { kind: r.errorKind || 'command', message: r.outputTail || r.error } };
    },
    async merged(number) {
      const r = await ghJson(['pr', 'view', String(number), '--json', 'state,mergedAt']);
      if (!r.ok) return r;
      return { ok: true, data: r.data && r.data.state === 'MERGED' };
    },
  };
}

// ---------- 结构化 runner ----------

// runIntegrate(ctxInput, adapters?)
// adapters: { git, github } 可注入（测试用 fake）；缺省构造真实 adapter。
async function runIntegrate(ctxInput, adapters = {}) {
  const { def, change, state, root = stateApi.repoRoot(), log = () => {} } = ctxInput;
  const execCommand = makeRunCommand(process.env.PIPE_FAKE_CMDS);
  const git = adapters.git || makeGitAdapter(execCommand);
  const github = adapters.github || makeGithubAdapter(execCommand);

  return runCheckpointSerial({ def, change, state, root, log, git, github });
}

async function runCheckpointSerial({ def, change, state, root, log, git, github }) {
  const nodeId = def.id;
  const cpRecord = (name) => ({ status: state.nodes[nodeId] && state.nodes[nodeId].checkpoints && state.nodes[nodeId].checkpoints[name] ? state.nodes[nodeId].checkpoints[name].status : undefined });
  const cps = {};
  for (const name of CHECKPOINTS) {
    const cp = (state.nodes[nodeId] && state.nodes[nodeId].checkpoints && state.nodes[nodeId].checkpoints[name]) || cpRecord(name);
    if (cp && cp.status === 'succeeded') {
      cps[name] = cp;
      log(`[integrate] checkpoint ${name} 已成功，复用`);
      continue;
    }
    const result = await runCheckpoint(name, { change, root, git, github, log, cps });
    cps[name] = { status: result.status, updatedAt: new Date().toISOString(), evidence: result.evidence || {}, error: result.error ? result.error.message : null };
    stateApi.setCheckpoint(state, nodeId, name, cps[name]);
    if (result.status === 'succeeded') {
      log(`[integrate] ✓ checkpoint ${name} 完成`);
    } else {
      log(`[integrate] ✗ checkpoint ${name} ${result.status === 'suspended' ? '挂起' : '失败'}: ${(result.error && result.error.message) || ''}`);
      return {
        ok: false,
        error: result.error,
        structured: {
          archived: cps.archive && cps.archive.status === 'succeeded',
          prUrl: (cps['get-or-create-pr'] && cps['get-or-create-pr'].evidence && cps['get-or-create-pr'].evidence.prUrl) || '',
          merged: (cps.merge && cps.merge.status === 'succeeded') || (cps['verify-remote'] && cps['verify-remote'].status === 'succeeded'),
          summary: `integrate 停止于 checkpoint ${name}`,
        },
      };
    }
  }

  const prUrl = cps['get-or-create-pr'] && cps['get-or-create-pr'].evidence && cps['get-or-create-pr'].evidence.prUrl;
  return {
    ok: true,
    structured: {
      archived: true,
      prUrl: prUrl || '',
      merged: true,
      summary: 'integrate 全 checkpoint 完成：archive→commit→sync-main→push→PR→CI→merge→remote→cleanup',
    },
    commands: [],
  };
}

async function runCheckpoint(name, opts) {
  const { change, root, git, github, log, cps } = opts;
  const changeDir = `openspec/changes/${change}`;
  try {
    switch (name) {
      case 'archive': {
        if (!fs.existsSync(path.join(root, changeDir))) {
          return { status: 'succeeded', evidence: { skipped: true, reason: 'active change 目录已归档' } };
        }
        // 确定性归档：调用 .agents/commands/archive-change.js（机器可读、不依赖宿主斜杠命令）。
        const r = await runArchiveCommand(root, change, log);
        if (!r.ok) return { status: 'failed', error: { kind: 'command', message: r.error } };
        return { status: 'succeeded', evidence: { archived: true } };
      }
      case 'commit': {
        // 断言：归档后活动 change 目录消失（无残留）；分支 diff 同时含实现 + 规格更新。
        const archivedGone = !fs.existsSync(path.join(root, changeDir));
        const diff = await git.diffNameOnly(root, 'origin/main...HEAD');
        if (diff.length === 0) {
          return { status: 'failed', error: { kind: 'config', message: 'archive 后无提交差异，无法创建 PR' } };
        }
        // 活动 change 目录残留 = 归档未彻底完成，禁止创建 PR（create-pr 前失败）。
        if (!archivedGone) {
          return { status: 'failed', error: { kind: 'config', message: `活动 change 目录仍有残留：${changeDir}` } };
        }
        // canonical spec 更新：分支差异至少含一篇 docs/ 或 openspec/ 下的规格文件。
        const canonical = diff.some((f) => f.startsWith('docs/') || f.startsWith('openspec/'));
        if (!canonical) {
          return { status: 'failed', error: { kind: 'config', message: 'PR diff 不含 canonical spec/规格更新（docs/ openspec/），不完整' } };
        }
        return { status: 'succeeded', evidence: { files: diff, archivedGone: true } };
      }
      case 'sync-main': {
        const f = await git.fetchMain(root);
        if (!f.ok) return { status: 'failed', error: f.error };
        const behind = await git.behindMain(root);
        if (!behind.ok) return { status: 'failed', error: { kind: 'command', message: '无法判定分支领先/落后' } };
        if (behind.behind) {
          const rebase = await git.rebaseMain(root);
          if (!rebase.ok) {
            if (rebase.conflict) return { status: 'suspended', error: { kind: 'config', message: 'sync-main 与 main 冲突，需人工解决（不自动冲突解决）' } };
            return { status: 'failed', error: { kind: 'command', message: rebase.error } };
          }
        }
        return { status: 'succeeded', evidence: { behind: behind.count } };
      }
      case 'push': {
        const branch = await git.branch(root);
        const p = await git.push(root, branch);
        if (!p.ok) return { status: 'failed', error: p.error };
        return { status: 'succeeded', evidence: { branch } };
      }
      case 'get-or-create-pr': {
        const branch = await git.branch(root);
        const existing = await github.listPRsByHead(branch);
        if (existing.ok && existing.data) {
          return { status: 'succeeded', evidence: { prUrl: existing.data.url, reused: true, number: existing.data.number } };
        }
        const title = `feat(${change}): workflow pipeline integration`;
        const body = `Closes ${change} workflow integration`;
        const created = await github.createPR({ head: branch, title, body });
        if (!created.ok) return { status: 'failed', error: created.error };
        return { status: 'succeeded', evidence: { prUrl: created.prUrl, reused: false } };
      }
      case 'wait-required-ci': {
        const prNum = prNumber(cps);
        if (!prNum) return { status: 'failed', error: { kind: 'config', message: 'wait-required-ci 需要已创建的 PR 编号' } };
        const w = await github.waitRequiredChecks(prNum);
        if (!w.ok) return { status: 'failed', error: w.error };
        return { status: 'succeeded', evidence: { pr: prNum } };
      }
      case 'merge': {
        const prNum = prNumber(cps);
        const seen = await github.merged(prNum);
        if (seen.ok && seen.data === true) return { status: 'succeeded', evidence: { alreadyMerged: true } };
        const m = await github.mergePR(prNum);
        if (!m.ok) return { status: 'failed', error: m.error };
        return { status: 'succeeded', evidence: { merged: true } };
      }
      case 'verify-remote': {
        const prNum = prNumber(cps);
        const v = await github.viewPR(prNum);
        if (!v.ok) return { status: 'failed', error: v.error };
        if (v.data.state !== 'MERGED') return { status: 'failed', error: { kind: 'command', message: `远端 PR ${prNum} 状态 ${v.data.state}，未合并` } };
        return { status: 'succeeded', evidence: { state: v.data.state } };
      }
      case 'cleanup-local': {
        const branch = await git.branch(root);
        const del = await git.deleteLocalBranch(root, branch);
        if (!del.ok) {
          log(`⚠ [integrate] cleanup-local 失败：${del.error}（best-effort，不阻塞集成成功）`);
        }
        return { status: 'succeeded', evidence: { cleaned: del.ok, warning: del.ok ? null : del.error } };
      }
      default:
        return { status: 'failed', error: { kind: 'config', message: `未知 checkpoint: ${name}` } };
    }
  } catch (e) {
    return { status: 'failed', error: { kind: 'unknown', message: String((e && e.message) || e) } };
  }
}

function prNumber(cps) {
  const cp = cps['get-or-create-pr'];
  if (cp && cp.evidence && cp.evidence.number) return cp.evidence.number;
  const u = cp && cp.evidence && cp.evidence.prUrl;
  if (u) {
    const m = /\/pull\/(\d+)/.exec(u);
    if (m) return Number(m[1]);
  }
  return null;
}

// 确定性归档命令：解构为 command + argv，经 command adapter 执行。
// production：node <root>/.agents/commands/archive-change.js <change>；
// 临时仓库缺省回退 openspec CLI archive（与旧 wrapper 行为一致）。
async function runArchiveCommand(root, change, log) {
  const execCommand = makeRunCommand(process.env.PIPE_FAKE_CMDS);
  const script = path.join(root, '.agents', 'commands', 'archive-change.js');
  if (fs.existsSync(script)) {
    const r = await execCommand({ command: process.execPath, args: [script, change], cwd: root, timeoutMs: 120_000 });
    return r.ok ? { ok: true } : { ok: false, error: r.outputTail || r.error };
  }
  const r = await execCommand({ command: 'openspec', args: ['archive', change, '--yes'], cwd: root, timeoutMs: 120_000 });
  return r.ok ? { ok: true } : { ok: false, error: r.outputTail || r.error };
}

module.exports = {
  CHECKPOINTS,
  makeGitAdapter,
  makeGithubAdapter,
  runIntegrate,
  runCheckpoint,
  runCheckpointSerial,
};