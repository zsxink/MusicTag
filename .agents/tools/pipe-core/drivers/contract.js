'use strict';
// P6（D11/D12）driver 统一契约层：所有 driver 的单一入口/出口规范。
// - API_VERSION：driver contract 语义化版本，跨 driver resume 前校验（D11 约束 7）。
// - validateTask：task 形状校验（id/role/prompt 必填；schema 可选）。
// - normalizeResult：把 driver 原始返回归一化为标准 DriverResult，并把「未分类异常」
//   归一化为标准错误码（spawn/auth/config/timeout/protocol/schema/agent + retryable）。
//   核心只消费标准结果，不认识宿主私有字段（D11 约束 1/4）。
// - terminate：超时终止语义——先 SIGTERM 宽限期（默认 10s），未响应再 SIGKILL。
//
// 标准错误 kind 语义（供决策链判断 retryable）：
//   spawn    —— 进程启动失败/二进制缺失（可重试）
//   timeout  —— 超时（可重试）
//   protocol —— 事件流/协议/结果形状损坏（可重试）
//   agent    —— 宿主 agent 层失败（模型侧错误等，可重试）
//   auth     —— 认证缺失/失效（不可重试，需人配置）
//   config   —— 配置缺失/不满足（不可重试，需人配置）
//   schema   —— 结构化输出未通过二次校验（不可重试——重跑相同 schema 会得到相同形状）

const API_VERSION = '1.0.0';

// 标准错误 kind 全集 + 是否值得自动重试。
const KINDS = {
  spawn: true,
  timeout: true,
  protocol: true,
  agent: true,
  command: true,
  network: true,
  auth: false,
  config: false,
  schema: false,
  permission: false,
  'branch-behind': false,
  'no-checks-yet': false,
  'already-merged': false,
};

// 对 driver 返回结果做关键字归类。driver 可显式给 { kind }，缺省按 message 探测。
function classify(result) {
  if (result.error && typeof result.error === 'object' && result.error.kind && Object.prototype.hasOwnProperty.call(KINDS, result.error.kind)) {
    return result.error.kind;
  }
  const msg = String((result.error && result.error.message) || result.error || '').toLowerCase();
  if (result.timeout || /timedout|time(?:d)?[ -]?out|etimedout/i.test(msg)) return 'timeout';
  if (/enoent|spawn|not found|no such file/i.test(msg)) return 'spawn';
  // auth 只认「认证失败」语义（401/403/unauthorized/invalid credentials）；
  // 「API key 未配置」是环境配置缺失，归 config，不在此匹配。
  if (/authentication|unauthorized|invalid (api[ _-]?key|token|credentials)|\b401\b|\b403\b/i.test(msg)) return 'auth';
  if (/未配置|not configured|missing (api[ _-]?key|access[ _-]?token|env|config)|please (set|configure)/i.test(msg)) return 'config';
  if (/schema|校验|二次校验|缺少必填/i.test(msg)) return 'schema';
  if (/event|protocol|ndjson|final|损坏|解析/i.test(msg)) return 'protocol';
  // 无信号 → 归为 agent 层失败（模型/宿主侧不可知错误，可重试最安全）
  return 'agent';
}

// 归一化为标准 DriverResult。driver 不得返回「裸失败」——裸结果在此统一为 protocol 错误。
function normalizeResult(result) {
  if (!result || typeof result !== 'object') {
    return { ok: false, error: { kind: 'protocol', message: 'driver 返回非对象结果', retryable: true } };
  }
  if (result.ok === true) {
    return {
      ok: true,
      structured: result.structured,
      raw: result.raw || null,
      sessionId: result.sessionId || null,
      exitCode: result.exitCode ?? null,
      driverApiVersion: result.driverApiVersion || API_VERSION,
      commands: result.commands || [],
      cacheHit: result.cacheHit === true,
    };
  }
  const kind = classify(result);
  const message = (result.error && result.error.message) || result.error || `driver 失败（exitCode=${result.exitCode}）`;
  return {
    ok: false,
    error: { kind, message, retryable: KINDS[kind] ?? true },
    structured: result.structured || null,
    raw: result.raw || null,
    sessionId: result.sessionId || null,
    exitCode: result.exitCode ?? null,
    commands: result.commands || [],
  };
}

// 是否值得自动重试（供决策链判断技术性失败 vs 需人修复）。
function retryable(error) {
  if (!error) return true;
  const kind = error.kind || classify({ error });
  return KINDS[kind] ?? true;
}

// task 形状校验：返回错误数组（空 = 合法）。
function validateTask(task) {
  const errors = [];
  if (!task || typeof task !== 'object') return ['task 必须是非空对象'];
  if (!task.id) errors.push('task 缺 id');
  if (!task.role) errors.push('task 缺 role');
  if (task.prompt === undefined || task.prompt === null || (typeof task.prompt === 'string' && !task.prompt.trim())) errors.push('task 缺 prompt');
  return errors;
}

// 超时终止语义：先 SIGTERM，宽限期后未响应再 SIGKILL。返回是否已终止。
// graceMs 默认 10s（CLI 场景可缩短）。宽限期给子进程自行收尾（落盘状态）的机会。
function terminate(child, graceMs = 10000) {
  if (!child || typeof child.kill !== 'function') return false;
  if (child.exitCode !== null && child.exitCode !== undefined) return true;
  if (!child.kill('SIGTERM')) return child.kill('SIGKILL');
  try {
    const deadline = Date.now() + graceMs;
    if (graceMs > 0) {
      const iv = setInterval(() => {
        if (child.exitCode !== null && child.exitCode !== undefined) {
          clearInterval(iv);
          return;
        }
        if (Date.now() >= deadline) {
          clearInterval(iv);
          try { child.kill('SIGKILL'); } catch (_) { /* 已退出 */ }
        }
      }, 50);
    }
  } catch (_) { /* 忽略 */ }
  return true;
}

module.exports = { API_VERSION, KINDS, classify, normalizeResult, retryable, validateTask, terminate };
