'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');
const state = require('../state.js');

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-state-'));
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email t@t && git config user.name t', { cwd: dir });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hello');
  execSync('git add . && git commit -qm init', { cwd: dir });
  return dir;
}

test('state: repoRoot 优先读 PIPE_CORE_REPO_ROOT 环境变量', () => {
  const prev = process.env.PIPE_CORE_REPO_ROOT;
  try {
    process.env.PIPE_CORE_REPO_ROOT = '/fake/repo';
    assert.equal(state.repoRoot(), '/fake/repo');
  } finally {
    if (prev === undefined) delete process.env.PIPE_CORE_REPO_ROOT;
    else process.env.PIPE_CORE_REPO_ROOT = prev;
  }
});

test('state: repoRoot 缺省回退 git rev-parse --show-toplevel', () => {
  delete process.env.PIPE_CORE_REPO_ROOT;
  const root = state.repoRoot();
  assert.ok(fs.existsSync(path.join(root, '.git')));
});

test('state: repoRoot 两者皆无时报错', () => {
  const prev = process.env.PIPE_CORE_REPO_ROOT;
  delete process.env.PIPE_CORE_REPO_ROOT;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-nogit-'));
  try {
    const cwd = process.cwd();
    process.chdir(dir);
    assert.throws(() => state.repoRoot(), /仓库根/);
    process.chdir(cwd);
  } finally {
    if (prev !== undefined) process.env.PIPE_CORE_REPO_ROOT = prev;
  }
});

test('state: 状态文件读写 + schemaVersion 校验', () => {
  const repo = tmpRepo();
  const prevRoot = process.env.PIPE_CORE_REPO_ROOT;
  process.env.PIPE_CORE_REPO_ROOT = repo;
  try {
    const change = 'demo';
    const s = state.newState(change, 'claude');
    assert.equal(s.schemaVersion, state.SCHEMA_VERSION);
    state.saveState(change, s);
    const loaded = state.loadState(change);
    assert.equal(loaded.change, 'demo');
    assert.equal(loaded.driver, 'claude');
    assert.ok(fs.existsSync(path.join(repo, '.agents', 'runs', change, 'state.json')));

    const bad = { schemaVersion: 999, nodes: {} };
    fs.writeFileSync(state.stateFile(change), JSON.stringify(bad));
    assert.throws(() => state.loadState(change), /schemaVersion/);
  } finally {
    if (prevRoot === undefined) delete process.env.PIPE_CORE_REPO_ROOT;
    else process.env.PIPE_CORE_REPO_ROOT = prevRoot;
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('state: cacheKey 随输入变化', () => {
  const a = state.cacheKey('n1', 'in1', 'ref1');
  const b = state.cacheKey('n1', 'in2', 'ref1');
  const c = state.cacheKey('n1', 'in1', 'ref2');
  assert.notEqual(a, b);
  assert.notEqual(a, c);
  assert.equal(state.cacheKey('n1', 'in1', 'ref1'), a);
});

test('state: commitLanded 对当前 HEAD 为真、对不存在 SHA 为假', () => {
  const head = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  assert.equal(state.commitLanded(head), true);
  assert.equal(state.commitLanded('0000000000000000000000000000000000000000'), false);
});

test('state: validateLandings 将 commit 不存在的 succeeded 节点标记失败', () => {
  const repo = tmpRepo();
  const prevRoot = process.env.PIPE_CORE_REPO_ROOT;
  process.env.PIPE_CORE_REPO_ROOT = repo;
  try {
    const head = execSync('git rev-parse HEAD', { encoding: 'utf8', cwd: repo }).trim();
    const st = {
      schemaVersion: 1,
      nodes: {
        ok: { status: 'succeeded', commitSha: head },
        gone: { status: 'succeeded', commitSha: '0000000000000000000000000000000000000000' },
      },
    };
    const dirty = state.validateLandings(st);
    assert.deepEqual(dirty, ['gone']);
    assert.equal(st.nodes.gone.status, 'failed');
    assert.equal(st.nodes.ok.status, 'succeeded');
  } finally {
    if (prevRoot === undefined) delete process.env.PIPE_CORE_REPO_ROOT;
    else process.env.PIPE_CORE_REPO_ROOT = prevRoot;
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('state: commitLanded 判定根可传——worktree 分支 HEAD 判定（独立复核 M3/M1）', () => {
  const main = tmpRepo();
  const prevRoot = process.env.PIPE_CORE_REPO_ROOT;
  process.env.PIPE_CORE_REPO_ROOT = main;
  try {
    // worktree 分支 base = main HEAD
    const base = execSync('git rev-parse HEAD', { cwd: main, encoding: 'utf8' }).trim();
    // 在 main 上新建 commit：它存在于对象库，但不是任何 worktree 分支的祖先前提要再造分支。
    // 用真实 worktree 验证「判定根是 worktree 分支 HEAD 而非 main HEAD」：
    execSync(`git worktree add ${main}/wt -b feature-x`, { cwd: main, stdio: 'ignore' });
    const wtHead = execSync('git rev-parse HEAD', { cwd: `${main}/wt`, encoding: 'utf8' }).trim();
    // 主仓库对象库共享，base/wtHead 都在对象库
    assert.equal(state.commitLanded(base, `${main}/wt`), true, 'base 是 wt 分支祖先');
    assert.equal(state.commitLanded(wtHead, `${main}/wt`), true, 'wtHead 是 wt 自身 HEAD');

    // main 上再提交一个新 commit（不在 wt 分支历史里）→ 以 wt 为判定根应为 false
    fs.writeFileSync(path.join(main, 'b.txt'), 'bye');
    execSync('git add . && git commit -qm "main only"', { cwd: main });
    const mainOnly = execSync('git rev-parse HEAD', { cwd: main, encoding: 'utf8' }).trim();
    assert.equal(state.commitLanded(mainOnly, `${main}/wt`), false, 'main-only commit 不是 wt 分支祖先 → 校验应失败');
    assert.equal(state.commitLanded(mainOnly, main), true, '但以 main 为判定根是真祖先');

    execSync('git worktree remove --force wt', { cwd: main, stdio: 'ignore' });
    execSync('git branch -D feature-x', { cwd: main, stdio: 'ignore' });
  } finally {
    if (prevRoot === undefined) delete process.env.PIPE_CORE_REPO_ROOT;
    else process.env.PIPE_CORE_REPO_ROOT = prevRoot;
    fs.rmSync(main, { recursive: true, force: true });
  }
});

test('state: markDirty 标记自身与依赖它的节点（dependents）', () => {
  const defs = [
    { id: 'integrate', role: 'leader', dependsOn: ['cr'] },
    { id: 'cr', role: 'cr-agent', dependsOn: ['tester'] },
    { id: 'tester', role: 'tester', dependsOn: ['dev'] },
    { id: 'dev', role: 'leader', dependsOn: ['architect'] },
    { id: 'architect', role: 'architect', dependsOn: [] },
  ];
  const st = { nodes: {
    integrate: { status: 'succeeded' },
    cr: { status: 'failed' },
    tester: { status: 'succeeded' },
    dev: { status: 'succeeded' },
    architect: { status: 'succeeded' },
  } };
  const dirty = state.markDirty(st, defs, 'cr');
  assert.ok(dirty.includes('cr'));
  assert.ok(dirty.includes('integrate'), '依赖 cr 的 integrate 应被标记 dirty');
  assert.ok(!dirty.includes('tester'));
  assert.ok(!dirty.includes('dev'));
  assert.ok(!dirty.includes('architect'));
  assert.equal(st.nodes.integrate.status, 'failed');
  assert.equal(st.nodes.integrate.dirty, true);
});
