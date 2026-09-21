'use strict';
// P6 组 9.3（design D11/D12）：capability.js——产品无关能力层。
// roles.json 的 allowedTools 迁移为 capabilities；定义 read-only/workspace-write 最小权限
// 与各 driver 的能力→宿主工具映射；宿主无法满足时 fail-closed，降级必须记录。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const cap = require('../capability.js');

test('cap: 能力全集（产品无关）——shell/read_files/write_files/search_files/git_read/git_write/network', () => {
  const defs = cap.capabilities();
  for (const c of ['shell', 'read_files', 'write_files', 'search_files', 'git_read', 'git_write', 'network']) {
    assert.ok(defs[c], `能力 ${c} 未定义`);
  }
});

test('cap: read-only 与 workspace-write 最小权限基线', () => {
  const ro = cap.minCapabilities('read-only');
  const rw = cap.minCapabilities('workspace-write');
  // read-only 不含任何写能力
  assert.ok(!ro.includes('write_files'));
  assert.ok(!ro.includes('git_write'));
  assert.ok(ro.includes('read_files'));
  assert.ok(ro.includes('search_files'));
  // workspace-write 含写
  assert.ok(rw.includes('write_files'));
  assert.ok(rw.includes('git_write'));
});

test('cap: 宿主工具映射——claude/codex/opencode 三端翻译一致（read_files→Read/sandbox read/read）', () => {
  const claudeTools = cap.hostTools('claude', ['read_files', 'search_files']);
  assert.ok(claudeTools.includes('Read'));
  assert.ok(claudeTools.includes('Glob'));
  const codexTools = cap.hostTools('codex', ['write_files']);
  assert.ok(codexTools.length > 0);
  const opencodeTools = cap.hostTools('opencode', ['read_files']);
  assert.ok(opencodeTools.length > 0, 'opencode 也要有能力映射');
});

test('cap: 写能力缺宿主支持（如 read-only sandbox 要求 write_files）→ fail-closed', () => {
  const ro = cap.hostTools('claude', ['read_files', 'write_files'], { sandbox: 'read-only' });
  assert.equal(ro.failClosed, true, 'read-only 沙箱要求 write_files → fail-closed');
});

test('cap: 能力无法精确满足时降级需要记录（degradation 标记）', () => {
  // hostTools 返回 { tools, degraded[] }：部分工具无法精确映射时降级而非静默忽略
  const r = cap.hostTools('opencode', ['git_read'], { sandbox: 'read-only' });
  assert.equal(typeof r, 'object');
  if (r.degraded && r.degraded.length) {
    assert.ok(r.degraded.every((d) => typeof d.capability === 'string' && typeof d.note === 'string'));
  }
});

test('cap: roles.json 的 capabilities 与最小权限一致（角色定义是唯一权威）', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const rolesJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'roles', 'roles.json'), 'utf8'));
  for (const role of Object.keys(rolesJson)) {
    const entry = rolesJson[role];
    assert.ok(Array.isArray(entry.capabilities), `角色 ${role} 应声明 capabilities 数组（不再是 allowedTools）`);
    assert.ok(!entry.allowedTools, `角色 ${role} 不应再有 Claude 工具名 allowedTools（D11 约束 3 迁移完成）`);
    const min = cap.minCapabilities(entry.sandbox || 'workspace-write');
    for (const c of min) assert.ok(entry.capabilities.includes(c), `角色 ${role} 的 ${c} 能力缺失（不满足 ${entry.sandbox} 最小权限）`);
  }
});
