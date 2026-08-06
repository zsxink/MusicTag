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

test('epic: epic.json 缺失 → run 返回非零', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-epic-'));
  withRoot(repo, () => {
    const code = epic.run('nonexistent-epic', 'mock');
    assert.notEqual(code, 0);
  });
  fs.rmSync(repo, { recursive: true, force: true });
});

test('epic: run 全部 done → 退出 0；含失败 → 退出非零', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-epic-'));
  withRoot(repo, () => {
    // 全 done 的 epic：无就绪项 → 立即成功
    const allDone = { name: 'e', items: [{ name: 'X', dependsOn: [], status: 'done' }] };
    fs.mkdirSync(path.join(repo, 'openspec', 'epics', 'e'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'openspec', 'epics', 'e', 'epic.json'), JSON.stringify(allDone));
    assert.equal(epic.run('e', 'mock'), 0);

    // 有失败项（依赖全 done 但自身 failed）：failed 状态不进就绪集 → 不算 allDone
    const failed = { name: 'e2', items: [{ name: 'Y', dependsOn: [], status: 'failed' }] };
    fs.mkdirSync(path.join(repo, 'openspec', 'epics', 'e2'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'openspec', 'epics', 'e2', 'epic.json'), JSON.stringify(failed));
    assert.notEqual(epic.run('e2', 'mock'), 0);
  });
  fs.rmSync(repo, { recursive: true, force: true });
});

test('epic: 仓库根判定——PIPE_CORE_REPO_ROOT 优先（worktree 场景状态根取主仓库）', () => {
  // state.js repoRoot 已在 state.test.js 覆盖；此处验证 epic 路径基于主仓库根
  const main = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-epic-main-'));
  withRoot(main, () => {
    assert.equal(epic.epicStateFile('e'), path.join(main, '.agents', 'runs', 'e', 'epic-state.json'));
  });
  fs.rmSync(main, { recursive: true, force: true });
});
