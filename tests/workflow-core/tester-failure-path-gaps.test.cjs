'use strict';

// Tester 覆盖审计补齐：spec scenario 的失败路径与边界缺口。
// 这些是审计发现的、spec 明确要求但此前无可执行 e2e 的断点：
//   1. 决断链「--force-retry 必须与 --resume 同用」的 CLI 约束（错误输入 fail-fast）。
//   2. P6/bootstrap–spec-gate 分离：「spec-gate 失败会阻止开发节点，dev 不得启动」。
//   3. Verify「源码不可变」：HEAD 被修改 / 规格（openspec/）被修改 → source-mutation 失败。
//   4. Verify 缓存「最终 HEAD 变化导致缓存失效」（S43）：同一 HEAD 缓存可复用，新 commit 后必须失效。
//   5. 决断链「未分类问题进入决断」（RS11）：Leader 返回 abort → 挂起；返回非法/错节点决断 → fail-closed。
//   6. 搜索联动类变更回归清单（S25）：回归必选项失败 → verify_failed（缺失必选项即失败）。
//   7. Integrate wait-required-ci：required check 失败 → 在 CI checkpoint 前停止且绝不 merge。
// 全部只跑受影响测试（临时 git 仓库 + fake driver），不重复 Verify 的完整本地基线。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '../..');
const CORE = path.join(REPO, '.agents', 'tools', 'pipe-core');
const RUNJS = path.join(CORE, 'run.js');
const FAKE_CLAUDE = path.join(CORE, 'test', 'fixtures', 'fake-pipe-claude.js');
const { seedWorkflows } = require(path.join(CORE, 'test', 'seed.js'));
const { fakeCommands } = require(path.join(CORE, 'test', 'fixtures', 'fake-pipe-commands.js'));

function writeStub(dir, name, body) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`);
  fs.chmodSync(file, 0o755);
  return file;
}

function tmpRepo(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix || 'tester-gap-'));
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email t@t && git config user.name t', { cwd: dir });
  seedWorkflows(dir);
  fs.writeFileSync(path.join(dir, '.gitignore'), '.agents/runs/\n');
  fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed');
  execSync('git add . && git commit -qm init', { cwd: dir });
  return dir;
}

test('决断链边界: --force-retry 未与 --resume 同用 → 退出码 2 拒绝（错误输入 fail-fast）', () => {
  const repo = tmpRepo('tester-gap-force-retry-');
  try {
    const res = spawnSync(process.execPath, [RUNJS, 'demo', '--force-retry', 'dev'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, PIPE_CORE_REPO_ROOT: repo, CLAUDECODE: '1', AI_AGENT: '', PIPE_CLAUDE_BIN: FAKE_CLAUDE },
    });
    assert.equal(res.status, 2, `--force-retry 无 --resume 必须拒绝，实际 exit ${res.status}`);
    assert.match(res.stderr, /--force-retry 必须与 --resume 同用/);
    // 不得产生任何 state 副作用。
    assert.equal(fs.existsSync(path.join(repo, '.agents', 'runs', 'demo', 'state.json')), false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('bootstrap/spec-gate 分离失败路径: spec-gate 失败 → dev 不启动且流程挂起', () => {
  const repo = tmpRepo('tester-gap-specgate-');
  // 真实 preflight 桩：bootstrap 阶段通过，spec-gate 阶段恒失败。
  //（seedWorkflows 已写入可执行桩，这里覆盖为可控失败版本。）
  const stub = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'change_name=${1:?}',
    'stage=${2:-all}',
    'if [ "$stage" = "spec-gate" ]; then',
    '  echo "spec-gate 校验失败（受控测试）" >&2',
    '  exit 1',
    'fi',
    'exit 0',
  ].join('\n');
  fs.writeFileSync(path.join(repo, '.agents', 'workflows', 'pipe-preflight.sh'), stub);
  fs.chmodSync(path.join(repo, '.agents', 'workflows', 'pipe-preflight.sh'), 0o755);
  const fake = fakeCommands({ verify: true, gitRemote: true, ghFlat: true });
  const env = {
    ...process.env,
    PIPE_CORE_REPO_ROOT: repo,
    CLAUDECODE: '1',
    AI_AGENT: '',
    PIPE_CLAUDE_BIN: FAKE_CLAUDE,
    ...fake.env(),
  };
  try {
    const res = spawnSync(process.execPath, [RUNJS, 'demo'], { cwd: repo, encoding: 'utf8', env });
    // spec-gate 失败（不可重试的 preflight 发现）→ 决断 escalate → 挂起退出 3。
    assert.equal(res.status, 3, `spec-gate 失败应挂起，实际 exit ${res.status}\nstdout=${res.stdout}\nstderr=${res.stderr}`);
    const stateFile = path.join(repo, '.agents', 'runs', 'demo', 'state.json');
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    const sg = state.nodes['spec-gate'];
    assert.equal(sg.status, 'suspended', 'spec-gate 应挂起');
    // dev 节点从未创建/执行（状态里不存在）。
    assert.equal(!!state.nodes.dev, false, 'spec-gate 失败时 dev 不得启动');
    // architect 已通过（它在 spec-gate 之前）。
    assert.equal(state.nodes.architect.status, 'succeeded', 'spec-gate 前 architect 已成功');
  } finally {
    fake.cleanup();
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('verify 不可变失败路径: 规格文件被验证命令修改 → source-mutation 失败并精确报告', async () => {
  const repo = tmpRepo('tester-gap-verify-spec-');
  // backend 域 verify 计划需要 src-tauri/Cargo.toml 与 .agents/tools/pipe-core/run.js（node 桩路径）。
  fs.mkdirSync(path.join(repo, 'src-tauri'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src-tauri', 'Cargo.toml'), '[package]\nname="demo"\n');
  fs.mkdirSync(path.join(repo, '.agents', 'tools', 'pipe-core'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.agents', 'tools', 'pipe-core', 'run.js'), 'console.log("stub");\n');
  fs.mkdirSync(path.join(repo, 'openspec', 'changes', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'openspec', 'changes', 'demo', 'spec.md'), '# baseline spec\n');
  fs.writeFileSync(path.join(repo, '.gitignore'), '.agents/runs/\ntarget/\ndist/\n');
  execSync('git add -A && git commit -qm "spec baseline"', { cwd: repo });

  const fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tester-gap-verifycmds-'));
  const writeFx = (name, body) => {
    const f = path.join(fakeDir, name);
    fs.writeFileSync(f, `#!/usr/bin/env bash\n${body}\n`);
    fs.chmodSync(f, 0o755);
  };
  writeFx('cargo', `echo 'polluting specs' >> "${path.join(repo, 'openspec', 'changes', 'demo', 'spec.md')}"; exit 0`);
  writeFx('npm', 'exit 0');
  writeFx('npx', 'exit 0');
  writeFx('node', 'exit 0');
  try {
    const verify = require(path.join(REPO, '.agents', 'tools', 'pipe-core', 'verify.js'));
    const ctx = { env: { ...process.env, PIPE_FAKE_CMDS: fakeDir } };
    const state = { change: 'demo', nodes: {} };
    const def = { id: 'verify', kind: 'deterministic', runner: 'verify', change: 'demo', domain: 'backend', schema: {} };
    const res = await verify.runVerify({ def, change: 'demo', state, ctx, root: repo, log: () => {}, saveState: () => {} });
    assert.equal(res.ok, false, 'tracked 规格文件被验证命令修改 → 必须 source-mutation 失败');
    assert.equal(res.error.kind, 'source-mutation');
    assert.match(res.error.message, /openspec[\\/]changes[\\/]demo[\\/]spec\.md/, '应精确报告污染路径');
  } finally {
    try { fs.rmSync(fakeDir, { recursive: true, force: true }); } catch (_) {}
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('verify 不可变失败路径: 验证命令改变 HEAD → source-mutation 精确报告 HEAD 变化', async () => {
  const repo = tmpRepo('tester-gap-verify-head-');
  // backend 域 verify 需要 src-tauri/Cargo.toml 与 .agents/tools/pipe-core/run.js（node 桩）。
  fs.mkdirSync(path.join(repo, 'src-tauri'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src-tauri', 'Cargo.toml'), '[package]\nname="demo"\n');
  fs.mkdirSync(path.join(repo, '.agents', 'tools', 'pipe-core'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.agents', 'tools', 'pipe-core', 'run.js'), 'console.log("stub");\n');
  fs.writeFileSync(path.join(repo, '.gitignore'), '.agents/runs/\ntarget/\ndist/\n');
  execSync('git add -A && git commit -qm "baseline"', { cwd: repo });

  const fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tester-gap-verifyhead-'));
  const writeFx = (name, body) => {
    const f = path.join(fakeDir, name);
    fs.writeFileSync(f, `#!/usr/bin/env bash\n${body}\n`);
    fs.chmodSync(f, 0o755);
  };
  // cargo 命令执行一个真实空提交 → verify 后 HEAD 前移，源码快照必须捕获并精确报告。
  writeFx('cargo', 'git -C "' + repo + '" commit --allow-empty -qm "polluted by verify cmd"; exit 0');
  writeFx('npm', 'exit 0');
  writeFx('npx', 'exit 0');
  writeFx('node', 'exit 0');
  try {
    const verify = require(path.join(REPO, '.agents', 'tools', 'pipe-core', 'verify.js'));
    const ctx = { env: { ...process.env, PIPE_FAKE_CMDS: fakeDir } };
    const state = { change: 'demo', nodes: {} };
    const def = { id: 'verify', kind: 'deterministic', runner: 'verify', change: 'demo', domain: 'backend', schema: {} };
    const res = await verify.runVerify({ def, change: 'demo', state, ctx, root: repo, log: () => {}, saveState: () => {} });
    assert.equal(res.ok, false, '验证命令改变 HEAD → 必须 source-mutation 失败');
    assert.equal(res.error.kind, 'source-mutation');
    assert.match(res.error.message, /\(HEAD 变化\)/, '应精确报告是 HEAD 变化（而非仅路径污染）');
  } finally {
    try { fs.rmSync(fakeDir, { recursive: true, force: true }); } catch (_) {}
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('verify 缓存边界: 同一 HEAD 可 cache hit；新 commit（Tester/返修后 HEAD 前移）→ 缓存失效（spec「最终 HEAD 变化导致缓存失效」）', async () => {
  const repo = tmpRepo('tester-gap-verifycache-');
  // infra 域 verify 需要 .agents/tools/pipe-core/run.js 与 .agents/workflows 桩。
  fs.mkdirSync(path.join(repo, '.agents', 'tools', 'pipe-core'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.agents', 'tools', 'pipe-core', 'run.js'), '#!/usr/bin/env node\nconsole.log("stub-run");\n');
  seedWorkflows(repo);
  fs.writeFileSync(path.join(repo, '.gitignore'), '.agents/runs/\ntarget/\ndist/\n');
  execSync('git add -A && git commit -qm "baseline"', { cwd: repo });

  const fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tester-gap-verifycache-cmds-'));
  writeStub(fakeDir, 'node', 'exit 0');
  writeStub(fakeDir, 'npx', 'exit 0');
  writeStub(fakeDir, 'bash', 'exit 0');
  writeStub(fakeDir, 'openspec', 'exit 0');
  try {
    const verify = require(path.join(REPO, '.agents', 'tools', 'pipe-core', 'verify.js'));
    const ctx = { env: { ...process.env, PIPE_FAKE_CMDS: fakeDir } };
    const def = { id: 'verify', kind: 'deterministic', runner: 'verify', change: 'demo', domain: 'infra', schema: {} };
    const state = { change: 'demo', nodes: {} };

    // 第一次全量验证成功 → 落盘 succeeded + cacheKey。
    const r1 = await verify.runVerify({ def, change: 'demo', state, ctx, root: repo, log: () => {}, saveState: () => {} });
    assert.equal(r1.ok, true, JSON.stringify(r1.structured));
    state.nodes.verify = { status: 'succeeded', result: r1.structured, cacheKey: r1.structured.cacheKey };

    // 同一 HEAD 再次运行 → cache hit（复用，不重跑）。
    const r2 = await verify.runVerify({ def, change: 'demo', state, ctx, root: repo, log: () => {}, saveState: () => {} });
    assert.equal(r2.ok, true);
    assert.equal(r2.structured.cacheHit, true, '同一 HEAD 应命中缓存');

    // Tester/返修产生新 commit → HEAD 前移 → 旧 HEAD 的 cache 必须失效，重跑全量。
    fs.writeFileSync(path.join(repo, 'seed.txt'), 'tester amends after coverage');
    execSync('git add seed.txt && git commit -qm "feat(demo): tester coverage amend"', { cwd: repo });
    state.nodes.verify.cacheKey = r1.structured.cacheKey; // 手动保留旧键，证明 HEAD 变化即失效（而非节点被删）
    const r3 = await verify.runVerify({ def, change: 'demo', state, ctx, root: repo, log: () => {}, saveState: () => {} });
    assert.equal(r3.ok, true);
    assert.equal(r3.structured.cacheHit, false, '新 HEAD 后旧缓存必须失效，重跑全量基线');
    assert.notEqual(r3.structured.cacheKey, r1.structured.cacheKey, '缓存键必须随 HEAD 变化');
  } finally {
    try { fs.rmSync(fakeDir, { recursive: true, force: true }); } catch (_) {}
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('搜索联动回归边界: 必选回归步骤失败 → verify_failed（spec「搜索联动类变更回归清单」缺失必选项即失败）', async () => {
  const repo = tmpRepo('tester-gap-searchreg-');
  // infra 域 verify 需要 run.js 桩 + workflows 桩。
  fs.mkdirSync(path.join(repo, '.agents', 'tools', 'pipe-core'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.agents', 'tools', 'pipe-core', 'run.js'), '#!/usr/bin/env node\nconsole.log("stub-run");\n');
  seedWorkflows(repo);
  // 规格标记搜索联动维度（取词/换源/并发/离线）→ 回归清单必选。
  fs.mkdirSync(path.join(repo, 'openspec', 'changes', 'demo', 'specs'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'openspec', 'changes', 'demo', 'specs', 'spec.md'),
    '## Requirement: 搜索联动\n并发聚合各源，换源时取词不被破坏，离线判定区分网络失败与空结果。\n');
  fs.writeFileSync(path.join(repo, '.gitignore'), '.agents/runs/\ntarget/\ndist/\n');
  execSync('git add -A && git commit -qm "baseline"', { cwd: repo });

  const fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tester-gap-searchreg-cmds-'));
  // 构造假 node：--test / --check / --self-check 假成功，但搜索联动回归的 `node -e` 直接失败。
  writeStub(fakeDir, 'node', `case "$1" in
  -e) echo "搜索联动回归失败（受控）" >&2; exit 1 ;;
  *) exit 0 ;;
esac
`);
  writeStub(fakeDir, 'npx', 'exit 0');
  writeStub(fakeDir, 'bash', 'exit 0');
  writeStub(fakeDir, 'openspec', 'exit 0');
  try {
    const verify = require(path.join(REPO, '.agents', 'tools', 'pipe-core', 'verify.js'));
    const ctx = { env: { ...process.env, PIPE_FAKE_CMDS: fakeDir } };
    const state = { change: 'demo', nodes: {} };
    const def = { id: 'verify', kind: 'deterministic', runner: 'verify', change: 'demo', domain: 'infra', schema: {} };
    const res = await verify.runVerify({ def, change: 'demo', state, ctx, root: repo, log: () => {}, saveState: () => {} });
    assert.equal(res.ok, false, '搜索联动必选回归步骤失败 → 验证必须失败');
    assert.equal(res.error.kind, 'verify_failed');
    // 失败步骤名携带回归语义，逐项入 verify.steps 且取词/换源/并发/离线四类必项均被记录。
    const failStep = res.structured.steps.find((s) => s.status === 'fail');
    assert.match(failStep.step, /搜索联动回归/);
    const regSteps = res.structured.steps.filter((s) => s.step.includes('搜索联动回归'));
    for (const marker of ['取词', '换源', '并发', '离线']) {
      assert.ok(regSteps.some((s) => s.step.includes(marker)), `回归清单缺 ${marker} 必选项`);
    }
  } finally {
    try { fs.rmSync(fakeDir, { recursive: true, force: true }); } catch (_) {}
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('integrate PR 复用边界: head branch 已存在 merged PR → 复用不重复创建（spec「同一 change 不重复创建 PR」open 或 merged）', async () => {
  const integrate = require(path.join(REPO, '.agents', 'tools', 'pipe-core', 'integrate.js'));
  const stateApi = require(path.join(REPO, '.agents', 'tools', 'pipe-core', 'state.js'));
  const repo = tmpRepo('tester-gap-integrate-mergedpr-');
  try {
    const state = stateApi.newState('demo', 'mock');
    // archive 已完成：活动 change 目录消失。
    fs.rmSync(path.join(repo, 'openspec', 'changes', 'demo'), { recursive: true, force: true });
    const fakeGit = {
      async head() { return 'deadbeef'; },
      async branch() { return 'demo'; },
      async fetchMain() { return { ok: true }; },
      async behindMain() { return { ok: true, behind: false, count: 0 }; },
      async rebaseMain() { return { ok: true, conflict: false }; },
      async push() { return { ok: true }; },
      async diffNameOnly() { return ['openspec/specs/workflow-core.md', 'src/a.rs']; },
      async deleteLocalBranch() { return { ok: true }; },
    };
    const fakeGithub = {
      calls: [],
      async listPRsByHead() {
        fakeGithub.calls.push('listPRsByHead');
        return { ok: true, data: { number: 7, state: 'MERGED', url: 'https://github.com/zsxink/MusicTag/pull/7', title: 't' } };
      },
      async createPR() { fakeGithub.calls.push('createPR'); return { ok: true, prUrl: 'https://github.com/zsxink/MusicTag/pull/7' }; },
      async requiredChecks() { return { ok: true, data: { runs: [], required: [] } }; },
      async waitRequiredChecks() { return { ok: true, data: {} }; },
      async merged() { return { ok: true, data: true }; },
      async mergePR() { return { ok: true }; },
      async viewPR() { return { ok: true, data: { state: 'MERGED' } }; },
    };
    const res = await integrate.runIntegrate(
      { def: { id: 'integrate' }, change: 'demo', state, root: repo, log: () => {} },
      { git: fakeGit, github: fakeGithub },
    );
    assert.equal(res.ok, true, JSON.stringify(res.structured));
    assert.equal(res.structured.prUrl, 'https://github.com/zsxink/MusicTag/pull/7');
    assert.ok(!fakeGithub.calls.includes('createPR'), 'head branch 已存在 merged PR 时不得重复创建第二个 PR');
    // 已 merged → 不重复 merge。
    assert.ok(!fakeGithub.calls.includes('mergePR'), '远端已 merged 不应再 merge');
    assert.equal(state.nodes.integrate.checkpoints['get-or-create-pr'].evidence.reused, true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('integrate wait-required-ci 失败路径: required check 失败 → 停止于 CI checkpoint，绝不 merge（spec「集成命令确定性」）', async () => {
  const integrate = require(path.join(REPO, '.agents', 'tools', 'pipe-core', 'integrate.js'));
  const stateApi = require(path.join(REPO, '.agents', 'tools', 'pipe-core', 'state.js'));
  const repo = tmpRepo('tester-gap-integrate-failci-');
  try {
    const state = stateApi.newState('demo', 'mock');
    // 模拟 archive 已完成：活动 change 目录消失 → archive checkpoint 快进。
    fs.rmSync(path.join(repo, 'openspec', 'changes', 'demo'), { recursive: true, force: true });
    const fakeGit = {
      calls: [],
      async head() { return 'deadbeef'; },
      async branch() { return 'demo'; },
      async fetchMain() { return { ok: true }; },
      async behindMain() { return { ok: true, behind: false, count: 0 }; },
      async rebaseMain() { return { ok: true, conflict: false }; },
      async push() { return { ok: true }; },
      async diffNameOnly() { return ['openspec/specs/workflow-core.md', 'src/a.rs']; },
      async deleteLocalBranch() { return { ok: true }; },
    };
    const fakeGithub = {
      calls: [],
      async listPRsByHead() { return { ok: true, data: null }; },
      async createPR() { return { ok: true, prUrl: 'https://github.com/zsxink/MusicTag/pull/1' }; },
      async requiredChecks() { return { ok: true, data: { runs: [], required: [] } }; },
      async waitRequiredChecks() {
        fakeGithub.calls.push('waitRequiredChecks');
        return { ok: false, error: { kind: 'command', message: 'required checks 失败：cargo=FAILURE' } };
      },
      async merged() { return { ok: true, data: false }; },
      async mergePR() { fakeGithub.calls.push('mergePR'); return { ok: true }; },
      async viewPR() { return { ok: true, data: { state: 'MERGED' } }; },
    };
    const logMsgs = [];
    const res = await integrate.runIntegrate(
      { def: { id: 'integrate' }, change: 'demo', state, root: repo, log: (m) => logMsgs.push(m) },
      { git: fakeGit, github: fakeGithub },
    );
    assert.equal(res.ok, false, 'required check 失败 → integrate 必须失败');
    assert.match(res.error.message, /cargo=FAILURE/);
    // wait-required-ci checkpoint 已落盘为 failed，merge 不得被调用。
    assert.equal(state.nodes.integrate.checkpoints['wait-required-ci'].status, 'failed');
    assert.ok(!fakeGithub.calls.some((c) => ['mergePR', 'viewPR'].includes(c)), `CI 失败后不得进入后续 GitHub 副作用（实际：${fakeGithub.calls.join(',')}）`);
    assert.ok(fakeGithub.calls.includes('waitRequiredChecks'), 'wait-required-ci checkpoint 必须被真实尝试');
    // 停止于 CI 前的 checkpoint：archive/commit/sync-main/push/PR 均已 succeeded。
    for (const name of ['archive', 'commit', 'sync-main', 'push', 'get-or-create-pr']) {
      assert.equal(state.nodes.integrate.checkpoints[name].status, 'succeeded', `checkpoint ${name} 应在 succeed 后保留`);
    }
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('决策链边界: Leader 决断 abort → 挂起返回主会话（spec「未分类问题进入决断」abort 语义）', async () => {
  const core = require(path.join(REPO, '.agents', 'tools', 'pipe-core', 'core.js'));
  const stateApi = require(path.join(REPO, '.agents', 'tools', 'pipe-core', 'state.js'));
  const repo = tmpRepo('tester-gap-decision-abort-');
  const previous = process.env.PIPE_CORE_REPO_ROOT;
  process.env.PIPE_CORE_REPO_ROOT = repo;
  try {
    const change = 'abort-demo';
    const state = stateApi.newState(change, 'mock');
    let leaderCalls = 0;
    // n1 无信号失败（unknown，不可盲目重试）→ core 触发 Leader 决断节点；
    // 决断 driver 返回 action=abort → 终止挂起回主会话。
    const driver = {
      async runAgent(task) {
        if (task.id.startsWith('decision-')) {
          leaderCalls++;
          return { ok: true, structured: { action: 'abort', node: 'n1', reason: '需求歧义，交用户拍板' } };
        }
        return { ok: false, error: { kind: 'unknown', message: 'unclassifiable structure failure' } };
      },
    };
    const defsFn = () => [{
      id: 'n1', role: 'leader', prompt: 'p',
      schema: { type: 'object', required: ['done'], properties: { done: { type: 'boolean' } } },
      dependsOn: [], retry: { max: 0, intervalMs: 0 },
    }];
    const res = await core.runPipeline({ change, state, defsFn, driver, commitRoot: repo, getHead: () => 'deadbeef' });
    assert.equal(res.status, 'suspended', 'abort 决断应终止并挂起');
    assert.equal(res.decision.action, 'abort');
    assert.equal(state.nodes.n1.status, 'suspended');
    assert.equal(leaderCalls, 1, 'unknown 错误应只触发一次 Leader 决断');
  } finally {
    if (previous === undefined) delete process.env.PIPE_CORE_REPO_ROOT;
    else process.env.PIPE_CORE_REPO_ROOT = previous;
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('决策链边界: Leader 决断返回非法 action / 错 node → fail-closed 拒绝并挂起决策失败', async () => {
  const core = require(path.join(REPO, '.agents', 'tools', 'pipe-core', 'core.js'));
  const stateApi = require(path.join(REPO, '.agents', 'tools', 'pipe-core', 'state.js'));
  const repo = tmpRepo('tester-gap-decision-invalid-');
  const previous = process.env.PIPE_CORE_REPO_ROOT;
  process.env.PIPE_CORE_REPO_ROOT = repo;
  try {
    const change = 'invalid-dec';
    const state = stateApi.newState(change, 'mock');
    let leaderCalls = 0;
    const base = {
      async runAgent(task) {
        if (task.id.startsWith('decision-')) {
          leaderCalls++;
          return { ok: true, structured: { action: 'giveup', node: 'wrong', reason: 'bad' } }; // 非法 action + 错 node
        }
        return { ok: false, error: { kind: 'unknown', message: 'unclassifiable failure' } };
      },
    };
    const res = await core.runPipeline({
      change, state,
      defsFn: () => [{ id: 'n1', role: 'leader', prompt: 'p', schema: { type: 'object' }, dependsOn: [], retry: { max: 0 } }],
      driver: base, commitRoot: repo, getHead: () => 'deadbeef',
    });
    // 决断本身失败 → 挂起 decision-failed（fail-closed，绝不盲目重试）。
    assert.equal(res.status, 'suspended');
    assert.equal(res.stage, 'decision-failed');
    assert.match(res.reason, /Leader 决断失败/);
    assert.equal(leaderCalls, 1, 'fail-closed 只尝试一次决断');
  } finally {
    if (previous === undefined) delete process.env.PIPE_CORE_REPO_ROOT;
    else process.env.PIPE_CORE_REPO_ROOT = previous;
    fs.rmSync(repo, { recursive: true, force: true });
  }
});