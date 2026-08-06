'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');
const epic = require('../epic.js');
const stateApi = require('../state.js');

function withRoot(repo, fn) {
  const prev = process.env.PIPE_CORE_REPO_ROOT;
  process.env.PIPE_CORE_REPO_ROOT = repo;
  try { return fn(); }
  finally {
    if (prev === undefined) delete process.env.PIPE_CORE_REPO_ROOT;
    else process.env.PIPE_CORE_REPO_ROOT = prev;
  }
}

// A、B 无依赖；C 依赖 A；D 依赖 B
const epicFixture = {
  name: 'test-epic',
  items: [
    { name: 'A', dependsOn: [], status: 'pending' },
    { name: 'B', dependsOn: [], status: 'pending' },
    { name: 'C', dependsOn: ['A'], status: 'pending' },
    { name: 'D', dependsOn: ['B'], status: 'pending' },
  ],
};

test('epic: readyItems 首批只含无依赖项', () => {
  withRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-epic-')), () => {
    const st = { schemaVersion: epic.EPIC_SCHEMA_VERSION, items: {} };
    const ready = epic.readyItems(epicFixture, st).map((i) => i.name);
    assert.deepEqual(ready.sort(), ['A', 'B']);
  });
});

test('epic: 批次上限 ≤3（依赖全部 done 后才就绪）', () => {
  withRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-epic-')), () => {
    // 5 个无依赖项 → 每批最多 3
    const five = { items: [1, 2, 3, 4, 5].map((n) => ({ name: `N${n}`, dependsOn: [], status: 'pending' })) };
    const st = { schemaVersion: epic.EPIC_SCHEMA_VERSION, items: {} };
    const ready = epic.readyItems(five, st);
    assert.equal(ready.length, 5);
    assert.ok(epic.MAX_CONCURRENCY <= 3);
    assert.equal(ready.slice(0, epic.MAX_CONCURRENCY).length, 3);
  });
});

test('epic: 前置 done 后依赖项就绪；前置 running 不就绪', () => {
  withRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-epic-')), () => {
    const st = {
      schemaVersion: epic.EPIC_SCHEMA_VERSION,
      items: { A: { status: 'done' }, B: { status: 'running' } },
    };
    const ready = epic.readyItems(epicFixture, st).map((i) => i.name);
    assert.deepEqual(ready, ['C'], 'A 已 done → C 就绪；B running → D 不就绪');
  });
});

test('epic: 崩溃恢复——已 done 项不重跑；失败项等主会话决策、不自动重试', () => {
  withRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-epic-')), () => {
    const st = {
      schemaVersion: epic.EPIC_SCHEMA_VERSION,
      items: {
        A: { status: 'done', worktree: '.worktrees/A' },
        B: { status: 'done', worktree: '.worktrees/B' },
        C: { status: 'failed', worktree: '.worktrees/C' },
        D: { status: 'pending' },
      },
    };
    const ready = epic.readyItems(epicFixture, st).map((i) => i.name);
    assert.deepEqual(ready, ['D'], '崩溃恢复只跑未完成项（C failed 按 D6 挂起等主会话，不自动重试）');
  });
});

test('epic: epic-state 读写 + schemaVersion 不兼容拒绝', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-epic-'));
  withRoot(repo, () => {
    const st = { schemaVersion: epic.EPIC_SCHEMA_VERSION, epic: 'test-epic', items: { A: { status: 'done' } } };
    epic.saveEpicState('test-epic', st);
    const loaded = epic.loadEpicState('test-epic');
    assert.equal(loaded.items.A.status, 'done');

    // 版本不兼容 → 抛错
    fs.writeFileSync(epic.epicStateFile('test-epic'), JSON.stringify({ schemaVersion: 999, items: {} }));
    assert.throws(() => epic.loadEpicState('test-epic'), /schemaVersion/);
  });
  fs.rmSync(repo, { recursive: true, force: true });
});

test('epic: epic.json 缺失 → run 返回非零', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-epic-'));
  const prev = process.env.PIPE_CORE_REPO_ROOT;
  process.env.PIPE_CORE_REPO_ROOT = repo;
  try {
    const code = await epic.run('nonexistent-epic', 'mock');
    assert.notEqual(code, 0);
  } finally {
    if (prev === undefined) delete process.env.PIPE_CORE_REPO_ROOT;
    else process.env.PIPE_CORE_REPO_ROOT = prev;
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('epic: run 全部 done → 退出 0；含失败 → 退出非零', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-epic-'));
  const prev = process.env.PIPE_CORE_REPO_ROOT;
  process.env.PIPE_CORE_REPO_ROOT = repo;
  try {
    // 全 done 的 epic：无就绪项 → 立即成功
    const allDone = { name: 'e', items: [{ name: 'X', dependsOn: [], status: 'done' }] };
    fs.mkdirSync(path.join(repo, 'openspec', 'epics', 'e'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'openspec', 'epics', 'e', 'epic.json'), JSON.stringify(allDone));
    assert.equal(await epic.run('e', 'mock'), 0);

    // 有失败项（依赖全 done 但自身 failed）：failed 状态不进就绪集 → 不算 allDone
    const failed = { name: 'e2', items: [{ name: 'Y', dependsOn: [], status: 'failed' }] };
    fs.mkdirSync(path.join(repo, 'openspec', 'epics', 'e2'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'openspec', 'epics', 'e2', 'epic.json'), JSON.stringify(failed));
    assert.notEqual(await epic.run('e2', 'mock'), 0);
  } finally {
    if (prev === undefined) delete process.env.PIPE_CORE_REPO_ROOT;
    else process.env.PIPE_CORE_REPO_ROOT = prev;
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('epic: 仓库根判定——PIPE_CORE_REPO_ROOT 优先（worktree 场景状态根取主仓库）', () => {
  // state.js repoRoot 已在 state.test.js 覆盖；此处验证 epic 路径基于主仓库根
  const main = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-epic-main-'));
  withRoot(main, () => {
    assert.equal(epic.epicStateFile('e'), path.join(main, '.agents', 'runs', 'e', 'epic-state.json'));
  });
  fs.rmSync(main, { recursive: true, force: true });
});

// ---------- P3 并行执行器端到端（真实 subprocess run.js + fake driver + 真实 git worktree） ----------

const FAKE_CLAUDE = path.join(__dirname, 'fixtures', 'fake-pipe-claude.js');
const FAKE_CONCURRENCY = path.join(__dirname, 'fixtures', 'fake-pipe-concurrency.js');

function tmpMainRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-epic-e2e-'));
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email t@t && git config user.name t', { cwd: dir });
  fs.writeFileSync(path.join(dir, '.gitignore'), '.worktrees/\n.agents/runs/\n');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hello');
  execSync('git add . && git commit -qm init', { cwd: dir });
  return dir;
}

test('epic: 3 个无依赖子项一批 ≤3，各在独立 worktree 跑完整子流程并清理（真实 git + subprocess）', async () => {
  const main = tmpMainRepo();
  const epicDef = {
    name: 'e2e',
    items: ['A', 'B', 'C'].map((n) => ({ name: n, dependsOn: [], status: 'pending', issue: 1 })),
  };
  fs.mkdirSync(path.join(main, 'openspec', 'epics', 'e2e'), { recursive: true });
  fs.writeFileSync(path.join(main, 'openspec', 'epics', 'e2e', 'epic.json'), JSON.stringify(epicDef));
  execSync('git add openspec && git commit -qm "add epic.json"', { cwd: main });
  process.env.PIPE_CORE_REPO_ROOT = main;
  process.env.PIPE_CLAUDE_BIN = FAKE_CLAUDE;
  process.env.CLAUDECODE = '1';
  delete process.env.AI_AGENT;
  try {
    const code = await epic.run('e2e', 'claude');
    assert.equal(code, 0, '全部子项应完成退出 0');
    const st = epic.loadEpicState('e2e');
    for (const n of ['A', 'B', 'C']) assert.equal(st.items[n].status, 'done', `${n} 应 done`);
    // worktree 隔离目录已清理
    assert.ok(!fs.existsSync(path.join(main, '.worktrees', 'A')), 'worktree A 应被清理');
    // 主仓库工作区保持干净
    const status = execSync('git status --porcelain', { cwd: main, encoding: 'utf8' }).trim();
    assert.equal(status, '');
  } finally {
    delete process.env.PIPE_CORE_REPO_ROOT;
    delete process.env.PIPE_CLAUDE_BIN;
    delete process.env.CLAUDECODE;
    execSync('git worktree prune', { cwd: main, stdio: 'ignore' });
    fs.rmSync(path.join(main, '.worktrees'), { recursive: true, force: true });
    fs.rmSync(main, { recursive: true, force: true });
  }
});

test('epic: 依赖保证顺序——B dependsOn A，A 未 done 时 B 不进就绪集', async () => {
  const main = tmpMainRepo();
  const epicDef = {
    name: 'order',
    items: [
      { name: 'A', dependsOn: [], status: 'pending', issue: 1 },
      { name: 'B', dependsOn: ['A'], status: 'pending', issue: 1 },
    ],
  };
  fs.mkdirSync(path.join(main, 'openspec', 'epics', 'order'), { recursive: true });
  fs.writeFileSync(path.join(main, 'openspec', 'epics', 'order', 'epic.json'), JSON.stringify(epicDef));
  process.env.PIPE_CORE_REPO_ROOT = main;
  process.env.PIPE_CLAUDE_BIN = FAKE_CLAUDE;
  process.env.CLAUDECODE = '1';
  try {
    const code = await epic.run('order', 'claude');
    assert.equal(code, 0);
    const st = epic.loadEpicState('order');
    assert.equal(st.items.A.status, 'done');
    assert.equal(st.items.B.status, 'done');
    // 合并顺序：A 在 B 之前
    assert.ok(st.items.A.mergeOrder < st.items.B.mergeOrder, 'A 应先于 B 完成合并');
  } finally {
    delete process.env.PIPE_CORE_REPO_ROOT;
    delete process.env.PIPE_CLAUDE_BIN;
    delete process.env.CLAUDECODE;
    execSync('git worktree prune', { cwd: main, stdio: 'ignore' });
    fs.rmSync(path.join(main, '.worktrees'), { recursive: true, force: true });
    fs.rmSync(main, { recursive: true, force: true });
  }
});

test('epic: 批次内子项并发执行（P3）——三个无依赖子项的子进程同时存活（时间线证据）', async () => {
  const main = tmpMainRepo();
  const epicDef = {
    name: 'par',
    items: ['P1', 'P2', 'P3'].map((n) => ({ name: n, dependsOn: [], status: 'pending', issue: 1 })),
  };
  fs.mkdirSync(path.join(main, 'openspec', 'epics', 'par'), { recursive: true });
  fs.writeFileSync(path.join(main, 'openspec', 'epics', 'par', 'epic.json'), JSON.stringify(epicDef));
  execSync('git add openspec && git commit -qm "add epic.json"', { cwd: main });

  // 并发证明：每个子项子进程的 preflight 都 sleep FAKE_PIPE_DELAY_MS（共享时间线文件追加 start/end）。
  // 若串行（spawnSync for-loop），preflight-end 会早于另一个 preflight-start；并发时三者 start 重叠。
  const timeline = path.join(main, 'timeline.txt');
  const delay = 500;
  process.env.PIPE_CORE_REPO_ROOT = main;
  process.env.PIPE_CLAUDE_BIN = FAKE_CONCURRENCY;
  process.env.PIPE_TIMELINE = timeline;
  process.env.FAKE_TIMELINE = timeline;
  process.env.FAKE_PIPE_DELAY_MS = String(delay);
  process.env.CLAUDECODE = '1';
  delete process.env.AI_AGENT;
  try {
    const t0 = Date.now();
    const code = await epic.run('par', 'claude');
    const elapsed = Date.now() - t0;
    assert.equal(code, 0, '三个无依赖子项应全部完成退出 0');
    assert.ok(fs.existsSync(timeline), '时间线文件应被写入');

    const lines = fs.readFileSync(timeline, 'utf8').trim().split('\n').filter(Boolean);
    const starts = lines.filter((l) => l.includes('preflight-start')).map((l) => Number(l.split(' ')[1]));
    const ends = lines.filter((l) => l.includes('preflight-end')).map((l) => Number(l.split(' ')[1]));
    assert.equal(starts.length, 3, '应有 3 次 preflight-start');
    assert.equal(ends.length, 3, '应有 3 次 preflight-end');

    // 并发证明（主断言，抗慢 CI）：至少两个 preflight 在第一个 preflight-end 前已 start（重叠存活区间）。
    // 串行下 starts=[t0,t500,t1000]、ends=[t500,t1000,t1500]，首个 end 前只有 1 个 start → 必失败；只依赖相对时序，不受机器快慢影响。
    const firstEnd = Math.min(...ends);
    const overlapping = starts.filter((s) => s < firstEnd).length;
    assert.ok(overlapping >= 2, `并发：至少 2 个 preflight 在首个 end 前已 start（实际重叠=${overlapping}）`);
    // 宽松 sanity bound（非并发证明，仅防病态挂起）：串行基线 3×sleep=1500ms，取 delay*4 留足慢 CI 启动/清理余量，
    // 真实并发 ~sleep+overhead 远低于此；不再用 tight 耗时断言（慢 CI 会误报 flake）。
    assert.ok(elapsed < delay * 4, `批次并发总耗时应远低于串行基线（sanity），实际 ${elapsed}ms`);
  } finally {
    delete process.env.PIPE_CORE_REPO_ROOT;
    delete process.env.PIPE_CLAUDE_BIN;
    delete process.env.PIPE_TIMELINE;
    delete process.env.FAKE_TIMELINE;
    delete process.env.FAKE_PIPE_DELAY_MS;
    delete process.env.CLAUDECODE;
    execSync('git worktree prune', { cwd: main, stdio: 'ignore' });
    fs.rmSync(path.join(main, '.worktrees'), { recursive: true, force: true });
    fs.rmSync(main, { recursive: true, force: true });
  }
});
