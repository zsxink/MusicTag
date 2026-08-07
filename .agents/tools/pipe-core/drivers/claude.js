'use strict';
// claude driver：把一个 agent 节点翻译成 `claude -p` CLI 子进程 + 解析结构化输出。
// D7：角色文案经 `--append-system-prompt` 注入 roles/<role>.md 单源内容，不用 `--agent`。
// runAgent(task, ctx) → { ok, structured?, raw?, sessionId?, exitCode? }

const { spawnSync } = require('node:child_process');

// 纯函数：拼装 claude CLI 参数（供单测断言，不 spawn）。
function buildArgs(task, ctx = {}) {
  const args = ['-p', task.prompt];
  args.push('--output-format', 'json');
  if (task.schema) args.push('--json-schema', JSON.stringify(task.schema));
  if (ctx.roleFile) args.push('--append-system-prompt', ctx.roleFile);
  if (ctx.cwd) args.push('--cwd', ctx.cwd);
  if (ctx.permissionMode) args.push('--permission-mode', ctx.permissionMode);
  if (ctx.allowedTools && ctx.allowedTools.length) {
    args.push('--allowedTools', ctx.allowedTools.join(','));
  }
  if (ctx.model) args.push('--model', ctx.model);
  return args;
}

// 解析 claude -p --output-format json 的输出。claude 返回
// { type:'result', ... result: { type:'text', ... }, structured: <schema 输出> }
// 兼容多种形态：优先取顶层 structured；其次 result.result。
function parseOutput(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      if (parsed.structured !== undefined) return { structured: parsed.structured, raw, sessionId: parsed.session_id || null };
      if (parsed.result && typeof parsed.result === 'object') {
        const nested = parsed.result.result ?? parsed.result;
        if (nested && typeof nested === 'object' && !Array.isArray(nested)) return { structured: nested, raw, sessionId: parsed.session_id || null };
        return { structured: nested, raw, sessionId: parsed.session_id || null };
      }
      if (parsed.output) return { structured: parsed.output, raw, sessionId: parsed.session_id || null };
    }
    return { structured: parsed, raw, sessionId: null };
  } catch (_) {
    return { structured: null, raw, sessionId: null };
  }
}

function runAgent(task, ctx = {}) {
  const bin = ctx.claudeBin || 'claude';
  const args = buildArgs(task, ctx);
  let res;
  try {
    res = spawnSync(bin, args, {
      encoding: 'utf8',
      cwd: ctx.cwd || process.cwd(),
      env: ctx.env || process.env,
      timeout: ctx.timeoutMs || 600000,
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    return { ok: false, error: String(e), exitCode: null };
  }
  if (res.error) {
    return { ok: false, error: String(res.error), exitCode: res.status ?? null };
  }
  if (res.status !== 0) {
    return { ok: false, raw: res.stdout, error: res.stderr || `claude 退出码 ${res.status}`, exitCode: res.status };
  }
  return { ok: true, ...parseOutput(res.stdout), exitCode: 0 };
}

module.exports = { runAgent, buildArgs, parseOutput };
