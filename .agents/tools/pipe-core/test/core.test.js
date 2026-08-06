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

// ---------- 失败路径与边界（除 happy-path 外强制审计） ----------

test('core: 核心不认识模型——同一 DAG 内 claude 与 codex 节点走同一调度，仅 driver 层不同', () => {
  const repo = tmpRepo();
  withRoot(repo, () => {
    const claudeDrv = require('../drivers/claude.js');
    const codexDrv = require('../drivers/codex.js');
    const FAKE_CLAUDE = path.join(__dirname, 'fixtures', 'fake-claude.js');
    const FAKE_CODEX = path.join(__dirname, 'fixtures', 'fake-codex.js');
    const SCHEMA = { type: 'object', properties: { v: { type: 'number' } }, required: ['v'] };
    // 复合 driver：n1 走真实 claude driver，n2 走真实 codex driver；核心无模型专属分支
    const composite = {
      runAgent(task, ctx) {
        if (task.id === 'n1') {
          return claudeDrv.runAgent(task, { claudeBin: FAKE_CLAUDE, env: { ...process.env, FAKE_OUTPUT: JSON.stringify({ type: 'result', structured: { v: 1 } }) } });
        }
        return codexDrv.runAgent(task, { codexBin: FAKE_CODEX, env: { ...process.env, FAKE_OUTPUT: JSON.stringify({ v: 2 }) } });
      },
    };
    const change = 'demo';
    const state = stateApi.newState(change, 'mock');
    const defs = [
      Object.assign(node('n1', [], SCHEMA), { retry: { max: 1, intervalMs: 0 } }),
      Object.assign(node('n2', ['n1'], SCHEMA), { retry: { max: 1, intervalMs: 0 } }),
    ];
    const res = core.runPipeline({ change, state, defsFn: () => defs, driver: composite });
    assert.equal(res.status, 'success');
    assert.equal(results(res).n1.v, 1);
    assert.equal(results(res).n2.v, 2);
    assert.equal(state.nodes.n1.status, 'succeeded');
    assert.equal(state.nodes.n2.status, 'succeeded');
  });
  fs.rmSync(repo, { recursive: true, force: true });
});

test('core: driver 输出违反 schema（二次校验失败）→ 节点失败 → 重试耗尽 escalate', () => {
  const repo = tmpRepo();
  withRoot(repo, () => {
    const change = 'demo';
    const state = stateApi.newState(change, 'mock');
    const driver = makeDriver({
      n1: () => ({ ok: true, structured: { wrong: 1 } }), // 缺必填 v
    });
    const defs = [Object.assign(node('n1', [], { type: 'object', properties: { v: { type: 'number' } }, required: ['v'] }), { retry: { max: 1, intervalMs: 0 } })];
    const res = core.runPipeline({ change, state, defsFn: () => defs, driver });
    assert.equal(res.status, 'suspended');
    assert.equal(res.decision.action, 'escalate');
    assert.match(state.nodes.n1.error, /schema 二次校验/);
  });
  fs.rmSync(repo, { recursive: true, force: true });
});

test('core: driver 抛异常 → 节点失败，不使调度崩溃', () => {
  const repo = tmpRepo();
  withRoot(repo, () => {
    const change = 'demo';
    const state = stateApi.newState(change, 'mock');
    const throwing = { runAgent() { throw new Error('driver crashed'); } };
    const defs = [Object.assign(node('n1', []), { retry: { max: 1, intervalMs: 0 } })];
    const res = core.runPipeline({ change, state, defsFn: () => defs, driver: throwing });
    assert.equal(res.status, 'suspended');
    assert.equal(res.decision.action, 'escalate');
    assert.match(state.nodes.n1.error, /driver crashed/);
  });
  fs.rmSync(repo, { recursive: true, force: true });
});

test('core: reroute 修复子节点失败 → 挂起 stage=reroute-fix-failed', () => {
  const repo = tmpRepo();
  withRoot(repo, () => {
    const change = 'demo';
    const state = stateApi.newState(change, 'mock');
    const driver = makeDriver({
      cr: () => ({ ok: true, structured: { pass: false, blockers: [{ severity: 'blocking', file: 'src/App.vue', issue: 'i', specReference: 's', suggestion: 'f' }], majors: [] } }),
      'fix-vue-frontend': () => ({ ok: true, structured: { done: false, summary: 'failed to fix' } }), // 未返回 done=true
    });
    const defs = [Object.assign(node('cr', []), { role: 'cr-agent', maxRounds: 3, retry: { max: 1, intervalMs: 0 }, resultOk: (r) => r.pass === true })];
    const res = core.runPipeline({ change, state, defsFn: () => defs, driver });
    assert.equal(res.status, 'suspended');
    assert.equal(res.stage, 'reroute-fix-failed');
    assert.match(res.reason, /reroute 修复子节点执行失败/);
  });
  fs.rmSync(repo, { recursive: true, force: true });
});

test('core: 落地校验失效后依赖它的已通过节点续跑被污染（失败节点缓存失效，spec 要求强制重跑）', () => {
  const repo = tmpRepo();
  withRoot(repo, () => {
    const change = 'demo';
    const state = stateApi.newState(change, 'mock');
    let av = 1;
    // B 是「写盘开发节点」：每次重跑产生一次真实 commit → 新 HEAD；getHead 才能观测到差异。
    // 落地校验不信任节点自报 done，commitSha 必须落到真实 git 历史才能被 validateLandings 认可。
    let bRuns = 0;
    const driver = makeDriver({
      A: () => ({ ok: true, structured: { v: av++ } }),
      B: () => {
        bRuns++;
        fs.writeFileSync(path.join(repo, 'b.txt'), `run-${bRuns}`);
        execSync('git add b.txt && git commit -qm "b run"', { cwd: repo });
        return { ok: true, structured: { v: 100 } };
      },
    });
    const getHead = () => execSync('git rev-parse HEAD', { cwd: repo, encoding: 'utf8' }).trim();
    const defs = [node('A', []), node('B', ['A'])];
    const r1 = core.runPipeline({ change, state, defsFn: () => defs, driver, getHead });
    assert.equal(r1.status, 'success');
    const bShaBefore = state.nodes.B.commitSha;

    // A 的提交被重写 → 落地校验标记 A 失败；B 依赖 A，属「被污染」应标记 dirty
    state.nodes.A.commitSha = '0000000000000000000000000000000000000000';
    stateApi.validateLandings(state);
    assert.equal(state.nodes.A.status, 'failed');

    // 续跑：A 重跑（结果变化 v1→v2），B 的缓存应失效并强制重跑（B 真实重跑 → 新 commit → 新 commitSha）
    driver.calls.length = 0;
    core.runPipeline({ change, state, defsFn: () => defs, driver, getHead });
    assert.ok(driver.calls.includes('B'), '依赖被重跑节点的 B 应被标记 dirty 并强制真实重跑（spec「失败节点缓存失效」）');
    assert.notEqual(state.nodes.B.commitSha, bShaBefore, 'B 重跑后 commitSha 应更新');
    assert.equal(bRuns, 2, 'B 在污染后必须真实重跑（第二次执行）');
  });
  fs.rmSync(repo, { recursive: true, force: true });
});

// 从调度结果提取结果的辅助（core 把结果放进传入的 results 对象）
function results(res) {
  return res.results || {};
}
