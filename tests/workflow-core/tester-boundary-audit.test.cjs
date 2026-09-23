'use strict';

// Tester 补充审计：这些断言把 workflow-core 规格中“不得伪绿”的边界
// 落到可执行测试。若实现仍允许通过，测试应失败并阻止进入 CR。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const pipeline = require('../../.agents/tools/pipe-core/pipeline.js');
const schema = require('../../.agents/tools/pipe-core/schema.js');
const contract = require('../../.agents/tools/pipe-core/drivers/contract.js');
const opencode = require('../../.agents/tools/pipe-core/drivers/opencode.js');
const path = require('node:path');

function stateWithDomain(domain) {
  return {
    change: 'workflow-core',
    nodes: {
      architect: {
        status: 'succeeded',
        result: { domain, designSummary: 'audit', keyDecisions: [], taskGroups: [] },
      },
    },
  };
}

test('tester boundary: non-empty missing must not satisfy tester resultOk', () => {
  const tester = pipeline.buildPipeline(stateWithDomain('infra')).find((node) => node.id === 'tester');
  assert.equal(
    tester.resultOk({ covered: ['happy path'], missing: ['失败路径未覆盖'], smokePassed: true, risks: [] }),
    false,
    '存在 missing 时不得声称 smokePassed=true 并进入 CR',
  );
});

test('CR boundary: blocker/major must contain specReference and suggestion', () => {
  const invalid = schema.validate(pipeline.CR_SCHEMA, {
    pass: false,
    blockers: [{ severity: 'blocking', file: 'src/App.vue', issue: '缺少失败路径测试' }],
    majors: [],
  });
  assert.equal(invalid.valid, false, '阻断问题缺少 specReference/suggestion 时必须 fail-closed');
});

test('CR boundary: pass=true with blocker/major is not a passing review', () => {
  const cr = pipeline.buildPipeline(stateWithDomain('infra')).find((node) => node.id === 'cr');
  assert.equal(
    cr.resultOk({
      pass: true,
      blockers: [{ severity: 'blocking', file: 'x', issue: '仍有阻断', specReference: 's', suggestion: 'f' }],
      majors: [],
      minors: [],
    }),
    false,
    '存在 blocker/major 时 pass 必须为 false',
  );
});

test('verify boundary: pass requires non-empty all-pass steps', () => {
  const verify = pipeline.buildPipeline(stateWithDomain('infra')).find((node) => node.id === 'verify');
  assert.equal(verify.resultOk({ pass: true, steps: [] }), false, '空 steps 不得通过最终验证');
  assert.equal(verify.resultOk({ pass: true, steps: [{ step: 'self-check', status: 'fail', detail: 'broken' }] }), false, '存在失败步骤不得 pass=true');
});

test('contract boundary: empty prompt is invalid task input', () => {
  assert.notDeepEqual(contract.validateTask({ id: 'n1', role: 'tester', prompt: '' }), []);
  assert.notDeepEqual(contract.validateTask({ id: 'n1', role: 'tester', prompt: '   ' }), []);
});

test('OpenCode boundary: final JSON with schema mismatch is schema failure', () => {
  const fake = path.join(__dirname, '../../.agents/tools/pipe-core/test/fixtures/fake-opencode.js');
  const result = opencode.runAgent(
    { id: 'n1', role: 'tester', prompt: 'P', schema: { type: 'object', required: ['ready'], properties: { ready: { type: 'boolean' } } } },
    { opencodeBin: fake, env: { ...process.env, FAKE_OPENCODE_OUTPUT: JSON.stringify({ ready: 'yes' }) } },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'schema');
});

test('network boundary: retryable HTTP status is not misclassified as auth', () => {
  for (const message of ['HTTP 429 Too Many Requests', 'HTTP 500 Internal Server Error', 'HTTP 503 Service Unavailable']) {
    const result = contract.normalizeResult({ ok: false, error: message });
    assert.equal(result.error.kind, 'network', message);
    assert.equal(result.error.retryable, true, message);
  }
  const timeout = contract.normalizeResult({ ok: false, error: 'HTTP 408 Request Timeout' });
  assert.equal(timeout.error.kind, 'timeout');
  assert.equal(timeout.error.retryable, true);
  for (const message of ['HTTP 401 Unauthorized', 'HTTP 403 Forbidden']) {
    const result = contract.normalizeResult({ ok: false, error: message });
    assert.equal(result.error.kind, 'auth', message);
    assert.equal(result.error.retryable, false, message);
  }
});
