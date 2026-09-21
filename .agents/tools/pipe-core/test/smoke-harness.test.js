'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const smoke = require('./real-smoke.js');

test('real smoke harness: each runtime is probed independently and unavailable/auth states are explicit skips', () => {
  const names = smoke.RUNTIMES.map((runtime) => runtime.name);
  assert.deepEqual(names, ['claude', 'codex', 'opencode']);
  for (const runtime of smoke.RUNTIMES) {
    const result = smoke.probe(runtime);
    assert.equal(result.name, runtime.name);
    assert.ok(['skip', 'pass'].includes(result.status));
    assert.equal(typeof result.reason, 'string');
  }
});
