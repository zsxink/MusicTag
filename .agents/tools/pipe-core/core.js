'use strict';
// DAG 调度器 + 状态机（就绪集计算、≤N 并发池、条件边/动态图、driver 调用）。
// 消费数据驱动的节点定义（pipeline.js），动态图：architect 判定 domain 后开发节点才展开。
// 失败 → 路由 decision.js 决断链（retry / reroute / escalate / abort），D6 用户决策一律挂起。

const { validateNode, topoSort } = require('./dag.js');
const { validate } = require('./schema.js');
const stateApi = require('./state.js');
const decision = require('./decision.js');
const { DEV_SCHEMA } = require('./pipeline.js');

// 同步调度器内的退避等待（CLI 场景可阻塞；intervalMs=0 时零开销）。
function sleepSync(ms) {
  if (!ms) return;
  const end = Date.now() + ms;
  while (Date.now() < end) { /* busy wait */ }
}

function runPipeline(opts) {
  const {
    change,
    state,
    defsFn,
    driver,
    ctx = {},
    decider,
    logger = null,
    maxConcurrency = 3,
    sleep = sleepSync,
    getHead = stateApi.currentHead,
    results = {},
  } = opts;

  const log = (msg) => { if (logger) logger(msg); };
  const runCtx = { change, ctx, state, driver, getHead, log, sleep, results };

  let guard = 0;
  const maxIterations = 1000;

  while (guard++ < maxIterations) {
    const defs = defsFn(state);
    for (const d of defs) {
      const errs = validateNode(d);
      if (errs.length) throw new Error(`节点定义非法: ${errs.join('; ')}`);
    }
    topoSort(defs); // 环/缺失依赖抛错

    // 失败节点级联失效（DVC，spec「失败节点缓存失效」）：状态加载/落地校验后标记 failed 的节点，
    // 其依赖它的已通过节点也被标记 dirty → 续跑强制真实重跑，不复用被污染的旧结果；
    // 未受污染的已通过节点保持 succeeded 直接复用。同步调度（runNode 不让出循环）下无 running 窗口。
    for (const d of defs) {
      const s = state.nodes[d.id];
      if (s && s.status === 'failed') stateApi.markDirty(state, defs, d.id);
    }

    const pending = defs.filter((d) => {
      const s = state.nodes[d.id];
      return !s || s.status !== 'succeeded';
    });
    if (!pending.length) break;

    const ready = pending.filter((d) => {
      const deps = d.dependsOn || [];
      return deps.every((dep) => {
        const ds = state.nodes[dep];
        return ds && ds.status === 'succeeded';
      });
    });
    if (!ready.length) {
      return { status: 'failed', stage: 'dag-stall', reason: `DAG 停滞：无就绪节点（pending=[${pending.map((d) => d.id).join(',')}]）`, results };
    }

    const batch = ready.slice(0, maxConcurrency);
    for (const def of batch) {
      const res = runNode(def, runCtx, decider);
      if (res.status === 'suspended' || res.status === 'failed') return res;
    }
  }

  const finalDefs = defsFn(state);
  const allSucceeded = finalDefs.every((d) => state.nodes[d.id] && state.nodes[d.id].status === 'succeeded');
  return { status: allSucceeded ? 'success' : 'failed', stage: 'not-all-succeeded', results };
}

// 单个节点执行：running → succeeded | failed → 决断链（retry 同轮重跑 / reroute 派修复复审 / escalate 挂起）。
// 语义：round 计复审轮（CR 每次 reroute 修复后进入下一轮）；attempt 计 driver 调用总次数。
// 技术性失败在同一 round 内 retry，不消耗 round。
function runNode(def, runCtx, decider) {
  const { change, state, driver, getHead, log, sleep, results } = runCtx;
  const id = def.id;
  const maxRounds = def.maxRounds || 1;
  const retryInterval = (def.retry && def.retry.intervalMs) || 0;
  let round = 0;
  let attempts = (state.nodes[id] && state.nodes[id].attempts) || 0;
  let errText = '';

  while (round < maxRounds) {
    round++;
    let d;
    // 同一 round 内可多次 retry（技术性失败不消耗 round）
    for (;;) {
      attempts++;
      state.nodes[id] = { status: 'running', attempts, updatedAt: new Date().toISOString() };
      stateApi.saveState(change, state);
      log(`→ ${id}（round ${round}/${maxRounds}，attempt ${attempts}）`);

      const task = {
        id,
        role: def.role,
        prompt: typeof def.prompt === 'function' ? def.prompt(runCtx.ctx) : def.prompt,
        schema: def.schema,
      };
      let res;
      try {
        res = driver.runAgent(task, { ...runCtx.ctx, nodeId: id });
      } catch (e) {
        res = { ok: false, error: String(e) };
      }

      // 核心二次 schema 校验（不信任模型自报结构）
      if (res.ok && res.structured && def.schema) {
        const v = validate(def.schema, res.structured);
        if (!v.valid) {
          res = { ok: false, error: `输出未通过 schema 二次校验: ${v.errors.join('; ')}` };
        }
      }

      // 语义成功：schema 合法 且 def.resultOk 判定通过（CR/VERIFY 的 pass、TESTER 的 smokePassed）
      if (res.ok && res.structured) {
        const ok = def.resultOk ? def.resultOk(res.structured) : true;
        if (ok) {
          const head = getHead();
          state.nodes[id] = {
            status: 'succeeded',
            attempts,
            result: res.structured,
            commitSha: head,
            cacheKey: stateApi.cacheKey(id, def.schema ? JSON.stringify(def.schema) : '', head),
          };
          stateApi.saveState(change, state);
          results[id] = res.structured;
          log(`✓ ${id} 成功`);
          return { status: 'succeeded', node: id, result: res.structured };
        }
      }

      // 失败（技术性或语义性）→ 决断链
      errText = res.error || `driver 失败（exitCode=${res.exitCode}）`;
      state.nodes[id] = {
        status: 'failed', attempts, error: errText,
        result: res.structured || null, updatedAt: new Date().toISOString(),
      };
      stateApi.saveState(change, state);
      log(`✗ ${id} 失败: ${errText}`);

      const decisionCtx = { def, attempts, error: errText, result: res.structured || null, round, maxRounds, ctx: runCtx.ctx };
      d = decider ? decider(decisionCtx) : decision.decide(decisionCtx);

      if (d.action === 'retry') {
        if (retryInterval > 0) sleep(retryInterval);
        continue; // 同一 round 重跑
      }
      break; // reroute / escalate / abort → 退出内层循环处理
    }

    if (d.action === 'reroute') {
      const fixOk = dispatchFixes(d.problems || [], runCtx);
      if (!fixOk) {
        return {
          status: 'suspended', stage: 'reroute-fix-failed', node: id,
          reason: 'reroute 修复子节点执行失败', decision: d, error: errText, results,
        };
      }
      continue; // 进入下一复审轮
    }
    // escalate / abort → 挂起回主会话
    return {
      status: 'suspended', stage: 'decision-escalate', node: id,
      reason: d.reason, decision: d, error: errText, results,
    };
  }

  return { status: 'suspended', stage: 'max-rounds', node: id, reason: `节点 ${id} 超过 maxRounds=${maxRounds}`, results };
}

// reroute：按文件所有权把 CR 问题分组，派对应角色修复子节点（只修该范围，返回 done=true）。
function dispatchFixes(problems, runCtx) {
  const { driver, log, results } = runCtx;
  const groups = new Map();
  for (const p of problems) {
    const owner = decision.ownerFor(p.file);
    if (!groups.has(owner.role)) groups.set(owner.role, { scope: owner.scope, problems: [] });
    groups.get(owner.role).problems.push(p);
  }
  for (const [role, group] of groups) {
    const fixId = `fix-${role}`;
    const fixTask = {
      id: fixId,
      role,
      prompt: `你是 ${decision.roleLabel(role)}。只修复 ${group.scope} 中以下 CR 问题，` +
        `不得修改其他范围；修复后运行受影响测试并返回 done=true：\n${JSON.stringify(group.problems)}`,
      schema: DEV_SCHEMA,
    };
    let res;
    try {
      res = driver.runAgent(fixTask, { ...runCtx.ctx, nodeId: fixId });
    } catch (e) {
      res = { ok: false, error: String(e) };
    }
    if (!res.ok || !res.structured || res.structured.done !== true) {
      log(`✗ 修复子节点 ${fixId} 失败: ${res.error || '未返回 done=true'}`);
      return false;
    }
    results[fixId] = res.structured;
    log(`✓ 修复子节点 ${fixId} 完成`);
  }
  return true;
}

module.exports = { runPipeline, runNode, dispatchFixes };
