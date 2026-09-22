'use strict';

// 任务组 7.2：domain=both 临时仓库端到端 fixture（等价 Issue #121 同等级）。
// 批准后无需主会话干预：bootstrap/spec-gate/verify/integrate 各只执行一轮，
// 确定性节点零 driver 调用（fake driver 调用记录里不得出现 bootstrap/spec-gate/verify/integrate），
// arch/dev-rust/dev-vue/tester/cr 各一轮，integrate 产生唯一 PR/一轮 CI/一次 merge。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '../..');
const RUNJS = path.join(REPO, '.agents', 'tools', 'pipe-core', 'run.js');
const FAKE_BOTH = path.join(REPO, '.agents', 'tools', 'pipe-core', 'test', 'fixtures', 'fake-pipe-both.js');
const { fakeCommands } = require(REPO + '/.agents/tools/pipe-core/test/fixtures/fake-pipe-commands.js');
const { seedWorkflows } = require(REPO + '/.agents/tools/pipe-core/test/seed.js');

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-core-both-'));
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email t@t && git config user.name t', { cwd: dir });
  seedWorkflows(dir);
  // 桩 preflight 只验参数面，无需真实 openspec assets 即可通过。
  // 注意：不得预建 openspec/changes/demo——保持 archive checkpoint 走「目录已消失」快进，
  // 模拟已归档的干净分支（7.2 的无人值守终态与 6.2 的归档首选都要求这一形态）。
  fs.writeFileSync(path.join(dir, '.gitignore'), '.agents/runs/\n');
  execSync('git add . && git commit -qm init', { cwd: dir });
  return dir;
}

test('metrics 7.2: domain=both 端到端无人值守闭环——确定性节点零 driver 调用，单 PR 单 CI 单 merge', () => {
  const repo = tmpRepo();
  // 驱动调用记录必须放仓库外：仓库内写入会触发 core 的越权审计（7.2 无人值守证明不允许主会话补文件）。
  const callsFile = path.join(os.tmpdir(), `pipe-both-calls-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  const fake = fakeCommands({ verify: true, gitRemote: true, ghFlat: true });
  const env = {
    ...process.env,
    PIPE_CORE_REPO_ROOT: repo,
    CLAUDECODE: '1',
    AI_AGENT: '',
    PIPE_CLAUDE_BIN: FAKE_BOTH,
    FAKE_DRIVER_CALLS: callsFile,
    // 7.4：可控时钟基准——把 Issue #121 同等级样本耗时注入为基准，e2e 摘要判定 35% 降低。
    PIPE_BASELINE_MS: '10000',
    ...fake.env(),
  };
  try {
    const res = spawnSync(process.execPath, [RUNJS, 'demo'], { cwd: repo, encoding: 'utf8', env });
    assert.equal(res.status, 0, `stdout=${res.stdout} stderr=${res.stderr}`);
    const state = JSON.parse(fs.readFileSync(path.join(repo, '.agents', 'runs', 'demo', 'state.json'), 'utf8'));
    // 全节点 succeeded。
    for (const id of ['bootstrap', 'architect', 'spec-gate', 'dev-rust', 'dev-vue', 'tester', 'cr', 'verify', 'integrate']) {
      assert.equal(state.nodes[id] && state.nodes[id].status, 'succeeded', `节点 ${id} 应成功`);
    }
    // bootstrap/spec-gate/verify/integrate 各一轮（attempt=1）。
    for (const id of ['bootstrap', 'spec-gate', 'verify', 'integrate']) {
      const node = state.nodes[id];
      assert.equal((node.history || []).length, 1, `${id} 应只执行一轮`);
      assert.equal((node.history || [])[0].executor, 'deterministic', `${id} 是确定性节点`);
    }
    // 确定性节点零 driver 调用：fake driver 记录里不得出现 bootstrap/spec-gate/verify/integrate。
    const calls = fs.existsSync(callsFile) ? fs.readFileSync(callsFile, 'utf8').split('\n').filter(Boolean) : [];
    for (const detId of ['bootstrap', 'spec-gate', 'verify', 'integrate']) {
      assert.ok(!calls.some((c) => c.includes(detId)), `确定性节点 ${detId} 不应经 driver 调用`);
    }
    // Agent 节点各一轮且用到 driver。
    for (const agentId of ['架构设计师', 'Rust 开发', 'Vue 开发', '测试角色', 'CR']) {
      assert.ok(calls.some((c) => c.includes(agentId)), `Agent 节点 ${agentId} 应经 driver 调用`);
    }
    // integrate 副作用唯一：一个 PR、一轮 CI、一次 merge。
    assert.equal(state.nodes.integrate.checkpoints['get-or-create-pr'].evidence.reused || false, false);
    assert.equal(state.summary.prCount, 1);
    assert.equal(state.summary.ciCount, 1);
    assert.equal(state.summary.mergeCount, 1);
    // 无人值守证明：结束摘要里无挂起/人工介入。
    assert.equal(state.summary.humanInterventions, 0);
    // 7.4 效率报告：注入基准 10s，e2e 总耗时远小于 6.5s → 满足 35% 降低；本地流程（不含 CI）≤ 15 分钟。
    assert.ok(state.summary.totalDurationMs < 10_000 * 0.65, `e2e 满足 35%：总耗时 ${state.summary.totalDurationMs}ms < 6500ms`);
    assert.ok(state.summary.postCodeLocalDurationMs <= 15 * 60_000, 'e2e 本地流程含 CI 目标 ≤15min');
    // 摘要落盘的结构字段齐全。
    for (const key of ['modelDurationMs', 'commandDurationMs', 'ciWaitMs', 'retryWasteMs', 'slowestStages', 'prCount', 'ciCount', 'mergeCount']) {
      assert.ok(key in state.summary, `summary 缺字段 ${key}`);
    }
  } finally {
    fake.cleanup();
    fs.rmSync(callsFile, { force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('metrics 7.2: domain=both 无人值守——resume 无新增副作用，verify 命中缓存', () => {
  const repo = tmpRepo();
  const fake = fakeCommands({ verify: true, gitRemote: true, ghFlat: true });
  const env = {
    ...process.env,
    PIPE_CORE_REPO_ROOT: repo,
    CLAUDECODE: '1',
    AI_AGENT: '',
    PIPE_CLAUDE_BIN: FAKE_BOTH,
    ...fake.env(),
  };
  try {
    const r1 = spawnSync(process.execPath, [RUNJS, 'demo'], { cwd: repo, encoding: 'utf8', env });
    assert.equal(r1.status, 0, `stderr=${r1.stderr}`);
    const state1 = JSON.parse(fs.readFileSync(path.join(repo, '.agents', 'runs', 'demo', 'state.json'), 'utf8'));
    const eventsFile = path.join(repo, '.agents', 'runs', 'demo', 'events.jsonl');
    const events1 = fs.readFileSync(eventsFile, 'utf8').trim().split('\n').filter(Boolean);
    const integrateSha = state1.nodes.integrate.commitSha;

    // --resume：全 succeeded 节点复用（除落地校验通过），verify 命中缓存，不重复副作用。
    const r2 = spawnSync(process.execPath, [RUNJS, 'demo', '--resume'], { cwd: repo, encoding: 'utf8', env });
    assert.equal(r2.status, 0, `resume stderr=${r2.stderr}`);
    const state2 = JSON.parse(fs.readFileSync(path.join(repo, '.agents', 'runs', 'demo', 'state.json'), 'utf8'));
    assert.equal(state2.nodes.integrate.commitSha, integrateSha, 'integrate 复用，不重跑');
    // events.jsonl 不重复（run 事件幂等 + attempt 幂等）。
    const events2 = fs.readFileSync(eventsFile, 'utf8').trim().split('\n').filter(Boolean);
    assert.equal(events2.length, events1.length, 'resume 不得追加重复事件');
  } finally {
    fake.cleanup();
    fs.rmSync(repo, { recursive: true, force: true });
  }
});