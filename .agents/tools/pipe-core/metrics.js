'use strict';
// 任务组 7：可观测性与运行摘要（7.1/7.4）。
// 从 state v3 的逐 attempt 事件（node.history[]）、integrate checkpoints、决断事件聚合，
// 输出结构化运行摘要：总耗时、模型/命令/CI 等待/重试浪费分类耗时、最慢三阶段、
// PR/CI/merge 次数与人工介入计数；并导出不可覆盖的 events.jsonl。
// 可控时钟友好：一切时间来自 state 里的 ISO 时间戳（测试用手工构造），不依赖 Date.now 重放。

const fs = require('node:fs');
const path = require('node:path');
const stateApi = require('./state.js');

// ---------- 聚合 ----------

function isoMs(value) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

// 从 state 聚合运行摘要。
// 返回：
//   attemptCount          —— 全部 attempt 事件数
//   startedAt/endedAt     —— run 起止
//   totalDurationMs       —— ended − started
//   modelDurationMs       —— agent 节点耗时合计（含失败 attempt；模型是主要耗时）
//   commandDurationMs     —— deterministic 节点耗时合计（命令/脚本执行）
//   ciWaitMs              —— wait-required-ci checkpoint 时长
//   retryWasteMs          —— 失败 attempt 的耗时合计（重试浪费）
//   postCodeLocalDurationMs —— 本地流程开销：CR+Verify+Integrate 减去 CI 等待（35% 目标基准）
//   slowestStages         —— 最慢 3 个节点（按其 history 总耗时）
//   prCount/ciCount/mergeCount —— integrate checkpoint 副作用计数
//   humanInterventions    —— 人工介入计数（escalate/suspend 决断）
//   nodeOutcomes          —— { succeeded, failed, suspended } 各终态节点数
function buildSummary(state) {
  const startMs = isoMs((state && state.startedAt) || null);
  const endMs = isoMs((state && state.updatedAt) || null);
  const nodes = (state && state.nodes) || {};
  const nowMs = Date.now();

  let attemptCount = 0;
  let modelDurationMs = 0;
  let commandDurationMs = 0;
  let retryWasteMs = 0;
  let humanInterventions = 0;
  const nodeOutcomes = { succeeded: 0, failed: 0, suspended: 0 };
  const perNodeDuration = new Map();
  let ciWaitMs = 0;
  let prCount = 0;
  let ciCount = 0;
  let mergeCount = 0;

  for (const [id, node] of Object.entries(nodes)) {
    const history = Array.isArray(node.history) ? node.history : [];
    let nodeDur = 0;
    let nodeCiWait = 0;
    for (const h of history) {
      if (!Number.isFinite(h.durationMs)) continue;
      attemptCount++;
      nodeDur += h.durationMs;
      if (h.status === 'failed' && !h.legacy) retryWasteMs += h.durationMs;
      if (h.executor === 'agent' || (h.executor === undefined && node.history.length && h.attempt !== undefined)) modelDurationMs += h.durationMs;
      if (h.executor === 'deterministic') commandDurationMs += h.durationMs;
      if (h.decision === 'escalate' || h.decision === 'abort') humanInterventions++;
      // 每个 attempt 独立计数（含失败→成功）
    }
    // CI 等待：integrate 的 wait-required-ci checkpoint（durationMs 无则按 startedAt→下一个 checkpoint）。
    const cp = (node.checkpoints && node.checkpoints['wait-required-ci']) || null;
    if (cp && cp.status === 'succeeded') {
      ciCount++;
      if (Number.isFinite(cp.durationMs)) {
        nodeCiWait += cp.durationMs;
      } else if (cp.startedAt) {
        const from = isoMs(cp.startedAt);
        const nextCp = nextCheckpointStart(node, 'wait-required-ci');
        const to = nextCp ? isoMs(nextCp.startedAt) : endMs || nowMs;
        if (from && to) nodeCiWait += Math.max(0, to - from);
      }
      ciWaitMs += nodeCiWait;
    }
    if (node.checkpoints && node.checkpoints['get-or-create-pr'] && node.checkpoints['get-or-create-pr'].status === 'succeeded') prCount++;
    if (node.checkpoints && node.checkpoints.merge && node.checkpoints.merge.status === 'succeeded') mergeCount++;

    if (nodeDur > 0) perNodeDuration.set(id, { node: id, durationMs: nodeDur, ciWaitMs: nodeCiWait });
    if (['succeeded', 'failed', 'suspended'].includes(node.status)) nodeOutcomes[node.status]++;
  }

  const slowestStages = [...perNodeDuration.entries()]
    .sort((a, b) => (b[1].durationMs - a[1].durationMs) || String(a[0]).localeCompare(String(b[0])))
    .slice(0, 3)
    .map(([, v]) => v);

  // postCodeLocalDurationMs：代码完成后的本地流程（spec「不含 CI ≤15min」）。
  // 代码完成后 = tester + cr + verify + integrate 的本地耗时，减去 CI 等待。
  const codeDoneStages = ['tester', 'cr', 'verify', 'integrate'];
  const postCodeLocalDurationMs = codeDoneStages
    .map((id) => perNodeDuration.get(id))
    .filter(Boolean)
    .reduce((sum, s) => sum + Math.max(0, s.durationMs - (s.ciWaitMs || 0)), 0);

  const totalDurationMs = startMs && endMs ? Math.max(0, endMs - startMs) : 0;
  const endedAt = endMs ? new Date(endMs).toISOString() : null;
  return {
    attemptCount,
    startedAt: (state && state.startedAt) || null,
    endedAt,
    totalDurationMs,
    modelDurationMs,
    commandDurationMs,
    ciWaitMs,
    retryWasteMs,
    postCodeLocalDurationMs,
    slowestStages,
    prCount,
    ciCount,
    mergeCount,
    humanInterventions,
    nodeOutcomes,
    summarySource: 'state-v3-history',
  };
}

// 返回 wait-required-ci 之后第一个有 startedAt 的 checkpoint（估算 CI 等待结束点）。
function nextCheckpointStart(node, name) {
  const names = Object.keys(node.checkpoints || {}).sort();
  const idx = names.indexOf(name);
  if (idx < 0) return null;
  for (let i = idx + 1; i < names.length; i++) {
    if (node.checkpoints[names[i]].startedAt) return node.checkpoints[names[i]];
  }
  return null;
}

// 效率目标判定（7.4）：相对基准样本 ≥35% 降低 + 代码完成后本地流程 ≤15min。
// 可控时钟友好：baselineMs / postCodeLocalTargetMs 均为显式注入的基准（毫秒）。
function checkEfficiency(summary, { baselineMs = Infinity, postCodeLocalTargetMs = 15 * 60_000 } = {}) {
  const reductionPct = baselineMs > 0 ? Math.max(0, Math.round((1 - summary.totalDurationMs / baselineMs) * 1000) / 10) : 0;
  const meets35Pct = Number.isFinite(baselineMs) && summary.totalDurationMs <= baselineMs * 0.65;
  const meetsPostCodeLocalTarget = summary.postCodeLocalDurationMs <= postCodeLocalTargetMs;
  return {
    baselineMs,
    totalDurationMs: summary.totalDurationMs,
    postCodeLocalDurationMs: summary.postCodeLocalDurationMs,
    reductionPct,
    meets35Pct,
    meetsPostCodeLocalTarget,
    postCodeLocalTargetMs,
  };
}

// 人类可读摘要打印（run 结束）：能区分模型、命令、CI 等待、重试耗时，输出最慢三阶段与 PR/CI/merge 次数。
function formatSummary(summary, extra = '') {
  const lines = [
    `总耗时 ${summary.totalDurationMs}ms（attempt=${summary.attemptCount}，node 终态=${JSON.stringify(summary.nodeOutcomes)}）`,
    `模型耗时 ${summary.modelDurationMs}ms · 命令耗时 ${summary.commandDurationMs}ms · CI 等待 ${summary.ciWaitMs}ms · 重试浪费 ${summary.retryWasteMs}ms`,
    `最慢阶段：${summary.slowestStages.map((s) => `${s.node}(${s.durationMs}ms)`).join(' → ')}`,
    `PR=${summary.prCount} CI=${summary.ciCount} merge=${summary.mergeCount} · 人工介入 ${summary.humanInterventions}`,
  ];
  if (extra) lines.push(extra);
  return lines.join('\n');
}

// ---------- events.jsonl 导出 ----------

// 从 events.jsonl 重建运行摘要（7.4：基准事件生成可复现的性能报告）。
// events 数组：逐行 JSON（含 run 元事件与逐 attempt 事件）。
// 与 buildSummary 的差异：events 不含 checkpoints 映射，因此 PR/CI/merge 计数取 0，
// CI 等待从事件里带 ciWaitMs 字段的 attempt（integrate）累计；命令/模型按 executor 区分。
function summaryFromEvents({ events = [] } = {}) {
  const runEv = events.find((e) => e && e.type === 'run') || null;
  const attempts = events.filter((e) => e && e.type !== 'run');
  let attemptCount = 0;
  let modelDurationMs = 0;
  let commandDurationMs = 0;
  let retryWasteMs = 0;
  let humanInterventions = 0;
  let ciWaitMs = 0;
  const perNodeDuration = new Map();
  const nodeOutcomes = { succeeded: 0, failed: 0, suspended: 0 };

  for (const h of attempts) {
    if (!Number.isFinite(h.durationMs)) continue;
    attemptCount++;
    if (h.humanIntervention === true) humanInterventions++;
    if (h.executor === 'agent') modelDurationMs += h.durationMs;
    else if (h.executor === 'deterministic') commandDurationMs += h.durationMs;
    if (h.status === 'failed') retryWasteMs += h.durationMs;
    if (Number.isFinite(h.ciWaitMs)) ciWaitMs += h.ciWaitMs;
    if (h.status && h.status in nodeOutcomes) nodeOutcomes[h.status]++;
    perNodeDuration.set(h.node, (perNodeDuration.get(h.node) || 0) + h.durationMs);
  }
  const slowestStages = [...perNodeDuration.entries()]
    .sort((a, b) => (b[1] - a[1]) || String(a[0]).localeCompare(String(b[0])))
    .slice(0, 3)
    .map(([node, durationMs]) => ({ node, durationMs }));

  const startMs = runEv ? isoMs(runEv.startedAt) : null;
  const endMs = runEv ? isoMs(runEv.endedAt) : null;
  const postCodeLocalDurationMs = ['tester', 'cr', 'verify', 'integrate']
    .map((node) => ({ node, dur: perNodeDuration.get(node) || 0, ci: attempts.filter((a) => a.node === node).reduce((s, a) => s + (Number.isFinite(a.ciWaitMs) ? a.ciWaitMs : 0), 0) }))
    .reduce((sum, s) => sum + Math.max(0, s.dur - s.ci), 0);

  return {
    attemptCount,
    startedAt: runEv ? runEv.startedAt : null,
    endedAt: runEv ? runEv.endedAt : null,
    totalDurationMs: startMs && endMs ? Math.max(0, endMs - startMs) : 0,
    modelDurationMs,
    commandDurationMs,
    ciWaitMs,
    retryWasteMs,
    postCodeLocalDurationMs,
    slowestStages,
    prCount: 0,
    ciCount: 0,
    mergeCount: 0,
    humanInterventions,
    nodeOutcomes,
    summarySource: 'events.jsonl',
  };
}

// 把 state 中不可覆盖的事件落盘为 .agents/runs/<change>/events.jsonl（逐行 JSON）。
// 幂等：已落盘的事件（按 node+attempt 指纹）不重复追加；返回本次实际写入条数。
// 事件覆盖规格「逐 attempt 可观测性」至少字段：
//   node, round, attempt, driver/model, startedAt/endedAt, durationMs, errorKind,
//   exitCode, decision, commitSha, cacheHit, ciWaitMs, humanIntervention。
function exportEvents(change, state) {
  const file = path.join(stateApi.runsDir(), change, 'events.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const existing = fs.existsSync(file)
    ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];
  const seen = new Set(existing.map((e) => `${e.node}:${e.attempt}`));
  // 追加型：run 级元事件 + 逐 attempt 事件（保持 startedAt 单调）。
  const out = [];
  out.push({
    type: 'run', change, node: '*run', attempt: 1,
    driver: state.driver || null, model: null,
    startedAt: state.startedAt || null, endedAt: state.updatedAt || null,
    humanInterventions: state.humanInterventions ? state.humanInterventions.length : 0,
  });
  for (const [nodeId, node] of Object.entries(state.nodes || {})) {
    for (const h of Array.isArray(node.history) ? node.history : []) {
      const key = `${nodeId}:${h.attempt}`;
      if (h.legacy || seen.has(key)) continue;
      const cp = node.checkpoints || {};
      out.push({
        node: nodeId,
        round: h.round != null ? h.round : null,
        attempt: h.attempt,
        executor: h.executor || null,
        driver: h.driver || state.driver || null,
        model: h.model || null,
        startedAt: h.startedAt || null,
        endedAt: h.endedAt || null,
        durationMs: h.durationMs != null ? h.durationMs : null,
        errorKind: h.errorKind || null,
        exitCode: h.exitCode != null ? h.exitCode : null,
        decision: h.decision || null,
        commitSha: h.commitSha || node.commitSha || null,
        cacheHit: (node.result && node.result.cacheHit === true) || false,
        ciWaitMs: cp['wait-required-ci'] ? (cp['wait-required-ci'].durationMs || null) : null,
        humanIntervention: h.decision === 'escalate' || h.decision === 'abort',
        status: h.status || node.status || null,
      });
    }
  }
  const appended = [];
  for (const event of out) {
    const key = `${event.node}:${event.attempt}`;
    if (event.type === 'run' && seen.has(key)) continue;
    if (event.type !== 'run' && seen.has(key)) continue;
    appended.push(event);
    seen.add(key);
  }
  if (appended.length) {
    const body = appended.map((e) => JSON.stringify(e)).join('\n');
    fs.appendFileSync(file, (existing.length ? '\n' : '') + body + '\n');
  }
  return appended.length;
}

// run 结束统一收尾：落盘 summary、导出 events.jsonl、打印结构摘要。
// ctx: { status: 'success'|'failed'|'suspended', log(msg), baselineMs?, postCodeLocalTargetMs? }
// 返回 { summary, eventsWritten, report }。
function finalizeRun(state, ctx = {}) {
  const log = ctx.log || console.error;
  const summary = buildSummary(state);
  stateApi.setSummary(state, summary);
  stateApi.saveState(state.change, state);
  let eventsWritten = 0;
  try {
    eventsWritten = exportEvents(state.change, state);
  } catch (e) {
    log(`⚠ 导出 events.jsonl 失败：${e.message}（不阻塞 run 结束）`);
  }
  const eff = checkEfficiency(summary, {
    baselineMs: ctx.baselineMs !== undefined ? ctx.baselineMs : process.env.PIPE_BASELINE_MS ? Number(process.env.PIPE_BASELINE_MS) : Infinity,
    postCodeLocalTargetMs: ctx.postCodeLocalTargetMs !== undefined ? ctx.postCodeLocalTargetMs : 15 * 60_000,
  });
  log(formatSummary(summary));
  log(`效率目标：${eff.meets35Pct ? '✓' : '✗'} 相对基准 ${eff.baselineMs}ms 降低 ${eff.reductionPct}%（目标 ≥35%）· ` +
    `${eff.meetsPostCodeLocalTarget ? '✓' : '✗'} 本地流程 ${eff.postCodeLocalDurationMs}ms（目标 ≤${eff.postCodeLocalTargetMs}ms 不含 CI）`);
  return { summary, eventsWritten, efficiency: eff };
}

module.exports = { buildSummary, summaryFromEvents, checkEfficiency, formatSummary, exportEvents, finalizeRun };