'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const opencode = require('../drivers/opencode.js');
const contract = require('../drivers/contract.js');

const FAKE = path.join(__dirname, 'fixtures', 'fake-opencode.js');
const FAKE_PIPE = path.join(__dirname, 'fixtures', 'fake-pipe-opencode.js');
const SCHEMA = { type: 'object', properties: { ready: { type: 'boolean' } }, required: ['ready'] };

test('conformance: OpenCode success parses final assistant JSON and preserves worktree cwd', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-opencode-wt-'));
  try {
    const result = opencode.runAgent({ id: 'n1', role: 'tester', prompt: 'P', schema: SCHEMA }, { opencodeBin: FAKE, cwd });
    assert.equal(result.ok, true);
    assert.equal(result.structured.ready, true);
    assert.equal(result.structured.cwd, cwd);
    assert.equal(result.sessionId, 'fake-session');
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});

test('conformance: OpenCode malformed NDJSON is protocol failure', () => {
  const result = opencode.runAgent({ id: 'n1', role: 'tester', prompt: 'P' }, { opencodeBin: FAKE, env: { ...process.env, FAKE_OPENCODE_BAD_EVENT: '1' } });
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'protocol');
});

test('conformance: OpenCode missing final assistant is protocol failure', () => {
  const parsed = opencode.parseOutput(JSON.stringify({ type: 'message', role: 'assistant', content: '{"ready":true}' }));
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error.kind, 'protocol');
});

test('conformance: every registered driver exports the same contract version', () => {
  const registry = require('../drivers/registry.js');
  for (const entry of registry.MANIFEST) {
    const info = registry.get(entry.name);
    assert.equal(info.apiVersion, contract.API_VERSION);
    assert.equal(info.module.API_VERSION, contract.API_VERSION);
    assert.equal(typeof info.module.runAgent, 'function');
  }
});

test('fake E2E: OpenCode adapter drives the complete infra pipeline in its worktree cwd', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-opencode-e2e-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'test'], { cwd: repo });
    fs.writeFileSync(path.join(repo, 'README.md'), 'e2e');
    execFileSync('git', ['add', '.'], { cwd: repo });
    execFileSync('git', ['commit', '-qm', 'init'], { cwd: repo });
    const result = execFileSync(process.execPath, [path.join(__dirname, '..', 'run.js'), 'demo', '--driver', 'opencode'], {
      cwd: repo, encoding: 'utf8', env: { ...process.env, PIPE_CORE_REPO_ROOT: repo, PIPE_OPENCODE_BIN: FAKE_PIPE },
    });
    assert.match(result, /流水线成功/);
    const state = JSON.parse(fs.readFileSync(path.join(repo, '.agents', 'runs', 'demo', 'state.json'), 'utf8'));
    assert.equal(state.driver, 'opencode');
    assert.equal(state.nodes.integrate.status, 'succeeded');
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('state v2: driver metadata is persisted and v1 state migrates without session dependency', () => {
  const state = require('../state.js');
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-state-v2-'));
  const previous = process.env.PIPE_CORE_REPO_ROOT;
  try {
    execFileSync('git', ['init', '-q'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'test'], { cwd: repo });
    fs.writeFileSync(path.join(repo, 'a'), 'a');
    execFileSync('git', ['add', '.'], { cwd: repo });
    execFileSync('git', ['commit', '-qm', 'init'], { cwd: repo });
    process.env.PIPE_CORE_REPO_ROOT = repo;
    const current = state.newState('demo', 'opencode', contract.API_VERSION, '1.0.0');
    assert.equal(current.schemaVersion, 2);
    assert.equal(current.driverApiVersion, contract.API_VERSION);
    state.saveState('demo', current);
    assert.equal(state.loadState('demo').schemaVersion, 2);
    fs.mkdirSync(path.dirname(state.stateFile('legacy')), { recursive: true });
    fs.writeFileSync(state.stateFile('legacy'), JSON.stringify({ schemaVersion: 1, change: 'legacy', driver: 'claude', nodes: {} }));
    const migrated = state.loadState('legacy');
    assert.equal(migrated.schemaVersion, 2);
    assert.deepEqual(migrated.permissionDegraded, []);
  } finally {
    if (previous === undefined) delete process.env.PIPE_CORE_REPO_ROOT;
    else process.env.PIPE_CORE_REPO_ROOT = previous;
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
