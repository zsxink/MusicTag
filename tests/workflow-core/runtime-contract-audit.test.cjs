'use strict';

// Tester 补充审计：把规格中的“标准错误分类”和“只读 CR”落到可执行断言，
// 不以 driver 自报成功或静态 prompt 存在代替运行时行为。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');

const core = require('../../.agents/tools/pipe-core/core.js');
const stateApi = require('../../.agents/tools/pipe-core/state.js');
const contract = require('../../.agents/tools/pipe-core/drivers/contract.js');
const claude = require('../../.agents/tools/pipe-core/drivers/claude.js');
const codex = require('../../.agents/tools/pipe-core/drivers/codex.js');
const opencode = require('../../.agents/tools/pipe-core/drivers/opencode.js');

function tempRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-core-audit-'));
  execSync('git init -q', { cwd: repo });
  execSync('git config user.email test@example.com && git config user.name test', { cwd: repo });
  fs.writeFileSync(path.join(repo, 'seed.txt'), 'seed');
  execSync('git add . && git commit -qm init', { cwd: repo });
  return repo;
}

test('P6 shared contract: every runtime returns a structured spawn error for a missing binary', () => {
  const task = { id: 'n1', role: 'tester', prompt: 'P' };
  const results = [
    claude.runAgent(task, { claudeBin: '/definitely-missing-claude' }),
    codex.runAgent(task, { codexBin: '/definitely-missing-codex' }),
    opencode.runAgent(task, { opencodeBin: '/definitely-missing-opencode' }),
  ];
  for (const result of results) {
    assert.equal(result.ok, false);
    assert.equal(typeof result.error, 'object', 'DriverResult.error 必须是标准错误对象');
    assert.equal(result.error.kind, 'spawn');
    assert.equal(result.error.retryable, true);
  }
});

test('P6 network/error-code boundary: HTTP 500 is retryable agent failure, not auth', () => {
  const result = contract.normalizeResult({ ok: false, error: 'HTTP 500 Internal Server Error' });
  assert.equal(result.error.kind, 'agent');
  assert.equal(result.error.retryable, true);
  assert.equal(contract.normalizeResult({ ok: false, error: 'HTTP 401 Unauthorized' }).error.kind, 'auth');
});

test('P6 read-only CR: actual workspace mutation is rejected before semantic success', () => {
  const repo = tempRepo();
  const previous = process.env.PIPE_CORE_REPO_ROOT;
  process.env.PIPE_CORE_REPO_ROOT = repo;
  try {
    const state = stateApi.newState('audit', 'mock');
    const schema = { type: 'object', properties: { pass: { type: 'boolean' } }, required: ['pass'] };
    const result = core.runPipeline({
      change: 'audit',
      state,
      defsFn: () => [{
        id: 'cr', role: 'cr-agent', prompt: 'read-only', schema,
        dependsOn: [], retry: { max: 1, intervalMs: 0 },
        resultOk: (value) => value.pass === true,
      }],
      ctx: { readOnly: true, cwd: repo },
      driver: {
        runAgent() {
          fs.writeFileSync(path.join(repo, 'forbidden.txt'), 'mutation');
          return { ok: true, structured: { pass: true } };
        },
      },
      commitRoot: repo,
      getHead: () => execSync('git rev-parse HEAD', { cwd: repo, encoding: 'utf8' }).trim(),
    });
    assert.equal(result.status, 'suspended');
    assert.equal(state.nodes.cr.errorKind, 'config');
    assert.match(state.nodes.cr.error, /read-only/);
  } finally {
    if (previous === undefined) delete process.env.PIPE_CORE_REPO_ROOT;
    else process.env.PIPE_CORE_REPO_ROOT = previous;
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('P1 state machine: a node must persist running before invoking the driver', () => {
  const repo = tempRepo();
  const previous = process.env.PIPE_CORE_REPO_ROOT;
  process.env.PIPE_CORE_REPO_ROOT = repo;
  try {
    const change = 'state-machine';
    const state = stateApi.newState(change, 'mock');
    let observedRunning;
    const result = core.runPipeline({
      change,
      state,
      defsFn: () => [{ id: 'n1', role: 'tester', prompt: 'p', schema: { type: 'object' }, dependsOn: [] }],
      driver: {
        runAgent: () => {
          observedRunning = JSON.parse(fs.readFileSync(stateApi.stateFile(change), 'utf8')).nodes.n1.status;
          return { ok: true, structured: {} };
        },
      },
      commitRoot: repo,
      getHead: () => execSync('git rev-parse HEAD', { cwd: repo, encoding: 'utf8' }).trim(),
    });
    assert.equal(result.status, 'success');
    assert.equal(observedRunning, 'running');
    assert.equal(state.nodes.n1.status, 'succeeded');
  } finally {
    if (previous === undefined) delete process.env.PIPE_CORE_REPO_ROOT;
    else process.env.PIPE_CORE_REPO_ROOT = previous;
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
