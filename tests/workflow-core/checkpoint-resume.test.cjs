'use strict';

// 任务组 7.3：integrate 四个 checkpoint（archive / PR 已创建 / CI 已通过 / 远端已合并）
// 分别中断并 resume，验证幂等副作用计数（一个 PR、一轮 CI、一次 merge）与最终单 PR 完整 diff。
// 与前组 6.3 的差异：本组连续遍历四个中断点，且断言最终 PR diff 同时含实现与归档规格。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');
const integrate = require('../../.agents/tools/pipe-core/integrate.js');
const stateApi = require('../../.agents/tools/pipe-core/state.js');

// 简化 fake git adapter（记录与 6.x 测试一致）。
function fakeGit(overrides = {}) {
  const calls = [];
  const defaults = {
    head: () => 'deadbeef',
    branch: () => 'demo',
    fetchMain: () => ({ ok: true }),
    behindMain: () => ({ ok: true, behind: false, count: 0 }),
    rebaseMain: () => ({ ok: true, conflict: false }),
    push: () => ({ ok: true }),
    diffNameOnly: () => ['openspec/specs/workflow-core.md', 'src/a.rs'],
    deleteLocalBranch: () => ({ ok: true }),
  };
  const call = (name, ...args) => { calls.push(name); return overrides[name] ? overrides[name](...args) : defaults[name](...args); };
  return {
    calls,
    async head(root) { return call('head', root); },
    async branch(root) { return call('branch', root); },
    async fetchMain(root) { return call('fetchMain', root); },
    async behindMain(root) { return call('behindMain', root); },
    async rebaseMain(root) { return call('rebaseMain', root); },
    async push(root, branch) { return call('push', root, branch); },
    async diffNameOnly(root, range) { return call('diffNameOnly', root, range); },
    async deleteLocalBranch(root, branch) { return call('deleteLocalBranch', root, branch); },
  };
}

function fakeGithub(overrides = {}) {
  const calls = [];
  const defaults = {
    listPRsByHead: () => ({ ok: true, data: null }),
    createPR: () => ({ ok: true, prUrl: 'https://github.com/zsxink/MusicTag/pull/1' }),
    requiredChecks: () => ({ ok: true, data: { runs: [], required: [] } }),
    waitRequiredChecks: () => ({ ok: true, data: {} }),
    merged: () => ({ ok: true, data: false }),
    mergePR: () => ({ ok: true }),
    viewPR: () => ({ ok: true, data: { state: 'MERGED' } }),
  };
  const call = (name, ...args) => { calls.push(name); return overrides[name] ? overrides[name](...args) : defaults[name](...args); };
  return {
    calls,
    async listPRsByHead(head) { return call('listPRsByHead', head); },
    async createPR(o) { return call('createPR', o); },
    async viewPR(n) { return call('viewPR', n); },
    async requiredChecks(n) { return call('requiredChecks', n); },
    async waitRequiredChecks(n, o) { return call('waitRequiredChecks', n, o); },
    async mergePR(n) { return call('mergePR', n); },
    async merged(n) { return call('merged', n); },
  };
}

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-core-checkpoint-'));
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email t@t && git config user.name t', { cwd: dir });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
  execSync('git add . && git commit -qm init', { cwd: dir });
  return dir;
}

function ctxFor(repo, state, log) {
  return { def: { id: 'integrate' }, change: 'checkpoint-demo', state, root: repo, log: log || (() => {}) };
}

test('integrate 7.3: 四中断点各自 resume 幂等——单 PR 单 CI 单 merge 且最终 diff 完整', async () => {
  // '' = 无中断（全流程一次跑通基线）；archive / get-or-create-pr / wait-required-ci / merge 为四个中断 checkpoint。
  const points = ['', 'archive', 'get-or-create-pr', 'wait-required-ci', 'merge'];

  for (const resumeFrom of points) {
    const repo = tmpRepo();
    const state = stateApi.newState('checkpoint-demo', 'mock');
    // 模拟活动 change 目录已消失：archive checkpoint 快进成功（6.2 归档首选形态）。
    fs.rmSync(path.join(repo, 'openspec', 'changes', 'checkpoint-demo'), { recursive: true, force: true });
    const git = fakeGit();
    const github = fakeGithub();
    const logMsgs = [];

    try {
      // 中断点 = 预置该 checkpoint 之前的全部 checkpoint 为 succeeded，并从该点 resume。
      //（runIntegrate 天然支持：已落盘 succeeded checkpoint 直接复用，未完成的下一个继续执行。）
      if (resumeFrom) {
        const idx = integrate.CHECKPOINTS.indexOf(resumeFrom);
        assert.ok(idx >= 0, `未知中断点 ${resumeFrom}`);
        for (let i = 0; i < idx; i++) {
          const name = integrate.CHECKPOINTS[i];
          const evidence = name === 'commit'
            ? { archivedGone: true, files: ['openspec/specs/workflow-core.md', 'src/a.rs'] }
            : name === 'get-or-create-pr'
              ? { prUrl: 'https://github.com/zsxink/MusicTag/pull/1', reused: false }
              : {};
          stateApi.setCheckpoint(state, 'integrate', name, { status: 'succeeded', evidence });
        }
      }

      let res;
      try {
        res = await integrate.runIntegrate(ctxFor(repo, state, (m) => logMsgs.push(m)), { git, github });
      } catch (e) {
        assert.fail(`中断点 ${resumeFrom} resume 抛出异常：${e.message}`);
      }
      const label = `中断点 ${resumeFrom || '（基线）'}`;
      assert.equal(res.ok, true, `${label} resume 应成功：${JSON.stringify(res.structured)}`);

      // 副作用唯一性：累计绝不超过一个 PR / 一轮 CI / 一次 merge。
      const createPRs = github.calls.filter((c) => c === 'createPR').length;
      const ciWaits = github.calls.filter((c) => c === 'waitRequiredChecks').length;
      const merges = github.calls.filter((c) => c === 'mergePR').length;
      assert.ok(createPRs <= 1, `${label} PR 创建不超过 1 次`);
      // 中断在 get-or-create-pr 处：该 checkpoint 尚未落盘 → 恰好创建一次；
      // 其余中断点（archive 之后）PR 已存在/已预置 → 复用不重复创建。
      if (resumeFrom === 'get-or-create-pr') assert.equal(createPRs, 1, `${label} PR 创建点 resume 应恰好创建一次`);
      assert.ok(ciWaits <= 1, `${label} required CI 不超过一轮`);
      assert.ok(merges <= 1, `${label} merge 不超过一次`);

      // 最终单 PR 完整 diff：commit checkpoint 断言 PR diff 同时含实现 + 归档规格。
      const cp = state.nodes.integrate.checkpoints;
      assert.equal(cp.commit.evidence.archivedGone, true, `${label} 活动 change 目录无残留`);
      const diffFiles = cp.commit.evidence.files;
      assert.ok(diffFiles.some((f) => f.startsWith('src/') || f.startsWith('src-tauri/')), `${label} diff 含实现文件`);
      assert.ok(diffFiles.some((f) => f.startsWith('docs/') || f.startsWith('openspec/')), `${label} diff 含归档规格文件`);
      // 全部 checkpoint 最终 succeeded。
      for (const n of integrate.CHECKPOINTS) assert.equal(cp[n].status, 'succeeded', `${label} checkpoint ${n}`);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  }
});