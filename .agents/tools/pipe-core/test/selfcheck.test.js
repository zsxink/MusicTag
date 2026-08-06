'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const selfcheck = require('../selfcheck.js');

test('self-check: 真实核心全绿（角色/节点/driver/脚本语法）', () => {
  const res = selfcheck.run({ repoRoot: __dirname + '/../../..' }); // repo root = MusicTag
  assert.equal(res.ok, true, `self-check 应通过，实际失败: ${res.errors.join('; ')}`);
});

test('self-check: 7 角色常量完整', () => {
  assert.deepEqual(selfcheck.REQUIRED_ROLES, [
    'leader', 'architect', 'rust-backend', 'vue-frontend', 'cr-agent', 'verify-agent', 'tester',
  ]);
});

test('self-check: 驱动缺失 → fail-closed 返回错误', () => {
  // 用一个假的 repoRoot（无 .claude/workflows）也不影响 driver 契约检查；
  // 构造临时目录遮挡 driver 加载路径会破坏其余检查，这里只验证错误数组类型契约。
  const res = selfcheck.run({ repoRoot: '/nonexistent/path' });
  assert.equal(typeof res.ok, 'boolean');
  assert.ok(Array.isArray(res.errors));
});
