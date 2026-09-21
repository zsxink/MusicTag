'use strict';

// OpenCode runtime adapter. OpenCode emits NDJSON events rather than one JSON
// response, so the core only sees the final assistant envelope after parsing.

const { spawnSync } = require('node:child_process');
const { validate } = require('../schema.js');
const { API_VERSION, normalizeResult } = require('./contract.js');

function buildArgs(task, ctx = {}) {
  const args = ['run', '--format', 'json'];
  if (ctx.cwd) args.push('--dir', ctx.cwd);
  if (ctx.model) args.push('--model', ctx.model);
  if (ctx.agent) args.push('--agent', ctx.agent);
  args.push(task.prompt);
  return args;
}

function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => typeof part === 'string' ? part : part && (part.text || part.content || '')).join('');
}

function extractJson(text) {
  const value = String(text || '').trim();
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1] : value;
  try { return JSON.parse(candidate); } catch (_) { return null; }
}

function parseOutput(raw) {
  const lines = String(raw || '').split(/\r?\n/).filter((line) => line.trim());
  const events = [];
  for (const line of lines) {
    try { events.push(JSON.parse(line)); }
    catch (_) { return { ok: false, error: { kind: 'protocol', message: 'OpenCode NDJSON 事件损坏', retryable: true }, raw }; }
  }
  const assistants = events.filter((event) => {
    const role = event.role || (event.message && event.message.role);
    return role === 'assistant' && (event.content !== undefined || event.text !== undefined || event.message);
  });
  const finals = assistants.filter((event) => event.final === true || event.done === true || event.type === 'result');
  if (finals.length !== 1) {
    return {
      ok: false,
      error: { kind: 'protocol', message: finals.length ? 'OpenCode 缺少唯一 final assistant 消息' : 'OpenCode 缺少 final assistant 消息', retryable: true },
      raw,
    };
  }
  const final = finals[0];
  const content = final.content !== undefined ? final.content : final.text !== undefined ? final.text : final.message && final.message.content;
  const structured = extractJson(textFromContent(content));
  if (structured === null) {
    return { ok: false, error: { kind: 'schema', message: 'OpenCode final assistant 不是 JSON envelope', retryable: false }, raw };
  }
  return { ok: true, structured, raw, sessionId: final.sessionID || final.session_id || null };
}

function timeoutMs(ctx = {}) {
  return Number(ctx.timeoutMs || process.env.PIPE_AGENT_TIMEOUT_MS) || 600000;
}

function runAgent(task, ctx = {}) {
  const bin = ctx.opencodeBin || 'opencode';
  let res;
  try {
    res = spawnSync(bin, buildArgs(task, ctx), {
      encoding: 'utf8', cwd: ctx.cwd || process.cwd(), env: ctx.env || process.env,
      stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs(ctx), maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    return normalizeResult({ ok: false, error: { kind: 'spawn', message: String(error), retryable: true } });
  }
  if (res.error) {
    const kind = res.error.code === 'ETIMEDOUT' ? 'timeout' : res.error.code === 'ENOENT' ? 'spawn' : 'agent';
    return normalizeResult({ ok: false, error: { kind, message: String(res.error), retryable: kind === 'spawn' || kind === 'timeout' }, exitCode: res.status ?? null });
  }
  if (res.status !== 0) return normalizeResult({ ok: false, error: { kind: 'agent', message: res.stderr || `opencode 退出码 ${res.status}`, retryable: true }, raw: res.stdout, exitCode: res.status });
  const parsed = parseOutput(res.stdout);
  if (!parsed.ok) return normalizeResult({ ...parsed, exitCode: res.status });
  if (task.schema) {
    const checked = validate(task.schema, parsed.structured);
    if (!checked.valid) return normalizeResult({ ok: false, error: { kind: 'schema', message: `OpenCode 输出未通过 schema 二次校验: ${checked.errors.join('; ')}`, retryable: false }, raw: res.stdout, exitCode: 0 });
  }
  return normalizeResult({ ...parsed, exitCode: 0, driverApiVersion: API_VERSION });
}

module.exports = { API_VERSION, DRIVER_VERSION: '1.0.0', runAgent, buildArgs, parseOutput, extractJson, timeoutMs };
