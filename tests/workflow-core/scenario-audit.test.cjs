'use strict';

// workflow-core scenario audit additions. These tests deliberately fail closed:
// a missing runtime adapter, capability layer, or neutral workflow asset is a
// missing implementation, not an acceptable skip.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const registry = require('../../.agents/tools/pipe-core/drivers/registry.js');
const contract = require('../../.agents/tools/pipe-core/drivers/contract.js');

const REPO = path.resolve(__dirname, '../..');
const CORE = path.join(REPO, '.agents', 'tools', 'pipe-core');

test('P6 failure/error-code boundary: standard classifications remain explicit and non-fallback', () => {
  assert.equal(contract.classify({ error: 'HTTP 401 Unauthorized' }), 'auth');
  assert.equal(contract.classify({ error: 'HTTP 403 Forbidden' }), 'auth');
  assert.equal(contract.classify({ error: 'request timed out' }), 'timeout');
  assert.equal(contract.classify({ error: 'result schema 校验失败' }), 'schema');
  assert.equal(contract.retryable({ kind: 'auth' }), false);
  assert.equal(contract.retryable({ kind: 'timeout' }), true);
});

test('P5 boundary: ambiguous runtime environment must require explicit driver selection', () => {
  assert.equal(registry.detect({ CLAUDECODE: '', AI_AGENT: 'codex opencode' }), null);
  assert.equal(registry.detect({ CLAUDECODE: 'true', AI_AGENT: 'codex' }), null);
});

test('P6 OpenCode success/protocol/worktree scenarios have executable adapter coverage', () => {
  const file = path.join(CORE, 'drivers', 'opencode.js');
  assert.ok(fs.existsSync(file), '缺少 OpenCode driver，成功/协议损坏/worktree 隔离场景无法覆盖');
  const driver = require(file);
  assert.equal(driver.API_VERSION, contract.API_VERSION);
  assert.equal(typeof driver.runAgent, 'function');
  assert.equal(typeof driver.buildArgs, 'function');
  const args = driver.buildArgs({ id: 'n1', role: 'tester', prompt: 'P' }, {
    cwd: '/tmp/worktree', model: 'test-model', agent: 'tester',
  });
  assert.deepEqual(args.slice(0, 5), ['run', '--format', 'json', '--dir', '/tmp/worktree']);
  assert.ok(args.includes('--model'));
  assert.ok(args.includes('--agent'));
});

test('P6 capability/read-only scenario: roles use neutral capabilities and CR is enforced read-only', () => {
  const capabilityFile = path.join(CORE, 'capability.js');
  assert.ok(fs.existsSync(capabilityFile), '缺少 capability.js，能力不足 fail-closed 场景未覆盖');
  const cap = require(capabilityFile);
  assert.ok(cap.capabilities().write_files);
  assert.ok(cap.capabilities().git_write);
  assert.equal(cap.hostTools('claude', ['read_files', 'write_files'], { sandbox: 'read-only' }).failClosed, true);

  const roles = JSON.parse(fs.readFileSync(path.join(CORE, 'roles', 'roles.json'), 'utf8'));
  for (const [name, role] of Object.entries(roles)) {
    assert.ok(Array.isArray(role.capabilities), `${name} 缺少 product-neutral capabilities`);
    assert.equal(Object.hasOwn(role, 'allowedTools'), false, `${name} 仍使用宿主工具名`);
  }
  assert.equal(roles['cr-agent'].sandbox, 'read-only');
});

test('P6 neutral workflow/command scenarios use .agents assets and deterministic archive wrapper', () => {
  const workflowDir = path.join(REPO, '.agents', 'workflows');
  const commandDir = path.join(REPO, '.agents', 'commands');
  assert.ok(fs.existsSync(path.join(workflowDir, 'pipe-preflight.sh')));
  assert.ok(fs.existsSync(path.join(workflowDir, 'pipe-epic-preflight.sh')));
  assert.ok(fs.existsSync(path.join(commandDir, 'archive-change.js')));

  const pipeline = fs.readFileSync(path.join(CORE, 'pipeline.js'), 'utf8');
  assert.doesNotMatch(pipeline, /\.claude\/workflows/);
  assert.doesNotMatch(pipeline, /\/opsx:/);
});

test('P6 contract-version and self-check scenarios discover every registered runtime', () => {
  for (const entry of registry.MANIFEST) {
    assert.equal(entry.apiVersion, contract.API_VERSION, `${entry.name} manifest 缺少 apiVersion`);
    const info = registry.get(entry.name);
    assert.ok(info && info.available, `${entry.name} 不可用时必须有可执行 conformance 覆盖`);
    assert.equal(info.module.API_VERSION, contract.API_VERSION);
  }

  const selfcheck = fs.readFileSync(path.join(CORE, 'selfcheck.js'), 'utf8');
  assert.doesNotMatch(selfcheck, /DRIVER_NAMES\s*=\s*\[/);
  assert.match(selfcheck, /registry/);
  assert.match(selfcheck, /\.agents[\\/]workflows/);
  assert.match(selfcheck, /\.agents[\\/]commands/);
});

test('entry-shell scenarios resolve all entry points to one core and share one pipe skill', () => {
  const pipe = fs.readFileSync(path.join(REPO, '.claude', 'commands', 'pipe.md'), 'utf8');
  const epic = fs.readFileSync(path.join(REPO, '.claude', 'commands', 'pipe-epic.md'), 'utf8');
  const opencodePipe = fs.readFileSync(path.join(REPO, '.opencode', 'commands', 'pipe.md'), 'utf8');
  const opencodeEpic = fs.readFileSync(path.join(REPO, '.opencode', 'commands', 'pipe-epic.md'), 'utf8');
  const agents = fs.readFileSync(path.join(REPO, 'AGENTS.md'), 'utf8');
  assert.match(pipe, /node \.agents\/tools\/pipe-core\/run\.js/);
  assert.match(epic, /node \.agents\/tools\/pipe-core\/run\.js/);
  assert.match(opencodePipe, /node \.agents\/tools\/pipe-core\/run\.js/);
  assert.match(opencodeEpic, /node \.agents\/tools\/pipe-core\/run\.js/);
  assert.match(agents, /node \.agents\/tools\/pipe-core\/run\.js .*--driver codex/);
  assert.equal(fs.realpathSync(path.join(REPO, '.claude', 'skills', 'pipe')),
    fs.realpathSync(path.join(REPO, '.agents', 'skills', 'pipe')));
});

test('decision-boundary scenario: leader role explicitly rejects PRD-out-of-scope self-expansion', () => {
  const leader = fs.readFileSync(path.join(CORE, 'roles', 'leader.md'), 'utf8');
  assert.match(leader, /不自我扩张|PRD 之外|需求歧义/);
});
