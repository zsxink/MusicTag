'use strict';
// 任务组 7 可观测性（7.1/7.4）：从逐 attempt 历史聚合运行摘要、慢阶段、重试浪费、
// PR/CI/merge 计数与效率目标校验；导出 events.jsonl 且失败→成功两次 attempt 均保留。
// 可控时钟：测试用手工构造的 ISO 时间戳（不用真实 Date.now），保证可复现。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');
const metrics = require('../metrics.js');
const stateApi = require('../state.js');

const T0 = 1_700_000_000_000; // 可控基准时钟（ms）
const iso = (ms) => new Date(ms).toISOString();

// 构造一个带确定性时间的运行中状态：dev 首次失败第二次成功，det 节点 & CI 时长已知。
// 串行时间线（相对 T0，ms）：dev 失败 100/T0+100 → dev 成功 80/T0+180 → cr 50/T0+230
// → tester 70/T0+300（挂起）→ verify 200/T0+500 → integrate 300/T0+800（内嵌 CI 等待 200）。
function stubState(repo) {
  const st = stateApi.newState('metrics-demo', 'mock', '1.0.0', '1.0.0');
  st.startedAt = iso(T0);
  st.change = 'metrics-demo';
  st.nodes = {
    dev: {
      status: 'succeeded',
      attempts: 2,
      history: [
        {
          node: 'dev', round: 1, attempt: 1, executor: 'agent', driver: 'mock', model: 'opensearch-5',
          startedAt: iso(T0), endedAt: iso(T0 + 100), durationMs: 100, status: 'failed',
          errorKind: 'timeout', exitCode: null, decision: 'retry', commands: [],
        },
        {
          node: 'dev', round: 1, attempt: 2, executor: 'agent', driver: 'mock', model: 'opensearch-5',
          startedAt: iso(T0 + 100), endedAt: iso(T0 + 180), durationMs: 80, status: 'succeeded',
          errorKind: null, exitCode: null, decision: undefined, commands: [], commitSha: 'abc123',
        },
      ],
    },
    cr: {
      status: 'succeeded',
      attempts: 1,
      history: [
        {
          node: 'cr', round: 1, attempt: 1, executor: 'agent', driver: 'mock', model: 'opensearch-5',
          startedAt: iso(T0 + 180), endedAt: iso(T0 + 230), durationMs: 50, status: 'succeeded',
        },
      ],
    },
    tester: {
      status: 'suspended',
      attempts: 1,
      history: [
        {
          node: 'tester', round: 1, attempt: 1, executor: 'agent', driver: 'mock', model: 'opensearch-5',
          startedAt: iso(T0 + 230), endedAt: iso(T0 + 300), durationMs: 70, status: 'suspended',
          errorKind: null, exitCode: null, decision: 'escalate',
        },
      ],
    },
    verify: {
      status: 'succeeded',
      attempts: 1,
      result: { pass: true, cacheHit: false, steps: [{ step: 'cargo check', status: 'pass', durationMs: 150 }] },
      history: [
        {
          node: 'verify', round: 1, attempt: 1, executor: 'deterministic', driver: 'mock',
          startedAt: iso(T0 + 300), endedAt: iso(T0 + 500), durationMs: 200, status: 'succeeded',
        },
      ],
    },
    integrate: {
      status: 'succeeded',
      attempts: 1,
      checkpoints: {
        'get-or-create-pr': { status: 'succeeded', evidence: { prUrl: 'https://github.com/x/y/pull/1', reused: false } },
        'wait-required-ci': { status: 'succeeded', startedAt: iso(T0 + 520), durationMs: 200 },
        merge: { status: 'succeeded', evidence: { merged: true } },
      },
      history: [
        {
          node: 'integrate', round: 1, attempt: 1, executor: 'deterministic', driver: 'mock',
          startedAt: iso(T0 + 500), endedAt: iso(T0 + 800), durationMs: 300, status: 'succeeded',
          commitSha: 'deadbeef',
        },
      ],
    },
  };
  st.updatedAt = iso(T0 + 800);
  return st;
}

function tmpRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-metrics-'));
  execSync('git init -q', { cwd: repo });
  execSync('git config user.email t@t && git config user.name t', { cwd: repo });
  fs.writeFileSync(path.join(repo, 'a.txt'), 'x');
  execSync('git add . && git commit -qm init', { cwd: repo });
  const prev = process.env.PIPE_CORE_REPO_ROOT;
  process.env.PIPE_CORE_REPO_ROOT = repo;
  return { repo, prev };
}

test('metrics 7.1: 摘要区分模型/命令/CI 等待/重试浪费并保留失败→成功两次 attempt', () => {
  const { repo, prev } = tmpRepo();
  try {
    const state = stubState(repo);
    const s = metrics.buildSummary(state);
    assert.equal(s.attemptCount, 6);
    assert.equal(s.modelDurationMs, 100 + 80 + 50 + 70, 'agent 节点耗时合计（含失败 attempt）');
    assert.equal(s.commandDurationMs, 200 + 300, 'deterministic 节点耗时合计 = 命令耗时');
    assert.equal(s.ciWaitMs, 200, 'CI 等待 = wait-required-ci checkpoint 时长');
    assert.equal(s.retryWasteMs, 100, '重试浪费 = 失败的 attempt 耗时（首次失败后成功仍可追溯）');
    assert.equal(s.totalDurationMs, 800, '总耗时 = 结束 - 开始');
    assert.equal(s.attemptCount, 6);
    assert.deepEqual(s.nodeOutcomes, { succeeded: 4, failed: 0, suspended: 1 });
  } finally {
    process.env.PIPE_CORE_REPO_ROOT = prev;
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('metrics 7.1: slowestStages 返回最慢三阶段且跳过无 history 节点', () => {
  const { repo, prev } = tmpRepo();
  try {
    const state = stubState(repo);
    // 追加一个无历史节点（resumed 单测常见），不得计入阶段分析。
    state.nodes.det = { status: 'succeeded', attempts: 0 };
    const s = metrics.buildSummary(state);
    assert.equal(s.slowestStages.length, 3);
    assert.equal(s.slowestStages[0].node, 'integrate');
    assert.equal(s.slowestStages[0].durationMs, 300);
    assert.equal(s.slowestStages[1].node, 'verify');
    assert.equal(s.slowestStages[1].durationMs, 200);
    assert.equal(s.slowestStages[2].node, 'dev');
    assert.equal(s.slowestStages[2].durationMs, 180);
  } finally {
    process.env.PIPE_CORE_REPO_ROOT = prev;
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('metrics 7.1: PR/CI/merge 次数与人工介入计数来自 integrate checkpoint/决断', () => {
  const { repo, prev } = tmpRepo();
  try {
    const state = stubState(repo);
    const s = metrics.buildSummary(state);
    assert.equal(s.prCount, 1, 'PR = get-or-create-pr succeeded');
    assert.equal(s.ciCount, 1, 'CI 轮次 = wait-required-ci succeeded');
    assert.equal(s.mergeCount, 1, 'merge = merge checkpoint succeeded');
    assert.equal(s.humanInterventions, 1, '人工介入 = escalate 决断计数（tester suspended）');
  } finally {
    process.env.PIPE_CORE_REPO_ROOT = prev;
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('metrics 7.1: exportEvents 导出 events.jsonl，失败与成功 attempt 均保留且字段齐全', async () => {
  const { repo, prev } = tmpRepo();
  try {
    const state = stubState(repo);
    const count = await metrics.exportEvents('metrics-demo', state);
    const file = path.join(repo, '.agents', 'runs', 'metrics-demo', 'events.jsonl');
    assert.ok(fs.existsSync(file), 'events.jsonl 应落盘');
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
    assert.equal(lines.length, count);
    const events = lines.map((l) => JSON.parse(l));
    // 失败→成功两次 attempt 均保留。
    const devEvents = events.filter((e) => e.node === 'dev');
    assert.equal(devEvents.length, 2);
    assert.equal(devEvents[0].status, 'failed');
    assert.equal(devEvents[1].status, 'succeeded');
    assert.equal(devEvents[0].errorKind, 'timeout');
    assert.equal(devEvents[0].decision, 'retry');
    assert.equal(devEvents[1].commitSha, 'abc123');
    // 字段齐全（spec「逐 attempt 可观测性」至少字段）。
    for (const key of ['node', 'round', 'attempt', 'driver', 'model', 'startedAt', 'endedAt', 'durationMs', 'errorKind', 'exitCode', 'decision', 'commitSha', 'cacheHit', 'ciWaitMs']) {
      assert.ok(key in devEvents[0] || key in devEvents[1], `events 缺字段 ${key}`);
    }
    // 顺序按 startedAt 稳定。
    assert.ok(events.every((e, i) => i === 0 || Date.parse(e.startedAt) >= Date.parse(events[i - 1].startedAt)));
  } finally {
    process.env.PIPE_CORE_REPO_ROOT = prev;
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('metrics 7.1: exportEvents 幂等——重复导出不产生重复事件', async () => {
  const { repo, prev } = tmpRepo();
  try {
    const state = stubState(repo);
    const a = await metrics.exportEvents('metrics-demo', state);
    const b = await metrics.exportEvents('metrics-demo', state);
    assert.ok(a > 0, '首次导出应写入事件');
    assert.equal(b, 0, 'resume 重复导出不得重复追加');
    const lines = fs.readFileSync(path.join(repo, '.agents', 'runs', 'metrics-demo', 'events.jsonl'), 'utf8').trim().split('\n').filter(Boolean).length;
    assert.equal(lines, a, '最终行数等于首次导出条数（无重复）');
  } finally {
    process.env.PIPE_CORE_REPO_ROOT = prev;
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('metrics 7.1: postCodeLocalDurationMs 不计 CI 等待（代码完成后本地流程）', () => {
  const { repo, prev } = tmpRepo();
  try {
    const state = stubState(repo);
    const s = metrics.buildSummary(state);
    // tester(70) + cr(50) + verify(200) + integrate(300) − CI 等待(200) = 420。
    assert.equal(s.postCodeLocalDurationMs, 70 + 50 + 200 + 300 - 200);
    assert.equal(s.postCodeLocalDurationMs, 420);
  } finally {
    process.env.PIPE_CORE_REPO_ROOT = prev;
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('metrics 7.4: checkEfficiency 输出 35% / 15 分钟目标判定（可控时钟/基准事件）', () => {
  const { repo, prev } = tmpRepo();
  try {
    const state = stubState(repo);
    const s = metrics.buildSummary(state);
    // 基准 = Issue #121 同等级样本总耗时（可控时钟注入，ms）。
    const baseline = 1_500;
    const rep = metrics.checkEfficiency(s, { baselineMs: baseline, postCodeLocalTargetMs: 15 * 60_000 });
    assert.equal(rep.meets35Pct, true, 'fixture 总耗时 800 ≤ 1500*0.65=975 → 满足 35% 降低');
    assert.equal(rep.meetsPostCodeLocalTarget, true, '350ms ≤ 15min');
    assert.ok(rep.reductionPct >= 35);
    // 反例：总耗时≥基准 → 不满足。
    const bad = { ...s, totalDurationMs: baseline };
    const rep2 = metrics.checkEfficiency(bad, { baselineMs: baseline });
    assert.equal(rep2.meets35Pct, false);
  } finally {
    process.env.PIPE_CORE_REPO_ROOT = prev;
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('metrics 7.1: finalizeRun 落盘 summary 并对 run 结束打印结构摘要', () => {
  const { repo, prev } = tmpRepo();
  try {
    const state = stubState(repo);
    const printed = [];
    const out = metrics.finalizeRun(state, { status: 'succeeded', log: (m) => printed.push(m) });
    assert.equal(out.summary.totalDurationMs, 800);
    // summary 落盘 state，可 loadState 读回。
    const loaded = stateApi.loadState('metrics-demo');
    assert.equal(loaded.summary.totalDurationMs, 800);
    assert.equal(loaded.summary.prCount, 1);
    // run 结束打印摘要：能区分模型、命令、CI 等待与重试耗时。
    const text = printed.join('\n');
    assert.match(text, /模型耗时/);
    assert.match(text, /命令耗时/);
    assert.match(text, /CI 等待/);
    assert.match(text, /重试浪费/);
    assert.match(text, /最慢.*integrate/);
    assert.match(text, /PR=\d.*CI=\d.*merge=\d/);
  } finally {
    process.env.PIPE_CORE_REPO_ROOT = prev;
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
test('metrics 7.4: summaryFromEvents 从 events.jsonl 重建可复现摘要（可控时钟基线事件）', async () => {
  const { repo, prev } = tmpRepo();
  try {
    const state = stubState(repo);
    await metrics.exportEvents('metrics-demo', state);
    const src = eventsSource(metrics, state);
    const s = metrics.summaryFromEvents(src);
    assert.equal(s.totalDurationMs, 800);
    assert.equal(s.modelDurationMs, 300);
    assert.equal(s.commandDurationMs, 500);
    assert.equal(s.retryWasteMs, 100);
    assert.equal(s.prCount, 0, 'events 无 checkpoints → PR 计数来自 run 事件/状态；events 摘要不含 checkpoint 计数');
    assert.equal(s.slowestStages.length, 3);
    assert.equal(s.slowestStages[0].node, 'integrate');
  } finally {
    process.env.PIPE_CORE_REPO_ROOT = prev;
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

function eventsSource(metrics, state) {
  const file = path.join(stateApi.runsDir(), 'metrics-demo', 'events.jsonl');
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
  const events = lines.map((l) => JSON.parse(l));
  return { events };
}
