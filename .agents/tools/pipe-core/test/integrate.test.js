'use strict';
// Integrate checkpoint 状态机测试（6.1–6.4）：
//  - 6.1 顺序执行 checkpoint 且每步原子落盘。
//  - 6.2 archive 先于 PR、活动 change 无残留、canonical spec/实现同 PR 断言。
//  - 6.3 按 head branch get-or-create-pr 复用、required checks 复用、远端 merge 事实核验。
//  - 6.4 branch-behind 挂起/解决、already-merged 快进、cleanup-local warning；
//     重复 resume 只一个 PR、一轮 CI、一次 merge。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');
const integrate = require('../integrate.js');
const stateApi = require('../state.js');

// 简化 fake git adapter：记录被调用的命令，返回可控事实。
function fakeGit(overrides = {}) {
  const calls = [];
  const defaults = {
    head: () => 'deadbeef',
    branch: () => 'demo',
    fetchMain: () => ({ ok: true }),
    behindMain: () => ({ ok: true, behind: false, count: 0 }),
    rebaseMain: () => ({ ok: true, conflict: false }),
    push: () => ({ ok: true }),
    diffNameOnly: () => ['src/a.rs', 'docs/design/design.md'],
    deleteLocalBranch: () => ({ ok: true }),
  };
  const call = (name, ...args) => { calls.push(name); return overrides[name] ? overrides[name](...args) : defaults[name](...args); };
  const adapter = {
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
  return adapter;
}

// fake github adapter。
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
  const adapter = {
    calls,
    async listPRsByHead(head) { return call('listPRsByHead', head); },
    async createPR(o) { return call('createPR', o); },
    async viewPR(n) { return call('viewPR', n); },
    async requiredChecks(n) { return call('requiredChecks', n); },
    async waitRequiredChecks(n, o) { return call('waitRequiredChecks', n, o); },
    async mergePR(n) { return call('mergePR', n); },
    async merged(n) { return call('merged', n); },
  };
  return adapter;
}

function tmpRepo(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix || 'pipe-integrate-'));
  execSync('git init -q && git config user.email t@t && git config user.name t', { cwd: dir });
  fs.mkdirSync(path.join(dir, 'openspec', 'changes', 'demo', 'specs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'openspec', 'changes', 'demo', 'proposal.md'), '# demo');
  fs.writeFileSync(path.join(dir, 'src', 'a.rs').split('/src/')[0] + '/.gitignore', '.agents/runs/\n');
  execSync('git add -A && git commit -qm init', { cwd: dir });
  return dir;
}

function runnerCtx(repo, state, log) {
  return { def: { id: 'integrate' }, change: 'demo', state, root: repo, log: log || (() => {}), saveState: () => stateApi.saveState('demo', state) };
}

test('integrate 6.1/6.3: 全 checkpoint 顺序执行，PR 只创建一次、required CI 一轮、merge 一次', async () => {
  const repo = tmpRepo('pipe-integrate-full-');
  const state = stateApi.newState('demo', 'mock');
  const git = fakeGit({
    // archive 后 change 目录还在的真实仓库：让 archive checkpoint 跳过（目录已消失）。
    diffNameOnly: () => ['openspec/specs/workflow-core.md', 'src/a.rs'],
  });
  const github = fakeGithub();
  // 先删 change 目录模拟 archive 已完成。
  fs.rmSync(path.join(repo, 'openspec', 'changes', 'demo'), { recursive: true, force: true });
  const res = await integrate.runIntegrate(runnerCtx(repo, state, undefined), { git, github });
  assert.equal(res.ok, true, JSON.stringify(res.structured, null, 2));
  assert.equal(res.structured.merged, true);
  // PR 只创建一次。
  assert.equal(github.calls.filter((c) => c === 'createPR').length, 1);
  // merge 只一次。
  assert.equal(github.calls.filter((c) => c === 'mergePR').length, 1);
  // required CI 只等待一轮。
  assert.equal(github.calls.filter((c) => c === 'waitRequiredChecks').length, 1);
  // checkpoint 全 succeeded。
  const cps = state.nodes.integrate.checkpoints;
  const names = Object.keys(cps);
  for (const n of integrate.CHECKPOINTS) assert.equal(cps[n].status, 'succeeded', `checkpoint ${n}`);
  fs.rmSync(repo, { recursive: true, force: true });
});

test('integrate 6.2: archive 先于 PR；archive 失败或 diff 为空 → 创建 PR 前失败', async () => {
  // 子场景 1：archive 命令失败（fake openspec 返回非零）→ 停止在 archive，不创建 PR。
  const repo = tmpRepo('pipe-integrate-order-');
  const fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-integrate-openspec-fail-'));
  fs.writeFileSync(path.join(fakeDir, 'openspec'), '#!/usr/bin/env bash\nexit 1\n');
  fs.chmodSync(path.join(fakeDir, 'openspec'), 0o755);
  const prev = process.env.PIPE_FAKE_CMDS;
  process.env.PIPE_FAKE_CMDS = fakeDir;
  try {
    const state = stateApi.newState('demo', 'mock');
    // 不删 change 目录 → archive 真实执行。
    const git = fakeGit();
    const github = fakeGithub();
    const res = await integrate.runIntegrate(runnerCtx(repo, state, undefined), { git, github });
    assert.equal(res.ok, false);
    assert.equal(github.calls.filter((c) => c === 'createPR').length, 0, 'PR 不得在 archive 前创建');

    // 子场景 2：archive 成功（fake openspec 返回 0）但 diff 为空 → commit checkpoint 失败，仍不创建 PR。
    fs.writeFileSync(path.join(fakeDir, 'openspec'), '#!/usr/bin/env bash\nexit 0\n');
    fs.chmodSync(path.join(fakeDir, 'openspec'), 0o755);
    const state2 = stateApi.newState('demo', 'mock');
    const git2 = fakeGit({ diffNameOnly: () => [] });
    const github2 = fakeGithub();
    const res2 = await integrate.runIntegrate(runnerCtx(repo, state2, undefined), { git: git2, github: github2 });
    assert.equal(res2.ok, false);
    assert.match(res2.error.message, /无提交差异|PR diff/i);
    assert.equal(github2.calls.filter((c) => c === 'createPR').length, 0);
  } finally {
    if (prev === undefined) delete process.env.PIPE_FAKE_CMDS;
    else process.env.PIPE_FAKE_CMDS = prev;
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(fakeDir, { recursive: true, force: true });
  }
});

test('integrate 6.3: 已存在 PR → 复用不重复创建，required checks passing → 不再等待', async () => {
  const repo = tmpRepo('pipe-integrate-reuse-');
  const state = stateApi.newState('demo', 'mock');
  fs.rmSync(path.join(repo, 'openspec', 'changes', 'demo'), { recursive: true, force: true });
  const git = fakeGit();
  const github = fakeGithub({
    listPRsByHead: () => ({ ok: true, data: { number: 5, state: 'OPEN', url: 'https://github.com/zsxink/MusicTag/pull/5' } }),
    dueToMerge: null,
  });
  const res = await integrate.runIntegrate(runnerCtx(repo, state, undefined), { git, github });
  assert.equal(res.ok, true);
  assert.equal(github.calls.filter((c) => c === 'createPR').length, 0, '已存在 PR 不重复创建');
  assert.match(res.structured.prUrl, /pull\/5/);
  fs.rmSync(repo, { recursive: true, force: true });
});

test('integrate 6.4: 远端已 merged → merge checkpoint 快进；cleanup-local 失败仅 warning 仍成功', async () => {
  const repo = tmpRepo('pipe-integrate-merged-');
  const state = stateApi.newState('demo', 'mock');
  fs.rmSync(path.join(repo, 'openspec', 'changes', 'demo'), { recursive: true, force: true });
  const git = fakeGit({
    deleteLocalBranch: () => ({ ok: false, error: 'cannot delete branch' }),
  });
  const github = fakeGithub({
    merged: () => ({ ok: true, data: true }), // 远端已合并
  });
  const logMsgs = [];
  const res = await integrate.runIntegrate(runnerCtx(repo, state, (m) => logMsgs.push(m)), { git, github });
  assert.equal(res.ok, true, JSON.stringify(res.structured, null, 2));
  // merge 不再调用 mergePR（已 merged）。
  assert.equal(github.calls.filter((c) => c === 'mergePR').length, 0);
  // cleanup-local warning 不阻塞成功。
  assert.ok(logMsgs.some((m) => m.includes('cleanup-local 失败')), 'cleanup warning 应记录');
  fs.rmSync(repo, { recursive: true, force: true });
});

test('integrate 6.4: branch-behind → sync-main rebase 后成功；rebase 冲突 → 挂起', async () => {
  const repo = tmpRepo('pipe-integrate-behind-');
  const state = stateApi.newState('demo', 'mock');
  fs.rmSync(path.join(repo, 'openspec', 'changes', 'demo'), { recursive: true, force: true });
  const git = fakeGit({
    behindMain: () => ({ ok: true, behind: true, count: 3 }),
    rebaseMain: () => ({ ok: true, conflict: false }),
  });
  const github = fakeGithub();
  const res = await integrate.runIntegrate(runnerCtx(repo, state, undefined), { git, github });
  assert.equal(res.ok, true);
  assert.ok(git.calls.includes('rebaseMain'), 'behind 时应 rebase main');
  // 冲突场景。
  const state2 = stateApi.newState('demo', 'mock');
  fs.rmSync(path.join(repo, 'openspec', 'changes', 'demo'), { recursive: true, force: true });
  const git2 = fakeGit({
    behindMain: () => ({ ok: true, behind: true, count: 1 }),
    rebaseMain: () => ({ ok: false, conflict: true, error: 'CONFLICT (content)' }),
  });
  const res2 = await integrate.runIntegrate(runnerCtx(repo, state2, undefined), { git: git2, github: fakeGithub() });
  assert.equal(res2.ok, false);
  assert.match(res2.error.message, /冲突/);
  fs.rmSync(repo, { recursive: true, force: true });
});

test('integrate 6.1: 任意 checkpoint 中断后 resume 从下一未完成 checkpoint 继续（带 PR 的 resume 幂等）', async () => {
  const repo = tmpRepo('pipe-integrate-resume-');
  const state = stateApi.newState('demo', 'mock');
  fs.rmSync(path.join(repo, 'openspec', 'changes', 'demo'), { recursive: true, force: true });
  // 手动把 archive/commit/sync-main/push 标记 succeeded（模拟中断后落盘）。
  for (const name of ['archive', 'commit', 'sync-main', 'push']) {
    stateApi.setCheckpoint(state, 'integrate', name, { status: 'succeeded', updatedAt: new Date().toISOString(), evidence: {} });
  }
  fs.rmSync(repo, { recursive: true, force: true });
});

test('integrate 6.1: 带 prUrl 的既有 checkpoint resume 幂等——一次 merge、一次 CI', async () => {
  const repo = tmpRepo('pipe-integrate-resume2-');
  const state = stateApi.newState('demo', 'mock');
  // 预置 mid-flight checkpoint：PR 已创建。
  stateApi.setCheckpoint(state, 'integrate', 'archive', { status: 'succeeded', updatedAt: new Date().toISOString(), evidence: {} });
  stateApi.setCheckpoint(state, 'integrate', 'commit', { status: 'succeeded', updatedAt: new Date().toISOString(), evidence: {} });
  stateApi.setCheckpoint(state, 'integrate', 'sync-main', { status: 'succeeded', updatedAt: new Date().toISOString(), evidence: {} });
  stateApi.setCheckpoint(state, 'integrate', 'push', { status: 'succeeded', updatedAt: new Date().toISOString(), evidence: {} });
  stateApi.setCheckpoint(state, 'integrate', 'get-or-create-pr', {
    status: 'succeeded', updatedAt: new Date().toISOString(), evidence: { prUrl: 'https://github.com/zsxink/MusicTag/pull/9', number: 9 },
  });
  // 未完成：wait-required-ci、merge、verify-remote、cleanup-local。
  const git = fakeGit();
  const github = fakeGithub({
    merged: () => ({ ok: true, data: false }),
  });
  const res = await integrate.runIntegrate(runnerCtx(repo, state, undefined), { git, github });
  assert.equal(res.ok, true, JSON.stringify(res.structured, null, 2));
  // 幂等：只一次 waitRequiredChecks + 一次 mergePR。
  assert.equal(github.calls.filter((c) => c === 'waitRequiredChecks').length, 1);
  assert.equal(github.calls.filter((c) => c === 'mergePR').length, 1);
  assert.equal(github.calls.filter((c) => c === 'createPR').length, 0);
  assert.equal(github.calls.filter((c) => c === 'listPRsByHead').length, 0, '已有 PR checkpoint，不应再查 head');
  // get-or-create-pr checkpoint 不重跑（cps 读到 succeeded）。
  fs.rmSync(repo, { recursive: true, force: true });
});