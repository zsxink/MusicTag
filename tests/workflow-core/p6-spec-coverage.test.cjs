'use strict';

// workflow-core P6 scenario coverage that must remain executable when the
// implementation is complete. These tests intentionally fail closed while a
// required asset/contract is absent; an unavailable runtime must not be
// treated as coverage.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const registry = require('../../.agents/tools/pipe-core/drivers/registry.js');
const contract = require('../../.agents/tools/pipe-core/drivers/contract.js');

const CORE = path.resolve(__dirname, '../../.agents/tools/pipe-core');
const REPO = path.resolve(CORE, '../..', '..');

test('P6: OpenCode driver implements success/protocol/worktree contract', () => {
  const file = path.join(CORE, 'drivers', 'opencode.js');
  assert.ok(fs.existsSync(file), '缺少 drivers/opencode.js');
  const driver = require(file);
  assert.equal(typeof driver.runAgent, 'function');
  assert.equal(typeof driver.buildArgs, 'function');
  assert.equal(driver.API_VERSION, contract.API_VERSION);

  const args = driver.buildArgs({ id: 'n1', role: 'tester', prompt: 'P' }, {
    cwd: '/tmp/worktree', model: 'test-model', agent: 'tester',
  });
  assert.deepEqual(args.slice(0, 5), ['run', '--format', 'json', '--dir', '/tmp/worktree']);
  assert.ok(args.includes('--model'));
  assert.ok(args.includes('--agent'));
});

test('P6: all registered runtimes expose the versioned DriverResult contract', () => {
  for (const entry of registry.MANIFEST) {
    const info = registry.get(entry.name);
    assert.ok(info && info.available, `${entry.name} 不可用，不能伪装成共享契约已覆盖`);
    assert.equal(info.module.API_VERSION, contract.API_VERSION, `${entry.name} 缺少兼容 apiVersion`);
    assert.equal(typeof info.module.runAgent, 'function');
  }
});

test('P6: contract mismatch is rejected before any pipeline node writes state', () => {
  const source = fs.readFileSync(path.join(CORE, 'run.js'), 'utf8');
  assert.match(source, /apiVersion/);
  assert.match(source, /不兼容/);
  for (const entry of registry.MANIFEST) {
    assert.ok(Object.prototype.hasOwnProperty.call(entry, 'apiVersion'), `${entry.name} manifest 缺 apiVersion`);
  }
});

test('P6: roles use product-neutral capabilities and read-only CR enforcement', () => {
  const roles = JSON.parse(fs.readFileSync(path.join(CORE, 'roles', 'roles.json'), 'utf8'));
  for (const [name, role] of Object.entries(roles)) {
    assert.ok(Array.isArray(role.capabilities), `${name} 未声明 capabilities`);
    assert.equal(Object.prototype.hasOwnProperty.call(role, 'allowedTools'), false, `${name} 仍暴露宿主工具名`);
  }
  const core = fs.readFileSync(path.join(CORE, 'core.js'), 'utf8');
  assert.match(core, /read-only|readOnly/);
  assert.match(core, /git diff|status --porcelain|工作区写入/);
});

test('P6: preflight/archive paths are runtime-neutral', () => {
  const workflowDir = path.join(REPO, '.agents', 'workflows');
  const commandDir = path.join(REPO, '.agents', 'commands');
  assert.ok(fs.existsSync(path.join(workflowDir, 'pipe-preflight.sh')));
  assert.ok(fs.existsSync(path.join(workflowDir, 'pipe-epic-preflight.sh')));
  assert.ok(fs.existsSync(path.join(commandDir, 'archive-change.js')));

  const pipeline = fs.readFileSync(path.join(CORE, 'pipeline.js'), 'utf8');
  assert.doesNotMatch(pipeline, /\.claude\/workflows/);
  assert.doesNotMatch(pipeline, /\/opsx:archive/);
});

test('P6: self-check discovers every registry driver and neutral workflow scripts', () => {
  const selfcheck = fs.readFileSync(path.join(CORE, 'selfcheck.js'), 'utf8');
  assert.doesNotMatch(selfcheck, /DRIVER_NAMES\s*=\s*\[/);
  assert.match(selfcheck, /registry/);
  assert.match(selfcheck, /\.agents[\\/]workflows/);
  assert.match(selfcheck, /\.agents[\\/]commands/);
});
