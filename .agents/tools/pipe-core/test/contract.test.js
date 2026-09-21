'use strict';
// P6 组 9.1（design D11/D12）：drivers/contract.js 契约层单测。
// contract.js 是 A 步基础——后续 registry/capability/wrapper/opencode 全部依赖
// 它定义的 apiVersion、task/ctx/DriverResult 校验、标准错误分类与超时终止语义。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const contract = require('../drivers/contract.js');

test('contract: API_VERSION 存在且为语义化版本', () => {
  assert.match(contract.API_VERSION, /^\d+\.\d+\.\d+$/);
});

test('contract: validateTask 校验 task 形状（id/role/prompt）', () => {
  assert.deepEqual(contract.validateTask({ id: 'n1', role: 'architect', prompt: 'P' }), []);
  assert.deepEqual(contract.validateTask({ id: 'n1', prompt: 'P' }), ['task 缺 role']);
  assert.deepEqual(contract.validateTask({ role: 'architect', prompt: 'P' }), ['task 缺 id']);
  assert.deepEqual(contract.validateTask({ id: 'n1', role: 'architect' }), ['task 缺 prompt']);
  assert.notEqual(contract.validateTask(null).length, 0, '非对象任务应报错');
});

test('contract: normalizeResult 标准错误分类（spawn/auth/config/timeout/protocol/schema + retryable）', () => {
  // spawn 类错误（二进制缺失/进程启动失败）→ spawn + retryable
  const spawn_ = contract.normalizeResult({ ok: false, error: 'spawn claude ENOENT' });
  assert.equal(spawn_.ok, false);
  assert.equal(spawn_.error.kind, 'spawn');
  assert.equal(spawn_.error.retryable, true);
  assert.match(spawn_.error.message, /spawn/);

  // auth 类错误 → auth + not retryable（认证配置问题重试无意义）
  const auth = contract.normalizeResult({ ok: false, error: '401 authentication required' });
  assert.equal(auth.error.kind, 'auth');
  assert.equal(auth.error.retryable, false);

  // config 类错误 → config
  const config = contract.normalizeResult({ ok: false, error: 'OPENAI_API_KEY 未配置，无法调用 codex' });
  assert.equal(config.error.kind, 'config');

  // protocol 类错误（open 事件流损坏/缺 final 等）→ protocol + retryable（可重试）
  const protocol = contract.normalizeResult({ ok: false, error: '事件流缺 final assistant message' });
  assert.equal(protocol.error.kind, 'protocol');
  assert.equal(protocol.error.retryable, true);

  // schema 类错误（输出未通过二次校验）→ schema（固定 bug，重试无意义但保留 retryable=false）
  const schema = contract.normalizeResult({ ok: false, error: 'codex 输出未通过 schema 二次校验: 缺少必填字段 ready' });
  assert.equal(schema.error.kind, 'schema');
  assert.equal(schema.error.retryable, false);

  // timeout 类错误 → timeout + retryable
  const timeout = contract.normalizeResult({ ok: false, error: 'ETIMEDOUT', timeout: true });
  assert.equal(timeout.error.kind, 'timeout');
  assert.equal(timeout.error.retryable, true);
});

test('contract: successTool 成功结果归一化（保留 structured/raw/sessionId/exitCode）', () => {
  const fixed = contract.normalizeResult({ ok: true, structured: { ready: true }, raw: '{"ready":true}', sessionId: 's1', exitCode: 0 });
  assert.equal(fixed.ok, true);
  assert.deepEqual(fixed.structured, { ready: true });
  assert.equal(fixed.sessionId, 's1');
  assert.notEqual(fixed.driverApiVersion, undefined, 'DriverResult 应携带 driverApiVersion（P6 9.9 依赖）');
  assert.equal(fixed.driverApiVersion, contract.API_VERSION);
});

test('contract: 缺 ok 标志的裸结果 → 按协议错误失败（driver 不得抛未分类结果）', () => {
  const fixed = contract.normalizeResult(null);
  assert.equal(fixed.ok, false);
  assert.equal(fixed.error.kind, 'protocol');
  assert.ok(fixed.error.retryable);
});

test('contract: 超时终止语义——terminate 先 SIGTERM 宽限再 SIGKILL（超时可配）', () => {
  const { spawn } = require('node:child_process');
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000);'], { stdio: 'ignore' });
  // 立即 SIGTERM（宽限期极小）：子进程应结束
  const res = contract.terminate(child, 10);
  assert.equal(res, true);
});

test('contract: 标准 DriverResult 的 exitCode 保留（供错误/成功诊断）', () => {
  const fixed = contract.normalizeResult({ ok: false, error: 'claude 退出码 1', exitCode: 1 });
  assert.equal(fixed.exitCode, 1);
});

test('contract: retryable 判定函数暴露（供决策链判断是否值得重试）', () => {
  // timeout/spawn 可重试；auth/config/schema 重试无意义
  assert.equal(contract.retryable({ kind: 'timeout' }), true);
  assert.equal(contract.retryable({ kind: 'spawn' }), true);
  assert.equal(contract.retryable({ kind: 'auth' }), false);
  assert.equal(contract.retryable({ kind: 'config' }), false);
  assert.equal(contract.retryable({ kind: 'schema' }), false);
  assert.equal(contract.retryable({ kind: 'protocol' }), true);
  assert.equal(contract.retryable({ kind: 'agent' }), true, 'agent 层失败（模型侧）可重试');
});