'use strict';

// 任务组 4 conformance：动态 CR 与测试分层的 workflow-core spec 落地。
// 这些断言把「CR 复盘专项维度」「分层测试去重」两条 requirement 的可执行证据
// 落到当前流水线：CR prompt 只能含当前 change 证据且允许定向只读 diff、三检与
// 四要素/EOL 门槛保留，Dev/Tester 自验证 scoped 且不重复 Verify 完整基线。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CORE = path.resolve(__dirname, '../../.agents/tools/pipe-core');
const pipeline = require(path.join(CORE, 'pipeline.js'));
const crPrompt = require(path.join(CORE, 'cr-prompt.js'));

function stateWithDomain(domain) {
  return {
    change: 'demo',
    nodes: {
      architect: { status: 'succeeded', result: { domain } },
      tester: { status: 'succeeded', result: { covered: ['scenario-x'], missing: [], smokePassed: true, risks: [] } },
    },
  };
}

test('CR conformance: 动态证据注入且允许定向真实审查（spec「动态证据注入 / 定向真实审查」）', () => {
  const cr = pipeline.buildPipeline(stateWithDomain('infra')).find((n) => n.id === 'cr');
  const state = stateWithDomain('infra');
  const p = cr.prompt({ cwd: process.cwd(), state });
  // prompt 证据来自当前 change 的 Tester 结果，不出现其他 change 测试数量
  assert.match(p, /scenario-x/);
  assert.match(p, /Tester 结果/);
  assert.doesNotMatch(p, /191\s*个/);
  // 允许定向只读 diff 与读关键文件（spec「定向真实审查」）
  assert.match(p, /git diff main\.\.\.HEAD/);
  assert.match(p, /只读/);
  assert.doesNotMatch(p, /不需要读取源码|立即返回/);
});

test('CR conformance: 复盘专项三检 + 不适用标注 + 四要素门槛（spec「CR 复盘专项维度」）', () => {
  const p = crPrompt.buildCrPrompt({ change: 'demo', state: stateWithDomain('infra'), cwd: '/tmp' });
  for (const dim of [/跨模块状态语义/, /竞态与串扰/, /网络与离线判定/]) {
    assert.match(p, dim);
  }
  assert.match(p, /不适用/);
  assert.match(p, /specReference \+ suggestion/);
  assert.match(p, /pass=true.*仅当无阻断且无 major/);
});

test('分层测试去重 conformance: Dev/Tester 自验证 scoped，完整基线归 Verify（spec「分层测试去重」）', () => {
  for (const domain of pipeline.CODE_DOMAINS) {
    const p = pipeline.devSpec('demo', domain);
    assert.match(p, /只跑受影响模块\/文件的相关测试/, domain);
    assert.match(p, /不重复 Verify 的完整本地基线/, domain);
  }
  const infra = pipeline.devSpec('demo', 'infra');
  assert.doesNotMatch(infra, /cargo test/, 'infra 不得跑 cargo');
  assert.match(infra, /不重复 Verify 的完整本地基线/);

  const tester = pipeline.buildPipeline(stateWithDomain('infra')).find((n) => n.id === 'tester');
  assert.match(tester.prompt({}), /scenario 清单/);
  assert.match(tester.prompt({}), /不重复 Verify 的完整本地基线/);
});

test('分层测试去重 conformance: Verify 才在最终 HEAD 跑全量、可按 HEAD 复用（spec「分层测试去重」）', () => {
  const verify = require(path.join(CORE, 'verify.js'));
  const infra = verify.buildPlan({ change: 'demo', domain: 'infra', root: path.resolve(__dirname, '../..') });
  assert.ok(infra.some((p) => p.step === 'pipe-core/workflow-core 全量测试'), 'infra Verify 含全量测试');
  assert.equal(typeof verify.cacheKeyFor, 'function');
});

test('CR conformance: 三轮上限与 blocker/major reroute 语义保留', () => {
  const decision = require(path.join(CORE, 'decision.js'));
  const crDef = pipeline.buildPipeline(stateWithDomain('infra')).find((n) => n.id === 'cr');
  assert.equal(crDef.maxRounds, 3);
  const fail = {
    def: { id: 'cr', role: 'cr-agent', maxRounds: 3 },
    attempts: 1,
    error: '',
    result: { pass: false, blockers: [{ severity: 'blocking', file: 'x', issue: 'i', specReference: 's', suggestion: 'f' }], majors: [] },
    round: 1,
    maxRounds: 3,
  };
  assert.equal(decision.decide(fail).action, 'reroute');
  assert.equal(decision.decide({ ...fail, round: 3 }).action, 'escalate');
});