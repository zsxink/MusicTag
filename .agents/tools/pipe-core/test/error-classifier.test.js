'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyError, retryDisposition } = require('../error-classifier.js');

test('error classifier: permanent errors fail fast', () => {
  for (const kind of ['auth', 'config', 'schema', 'permission']) {
    assert.equal(classifyError({ kind }).category, 'permanent');
    assert.equal(retryDisposition({ kind, attempts: 1, retryMax: 9 }).action, 'escalate');
  }
});

test('error classifier: transient budget is cumulative and force retry is explicit', () => {
  for (const kind of ['timeout', 'network', 'protocol', 'spawn']) {
    assert.equal(classifyError({ kind }).category, 'transient');
  }
  assert.equal(retryDisposition({ kind: 'timeout', attempts: 1, retryMax: 1 }).action, 'retry');
  assert.equal(retryDisposition({ kind: 'timeout', attempts: 2, retryMax: 1 }).action, 'escalate');
  assert.equal(retryDisposition({ kind: 'timeout', attempts: 9, retryMax: 1, forceRetry: true }).action, 'retry');
});

test('error classifier: integrate state-machine facts do not enter generic retry', () => {
  for (const kind of ['branch-behind', 'no-checks-yet', 'already-merged']) {
    assert.equal(classifyError({ kind }).category, 'state-machine');
    assert.equal(retryDisposition({ kind, attempts: 1, retryMax: 1 }).action, 'handle');
  }
});
