'use strict';
// P6 组 9.2（design D11/D12 A 步）：drivers/registry.js 单测。
// 注册 claude/codex/opencode 三端；run.js 从 registry 获取 driver、帮助文本和环境 matcher，
// 移除硬编码 import、DRIVERS 枚举及 if (driverName === ...) 角色注入。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const registry = require('../drivers/registry.js');

test('registry: 三端 driver 已注册（claude/codex/opencode）', () => {
  const names = registry.list().map((e) => e.name).sort();
  assert.deepEqual(names, ['claude', 'codex', 'opencode']);
});

test('registry: get 返回 driver 元信息（module/help/envMatchers）', () => {
  const claude = registry.get('claude');
  assert.ok(claude, 'claude 应注册');
  assert.equal(typeof claude.module.runAgent, 'function');
  assert.equal(typeof claude.help, 'string');
  assert.ok(claude.help.length > 0);
  const codex = registry.get('codex');
  assert.equal(typeof codex.module.runAgent, 'function');
  const opencode = registry.get('opencode');
  assert.ok(opencode, 'opencode 应注册（模块惰性加载，可能未实现）');
});

test('registry: get 未知 driver → null', () => {
  assert.equal(registry.get('grok'), null);
});

test('registry: detect 按环境匹配——CLAUDECODE truthy → claude', () => {
  assert.equal(registry.detect({ CLAUDECODE: '1', AI_AGENT: '' }), 'claude');
  assert.equal(registry.detect({ CLAUDECODE: 'true', AI_AGENT: '' }), 'claude');
  assert.equal(registry.detect({ CLAUDECODE: '0', AI_AGENT: '' }), null, 'CLAUDECODE=0 不误判 claude');
});

test('registry: detect 按环境匹配——AI_AGENT 含 codex/opencode', () => {
  assert.equal(registry.detect({ CLAUDECODE: '', AI_AGENT: 'codex' }), 'codex');
  assert.equal(registry.detect({ CLAUDECODE: '', AI_AGENT: 'opencode' }), 'opencode');
  assert.equal(registry.detect({ CLAUDECODE: '', AI_AGENT: 'copilot' }), null, '无关 agent 名不匹配任何 driver');
});

test('registry: detect 无法判断 → null（要求显式指定，绝不猜错）', () => {
  assert.equal(registry.detect({ CLAUDECODE: '', AI_AGENT: '' }), null);
  assert.equal(registry.detect({}), null);
});

test('registry: driver 帮助文本列出所有可选 runtime，openCode 含注释', () => {
  const help = registry.helpText();
  assert.match(help, /claude/);
  assert.match(help, /codex/);
  assert.match(help, /opencode/);
  // 帮助文本必须是三端可读的（Claude 斜杠命令也展示）
  assert.ok(help.length < 500, '帮助文本不应过长');
});

test('registry: 不可用 driver（opencode 未实现时）→ available=false 且不静默降级', () => {
  const opencode = registry.get('opencode');
  if (!opencode.module) {
    // 9.7 实现前：opencode.js 不存在 → available=false，run.js 应 fail-closed 而非改用 claude
    assert.equal(opencode.available, false);
    assert.ok(opencode.loadError, '应有加载错误信息');
  } else {
    assert.equal(opencode.available, true);
    assert.equal(typeof opencode.module.runAgent, 'function');
  }
});

test('registry: roleInjection 能力声明齐备（capability 驱动角色翻译，非名字分支）', () => {
  const byName = Object.fromEntries(registry.list().map((e) => [e.name, e]));
  const claude = registry.MANIFEST.find((e) => e.name === 'claude');
  const codex = registry.MANIFEST.find((e) => e.name === 'codex');
  const opencode = registry.MANIFEST.find((e) => e.name === 'opencode');
  assert.equal(claude.roleInjection, 'system-prompt-file', 'claude 注入 roles/ 文件');
  assert.equal(codex.roleInjection, 'prompt-prefix', 'codex 拼接 prompt');
  assert.equal(opencode.roleInjection, 'prompt-prefix', 'opencode 拼接 prompt');
  assert.ok(['system-prompt-file', 'prompt-prefix'].includes(claude.roleInjection));
});