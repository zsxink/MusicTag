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

test('epic: 崩溃恢复——中断时 running 的子项续跑重置为 pending（可重新调度，不永久卡死）', async () => {
  const main = tmpMainRepo();
  const def = { name: 'e', items: [{ name: 'A', dependsOn: [], status: 'pending' }] };
  fs.mkdirSync(path.join(main, 'openspec', 'epics', 'e'), { recursive: true });
  fs.writeFileSync(path.join(main, 'openspec', 'epics', 'e', 'epic.json'), JSON.stringify(def));
  execSync('git add openspec && git commit -qm "add epic.json"', { cwd: main });
  // 模拟中断瞬间：A 已置 running（批次开始即落盘），但子进程尚未收尾 → epic-state.json 永久停留 running
  process.env.PIPE_CORE_REPO_ROOT = main;
  epic.saveEpicState('e', { schemaVersion: epic.EPIC_SCHEMA_VERSION, epic: 'e', items: { A: { status: 'running', worktree: null } } });
  assert.deepEqual(epic.readyItems(def, epic.loadEpicState('e')).map((i) => i.name), [], 'running 不进就绪集（readyItems 语义保持）');
  // 续跑：run() 内部把 running → pending 重新调度 → 就绪集恢复 → A 完整跑通
  process.env.PIPE_CLAUDE_BIN = FAKE_CLAUDE;
  process.env.CLAUDECODE = '1';
  delete process.env.AI_AGENT;
  try {
    const code = await epic.run('e', 'claude');
    assert.equal(code, 0, 'running 子项续跑后应可恢复并完成（退出 0）');
    assert.equal(epic.loadEpicState('e').items.A.status, 'done', 'A 续跑后应 done');
    assert.ok(!fs.existsSync(path.join(main, '.worktrees', 'A')), 'worktree A 应被清理');
  } finally {
    delete process.env.PIPE_CORE_REPO_ROOT;
    delete process.env.PIPE_CLAUDE_BIN;
    delete process.env.CLAUDECODE;
    execSync('git worktree prune', { cwd: main, stdio: 'ignore' });
    fs.rmSync(path.join(main, '.worktrees'), { recursive: true, force: true });
    fs.rmSync(main, { recursive: true, force: true });
  }
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

// ---------- 独立复核修复专项测试 ----------

test('epic: dependsOn 引用未知子项名 → run 显式报错返回非零（复核2 minor）', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-epic-dep-'));
  const prev = process.env.PIPE_CORE_REPO_ROOT;
  process.env.PIPE_CORE_REPO_ROOT = repo;
  try {
    const bad = { name: 'e', items: [{ name: 'A', dependsOn: ['GHOST'], status: 'pending' }] };
    fs.mkdirSync(path.join(repo, 'openspec', 'epics', 'e'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'openspec', 'epics', 'e', 'epic.json'), JSON.stringify(bad));
    const code = await epic.run('e', 'mock');
    assert.equal(code, 1);
  } finally {
    if (prev === undefined) delete process.env.PIPE_CORE_REPO_ROOT;
    else process.env.PIPE_CORE_REPO_ROOT = prev;
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('epic: pid 锁——孤儿存活拒绝双跑；孤儿已死清理锁可续跑（复核2 major）', () => {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-epic-lock-'));
  try {
    // 无锁 → 可续跑
    assert.equal(epic.acquirePidLock(wt, { name: 'A' }), null);
    // 写锁（pid 为本进程，必然存活）
    epic.writePidLock(wt, 'A', process.pid);
    assert.ok(fs.existsSync(epic.lockFile(wt)), '锁文件应存在');
    const orphan = epic.acquirePidLock(wt, { name: 'A' });
    assert.ok(orphan, '存活 pid 的锁 → 判定为孤儿，拒绝双跑');
    assert.equal(orphan.pid, process.pid);
    // 孤儿已死：模拟残留死 pid 锁 → acquire 应清理并返回 null
    fs.writeFileSync(epic.lockFile(wt), JSON.stringify({ pid: 999999, item: 'A', startedAt: 'x' }));
    assert.equal(epic.acquirePidLock(wt, { name: 'A' }), null, '死 pid 锁应被清理，可续跑');
    assert.ok(!fs.existsSync(epic.lockFile(wt)), '死锁应被删除');
  } finally {
    fs.rmSync(wt, { recursive: true, force: true });
  }
});

test('epic: readyItems 排除 suspended（挂起子项不自动重试，复核2/3）', () => {
  withRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-epic-susp-')), () => {
    const st = { schemaVersion: epic.EPIC_SCHEMA_VERSION, items: { A: { status: 'suspended' }, B: { status: 'done' } } };
    const def = { name: 'e', items: [{ name: 'A', dependsOn: [], status: 'pending' }, { name: 'B', dependsOn: [], status: 'pending' }] };
    const ready = epic.readyItems(def, st).map((i) => i.name);
    assert.deepEqual(ready, [], 'suspended 项不进就绪集');
  });
});

test('epic: 子项挂起（exit 3）→ epic.run 返回 3，不折叠为 failed（复核2 major）', async () => {
  // fake driver 通过注入 PIPE_CLAUDE_BIN 让子项在 tester 语义失败 → run.js 退出 3。
  // 用真实 run.js + fake driver + 真实 git worktree，断言 epic.run 返回 3 且子项状态 suspended。
  const main = tmpMainRepo();
  const def = { name: 'susp', items: [{ name: 'S', dependsOn: [], status: 'pending', issue: 1 }] };
  fs.mkdirSync(path.join(main, 'openspec', 'epics', 'susp'), { recursive: true });
  fs.writeFileSync(path.join(main, 'openspec', 'epics', 'susp', 'epic.json'), JSON.stringify(def));
  execSync('git add openspec && git commit -qm "add epic.json"', { cwd: main });
  process.env.PIPE_CORE_REPO_ROOT = main;
  process.env.PIPE_CLAUDE_BIN = FAKE_CLAUDE;
  process.env.FAKE_TESTER_FAIL = '1';
  process.env.CLAUDECODE = '1';
  delete process.env.AI_AGENT;
  try {
    const code = await epic.run('susp', 'claude');
    assert.equal(code, 3, '子项挂起 → epic 应返回 3（透传 suspended）');
    const st = epic.loadEpicState('susp');
    assert.equal(st.items.S.status, 'suspended', '子项状态应为 suspended 而非 failed');
  } finally {
    delete process.env.PIPE_CORE_REPO_ROOT;
    delete process.env.PIPE_CLAUDE_BIN;
    delete process.env.FAKE_TESTER_FAIL;
    delete process.env.CLAUDECODE;
    execSync('git worktree prune', { cwd: main, stdio: 'ignore' });
    fs.rmSync(path.join(main, '.worktrees'), { recursive: true, force: true });
    fs.rmSync(main, { recursive: true, force: true });
  }
});

test('epic: B2 自动 --resume——子项已存在 state.json 时续跑自动追加（不再被 exit 2 挡死）', async () => {
  // 前置：创建 epic 定义；子项的 .agents/runs/<item>/state.json 已存在（模拟中途崩溃落盘）。
  // 若 runItemAsync 不自动 --resume，子进程 run.js 会 exit 2 → 子项 failed。
  // 断言最终子项 done（说明自动 --resume 生效，从既有状态续跑而非被挡死）。
  const main = tmpMainRepo();
  const def = { name: 'resume2', items: [{ name: 'R', dependsOn: [], status: 'pending', issue: 1 }] };
  fs.mkdirSync(path.join(main, 'openspec', 'epics', 'resume2'), { recursive: true });
  fs.writeFileSync(path.join(main, 'openspec', 'epics', 'resume2', 'epic.json'), JSON.stringify(def));
  execSync('git add openspec && git commit -qm "add epic.json"', { cwd: main });
  // 预置子项 state.json：nodes 为空 → --resume 加载后无已通过节点，全量重跑（fake driver 全绿）
  fs.mkdirSync(path.join(main, '.agents', 'runs', 'R'), { recursive: true });
  fs.writeFileSync(path.join(main, '.agents', 'runs', 'R', 'state.json'),
    JSON.stringify({ schemaVersion: 1, change: 'R', driver: 'claude', startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), nodes: {} }));
  process.env.PIPE_CORE_REPO_ROOT = main;
  process.env.PIPE_CLAUDE_BIN = FAKE_CLAUDE;
  process.env.CLAUDECODE = '1';
  delete process.env.AI_AGENT;
  try {
    const code = await epic.run('resume2', 'claude');
    assert.equal(code, 0, '预置 state.json 的子项应经自动 --resume 续跑成功而非 exit 2');
    const st = epic.loadEpicState('resume2');
    assert.equal(st.items.R.status, 'done');
  } finally {
    delete process.env.PIPE_CORE_REPO_ROOT;
    delete process.env.PIPE_CLAUDE_BIN;
    delete process.env.CLAUDECODE;
    execSync('git worktree prune', { cwd: main, stdio: 'ignore' });
    fs.rmSync(path.join(main, '.worktrees'), { recursive: true, force: true });
    fs.rmSync(main, { recursive: true, force: true });
  }
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
