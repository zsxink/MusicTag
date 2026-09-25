'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '../../../..');
const ROLES_DIR = path.join(REPO, '.agents', 'tools', 'pipe-core', 'roles');

function loadRoles() {
  const file = path.join(ROLES_DIR, 'roles.json');
  assert.ok(fs.existsSync(file), 'roles.json is missing');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

test('roles: shared public role files declare the native main session and child boundaries', () => {
  const roles = loadRoles();
  for (const name of ['architect', 'rust-backend', 'vue-frontend', 'cr-agent', 'verify-agent', 'tester']) {
    const role = roles[name];
    assert.ok(role, `${name} must be defined`);
    assert.ok(Array.isArray(role.capabilities), `${name} must declare neutral capabilities`);
    assert.ok(!role.capabilities.includes('git_write'), `${name} cannot write Git state`);
    const file = path.join(ROLES_DIR, role.file || `${name}.md`);
    assert.ok(fs.existsSync(file), `${name} role file is missing`);
    assert.ok(fs.readFileSync(file, 'utf8').trim().length > 0, `${name} role file is empty`);
  }
  assert.equal(roles.leader.hostOnly, true, 'Leader duties belong to the current main session');
  assert.ok(roles.leader.capabilities.includes('git_write'), 'only the host-only Leader may write Git state');
  const leaderFile = path.join(ROLES_DIR, roles.leader.file || 'leader.md');
  assert.ok(fs.existsSync(leaderFile), 'Leader protocol file is missing');
  assert.ok(fs.readFileSync(leaderFile, 'utf8').trim().length > 0, 'Leader protocol file is empty');
  assert.equal(roles['cr-agent'].sandbox, 'read-only');
});

test('roles: shared workflow assigns Leader duties to the current main session', () => {
  const workflow = fs.readFileSync(path.join(REPO, '.agents', 'skills', 'pipe', 'WORKFLOW.md'), 'utf8');
  const skill = fs.readFileSync(path.join(REPO, '.agents', 'skills', 'pipe', 'SKILL.md'), 'utf8');
  assert.match(workflow, /当前与用户对话的主 Agent 是唯一 Leader/);
  assert.match(workflow, /CR 必须只读/);
  assert.match(workflow, /DONE.*NEEDS_PARENT_DECISION.*FAILED/s);
  assert.match(skill, /WORKFLOW\.md/);
  assert.doesNotMatch(skill, /node \.agents\/tools\/pipe-core\/run\.js/);
});
