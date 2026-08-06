'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');
const core = require('../core.js');
const decision = require('../decision.js');
const stateApi = require('../state.js');

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-core-'));
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email t@t && git config user.name t', { cwd: dir });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hello');
  execSync('git add . && git commit -qm init', { cwd: dir });
  return dir;
}

function withRoot(repo, fn) {
  const prev = process.env.PIPE_CORE_REPO_ROOT;
  process.env.PIPE_CORE_REPO_ROOT = repo;
  try { return fn(); }
  finally {
    if (prev === undefined) delete process.env.PIPE_CORE_REPO_ROOT;
    else process.env.PIPE_CORE_REPO_ROOT = prev;
  }
}

// 可编程 mock driver：script[nodeId] = (attempt) => { ok, structured }
function makeDriver(script) {
  const calls = [];
  const attempts = {};
  return {
    calls,
    runAgent(task, ctx) {
      calls.push(task.id);
      const n = (attempts[task.id] = (attempts[task.id] || 0) + 1);
      const fn = script[task.id];
      if (!fn) return { ok: false, error: `no script for ${task.id}` };
      return fn(n);
    },
  };
}

const node = (id, dependsOn, schema = { type: 'object' }) => ({ id, role: 'tester', prompt: 'p', schema, dependsOn });

test('core: DAG 按拓扑顺序执行全部节点', () => {
  const repo = tmpRepo();
  withRoot(repo, () => {
    const change = 'demo';
    const state = stateApi.newState(change, 'mock');
    const driver = makeDriver({
      n1: () => ({ ok: true, structured: { v: 1 } }),
      n2: () => ({ ok: true, structured: { v: 2 } }),
      n3: () => ({ ok: true, structured: { v: 3 } }),
    });
    const defs = [node('n3', ['n2']), node('n1', []), node('n2', ['n1'])];
    const res = core.runPipeline({ change, state, defsFn: () => defs, driver });
    assert.equal(res.status, 'success');
    assert.equal(results(res).n1.v, 1);
    assert.equal(results(res).n3.v, 3);
    const order = driver.calls;
    assert.ok(order.indexOf('n1') < order.indexOf('n2'));
    assert.ok(order.indexOf('n2') < order.indexOf('n3'));
  });
  fs.rmSync(repo, { recursive: true, force: true });
});

test('core: 失败节点 retry 后成功（attempts=2）', () => {
  const repo = tmpRepo();
  withRoot(repo, () => {
    const change = 'demo';
    const state = stateApi.newState(change, 'mock');
    const driver = makeDriver({
      n1: () => ({ ok: true, structured: { v: 1 } }),
      n2: (a) => (a === 1 ? { ok: false, error: 'transient' } : { ok: true, structured: { v: 2 } }),
    });
    const defs = [node('n1', []), Object.assign(node('n2', ['n1']), { retry: { max: 2, intervalMs: 0 } })];
    const res = core.runPipeline({ change, state, defsFn: () => defs, driver });
    assert.equal(res.status, 'success');
    assert.equal(state.nodes.n2.attempts, 2);
  });
  fs.rmSync(repo, { recursive: true, force: true });
});

test('core: retry 耗尽仍失败 → escalate 挂起', () => {
  const repo = tmpRepo();
  withRoot(repo, () => {
    const change = 'demo';
    const state = stateApi.newState(change, 'mock');
    const driver = makeDriver({
      n1: () => ({ ok: false, error: 'always fails' }),
    });
    const defs = [Object.assign(node('n1', []), { retry: { max: 1, intervalMs: 0 } })];
    const res = core.runPipeline({ change, state, defsFn: () => defs, driver });
    assert.equal(res.status, 'suspended');
    assert.equal(res.decision.action, 'escalate');
  });
  fs.rmSync(repo, { recursive: true, force: true });
});

test('core: CR 内容问题 reroute → 派修复子节点 → 复审通过', () => {
  const repo = tmpRepo();
  withRoot(repo, () => {
    const change = 'demo';
    const state = stateApi.newState(change, 'mock');
    const crScript = {
      cr: (a) => (a === 1
        ? { ok: true, structured: { pass: false, blockers: [{ severity: 'blocking', file: 'src/App.vue', issue: 'x', specReference: 's', suggestion: 'f' }], majors: [] } }
        : { ok: true, structured: { pass: true, blockers: [], majors: [], minors: [] } }),
      'fix-vue-frontend': () => ({ ok: true, structured: { done: true, summary: 'fixed' } }),
    };
    const driver = makeDriver(crScript);
    const defs = [Object.assign(node('cr', []), { role: 'cr-agent', maxRounds: 3, retry: { max: 1, intervalMs: 0 }, resultOk: (r) => r.pass === true })];
    const res = core.runPipeline({ change, state, defsFn: () => defs, driver });
    assert.equal(res.status, 'success');
    assert.equal(state.nodes.cr.attempts, 2);
    assert.ok(driver.calls.includes('fix-vue-frontend'));
  });
  fs.rmSync(repo, { recursive: true, force: true });
});

test('core: CR 三轮不过 → escalate 挂起交主会话', () => {
  const repo = tmpRepo();
  withRoot(repo, () => {
    const change = 'demo';
    const state = stateApi.newState(change, 'mock');
    const driver = makeDriver({
      cr: () => ({ ok: true, structured: { pass: false, blockers: [{ severity: 'blocking', file: 'x', issue: 'i', specReference: 's', suggestion: 'f' }], majors: [] } }),
      'fix-leader': () => ({ ok: true, structured: { done: true, summary: 'fixed' } }),
    });
    const defs = [Object.assign(node('cr', []), { role: 'cr-agent', maxRounds: 3, retry: { max: 1, intervalMs: 0 }, resultOk: (r) => r.pass === true })];
    const res = core.runPipeline({ change, state, defsFn: () => defs, driver });
    assert.equal(res.status, 'suspended');
    assert.match(res.reason, /三轮未通过/);
  });
  fs.rmSync(repo, { recursive: true, force: true });
});

test('core: resume 集成——失败节点重跑、已通过节点复用（落地校验）', () => {
  const repo = tmpRepo();
  withRoot(repo, () => {
    const change = 'demo';
    const state = stateApi.newState(change, 'mock');
    let n2fails = true;
    const driver = makeDriver({
      n1: () => ({ ok: true, structured: { v: 1 } }),
      n2: () => (n2fails ? { ok: false, error: 'boom' } : { ok: true, structured: { v: 2 } }),
      n3: () => ({ ok: true, structured: { v: 3 } }),
    });
    const defs = [node('n1', []), node('n2', ['n1']), node('n3', ['n2'])];

    // 第一轮：n1 成功、n2 失败 → escalate 挂起
    const res1 = core.runPipeline({
      change,
      state,
      defsFn: () => defs,
      driver,
      getHead: () => execSync('git rev-parse HEAD', { cwd: repo, encoding: 'utf8' }).trim(),
    });
    assert.equal(res1.status, 'suspended');
    assert.equal(state.nodes.n1.status, 'succeeded');
    assert.equal(state.nodes.n2.status, 'failed');

    // 修复 n2，resume：复用已通过 n1，只重跑失败 n2 + 依赖 n3
    n2fails = false;
    driver.calls.length = 0;
    stateApi.validateLandings(state);
    const res2 = core.runPipeline({
      change,
      state,
      defsFn: () => defs,
      driver,
      getHead: () => execSync('git rev-parse HEAD', { cwd: repo, encoding: 'utf8' }).trim(),
    });
    assert.equal(res2.status, 'success');
    assert.deepEqual(driver.calls, ['n2', 'n3'], 'resume 只重跑失败/未完成节点，已通过节点复用');
  });
  fs.rmSync(repo, { recursive: true, force: true });
});

// 从调度结果提取结果的辅助（core 把结果放进传入的 results 对象）
function results(res) {
  return res.results || {};
}
