'use strict';
// claude driver：把一个 agent 节点翻译成 `claude -p` CLI 子进程 + 解析结构化输出。
// D7：角色文案经 `--append-system-prompt-file` 注入 roles/<role>.md 单源内容，不用 `--agent`。
// runAgent(task, ctx) → { ok, structured?, raw?, sessionId?, exitCode? }

const { spawnSync } = require('node:child_process');
const { API_VERSION, normalizeResult } = require('./contract.js');

// 纯函数：拼装 claude CLI 参数（供单测断言，不 spawn）。
// 注意：claude CLI 无 `--cwd` 参数（那是 codex 的 `--cd`）；指定工作目录走 spawnSync 的
// `cwd` 选项（B1 复核：driver cwd 必须指向实际工作目录，epic worktree 场景下为 worktree）。
function buildArgs(task, ctx = {}) {
  const args = ['-p', task.prompt];
  args.push('--output-format', 'json');
  if (task.schema) args.push('--json-schema', JSON.stringify(task.schema));
  if (ctx.roleFile) args.push('--append-system-prompt-file', ctx.roleFile);
  if (ctx.permissionMode) args.push('--permission-mode', ctx.permissionMode);
  if (ctx.allowedTools && ctx.allowedTools.length) {
    args.push('--allowedTools', ctx.allowedTools.join(','));
  }
  if (ctx.model) args.push('--model', ctx.model);
  return args;
}

// 解析 claude -p --output-format json 的输出。真实 claude 返回顶层 `structured_output`
//（下划线，实测确认），兼容旧假想 `structured` 与嵌套 `result.result` 形态。
function parseOutput(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      if (parsed.structured_output !== undefined) return { structured: parsed.structured_output, raw, sessionId: parsed.session_id || null };
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

function timeoutMs(ctx = {}) {
  return Number(ctx.timeoutMs || process.env.PIPE_AGENT_TIMEOUT_MS) || 600000;
}

function finish(result) {
  return normalizeResult({ ...result, driverApiVersion: API_VERSION });
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
      timeout: timeoutMs(ctx),
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    return finish({ ok: false, error: { kind: e && e.code === 'ENOENT' ? 'spawn' : 'agent', message: String(e) }, exitCode: null });
  }
  if (res.error) {
    const kind = res.error.code === 'ETIMEDOUT' ? 'timeout' : res.error.code === 'ENOENT' ? 'spawn' : 'agent';
    return finish({ ok: false, error: { kind, message: String(res.error) }, exitCode: res.status ?? null });
  }
  if (res.status !== 0) {
    // 保留 stderr 原文交给统一 contract 分类：401/403 必须落为 auth，
    // 不应被固定标成可重试的 agent 错误。
    return finish({ ok: false, raw: res.stdout, error: res.stderr || `claude 退出码 ${res.status}`, exitCode: res.status });
  }
  const parsed = parseOutput(res.stdout);
  if (parsed.structured === null) {
    return finish({ ok: false, raw: res.stdout, error: { kind: 'protocol', message: 'claude 输出不是有效 JSON', retryable: true }, exitCode: 0 });
  }
  return finish({ ok: true, ...parsed, exitCode: 0 });
}

module.exports = { API_VERSION, DRIVER_VERSION: '1.0.0', runAgent, buildArgs, parseOutput, timeoutMs };
