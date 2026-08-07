'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const decision = require('../decision.js');

const CR_FAIL = {
  def: { id: 'cr', role: 'cr-agent', maxRounds: 3 },
  attempts: 1,
  error: '',
  result: {
    pass: false,
    blockers: [{ severity: 'blocking', file: 'src/App.vue', issue: 'i1', specReference: 's', suggestion: 'f' }],
    majors: [{ severity: 'major', file: 'src-tauri/lib.rs', issue: 'i2', specReference: 's', suggestion: 'f' }],
  },
  round: 1,
  maxRounds: 3,
};

test('decision: ownerFor 按前缀归属（绝对路径含 /MusicTag/ 归一化）', () => {
  assert.equal(decision.ownerFor('/Users/x/Project/music/MusicTag/src-tauri/lib.rs').role, 'rust-backend');
  assert.equal(decision.ownerFor('src/App.vue').role, 'vue-frontend');
  assert.equal(decision.ownerFor('/Users/x/Project/music/MusicTag/src/App.vue').role, 'vue-frontend');
  assert.equal(decision.ownerFor('openspec/changes/x/spec.md').role, 'leader');
  assert.equal(decision.ownerFor('').role, 'leader');
  assert.equal(decision.ownerFor('/etc/passwd').role, 'leader');
});

test('decision: CR 内容问题（pass=false 有 blocker/major）→ reroute 优先', () => {
  const d = decision.decide(CR_FAIL);
  assert.equal(d.action, 'reroute');
  assert.equal(d.node, 'cr');
  assert.equal(d.problems.length, 2);
});

test('decision: CR 只含 minor 不 reroute，按技术性失败路径走', () => {
  const d = decision.decide({
    ...CR_FAIL,
    result: { pass: true, blockers: [], majors: [], minors: [{ severity: 'minor', file: 'x', issue: 'i' }] },
  });
  // pass=true 时不进 CR 分支，作为普通技术性失败 retry
  assert.equal(d.action, 'retry');
});

test('decision: CR 三轮不过 → escalate', () => {
  const d = decision.decide({ ...CR_FAIL, round: 3, maxRounds: 3 });
  assert.equal(d.action, 'escalate');
  assert.equal(d.escalate, true);
});

test('decision: 技术性失败 attempts 未超上限 → retry', () => {
  const d = decision.decide({ def: { id: 'dev', role: 'rust-backend', retry: { max: 2 } }, attempts: 1, error: '编译错误', result: null, round: 1, maxRounds: 1 });
  assert.equal(d.action, 'retry');
  const d2 = decision.decide({ def: { id: 'dev', role: 'rust-backend' }, attempts: 2, error: 'x', result: null, round: 1, maxRounds: 1 });
  assert.equal(d2.action, 'retry'); // 默认 retryMax=2
});

test('decision: retry 耗尽仍失败 → escalate（方向/范围/歧义交主会话）', () => {
  const d = decision.decide({ def: { id: 'verify', role: 'verify-agent', retry: { max: 2 } }, attempts: 3, error: 'flaky', result: null, round: 1, maxRounds: 1 });
  assert.equal(d.action, 'escalate');
  assert.equal(d.escalate, true);
  assert.match(d.reason, /主会话/);
});

test('decision: roleLabel 中文标签', () => {
  assert.equal(decision.roleLabel('rust-backend'), 'Rust 开发');
  assert.equal(decision.roleLabel('cr-agent'), 'CR（只读）');
  assert.equal(decision.roleLabel('unknown-role'), 'unknown-role');
});
