'use strict';
// claude driver：把一个 agent 节点翻译成 `claude -p` CLI 子进程 + 解析结构化输出。
// D7：角色文案经 `--append-system-prompt-file` 注入 roles/<role>.md 单源内容，不用 `--agent`。
// runAgent(task, ctx) → { ok, structured?, raw?, sessionId?, exitCode? }

const { spawn } = require('node:child_process');
const { API_VERSION, normalizeResult } = require('./contract.js');

// 超时终止：先 SIGTERM 宽限，未响应再 SIGKILL（与 command-runner 语义一致）。
const KILL_GRACE_MS = 5_000;

// 纯函数：拼装 claude CLI 参数（供单测断言，不 spawn）。
// 注意：claude CLI 无 `--cwd` 参数（那是 codex 的 `--cd`）；指定工作目录走 spawn 的
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

// 净化 spawn 环境：剥离主会话特有的模型覆盖变量（ANTHROPIC_MODEL / ANTHROPIC_DEFAULT_*_MODEL /
// CLAUDE_CODE_SUBAGENT_MODEL）。这些在 opencode-free 之类宿主下会被设成宿主模型名，
// 直接继承会让子进程 claude 报 unrecognized_model，且 driver 不在该栏目的还会继续带给自己。
// 代理连接变量（ANTHROPIC_AUTH_TOKEN / ANTHROPIC_BASE_URL）保留。
const MODEL_ENV_PATTERN = /^(ANTHROPIC_MODEL|ANTHROPIC_DEFAULT_.*_MODEL|ANTHROPIC_DEFAULT_.*_MODEL_NAME|CLAUDE_CODE_SUBAGENT_MODEL)$/;
function sanitizeEnv(env = process.env) {
  const out = { ...env };
  for (const key of Object.keys(out)) {
    if (MODEL_ENV_PATTERN.test(key)) delete out[key];
  }
  return out;
}

function finish(result) {
  return normalizeResult({ ...result, driverApiVersion: API_VERSION });
}

// 生成超时终止。spawnSync 对长任务会一直阻塞到 timeout 硬杀，无法响应；换异步 spawn 后
// 用 SIGTERM 宽限期优雅关闭，超出再 SIGKILL（command-runner.js 同款，common.js 不依赖）。
// 超时触发时置 timedOut=true；child close 时据此报 kind=timeout。
function scheduleTermination(child, ms, onTimedOut) {
  const graceMs = Math.max(0, Number(KILL_GRACE_MS));
  const terminate = () => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    onTimedOut && onTimedOut();
    try {
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM');
      else child.kill('SIGTERM');
    } catch (_) {
      try { child.kill('SIGTERM'); } catch (_) { /* already gone */ }
    }
    if (child.exitCode !== null || child.signalCode !== null) return;
    const forceTimer = setTimeout(() => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch (_) { /* already gone */ }
    }, graceMs);
    forceTimer.unref();
  };
  const timer = setTimeout(terminate, ms);
  timer.unref();
  return timer;
}

function runAgent(task, ctx = {}) {
  const bin = ctx.claudeBin || 'claude';
  const args = buildArgs(task, ctx);
  const timeout = timeoutMs(ctx);
  const cwd = ctx.cwd || process.cwd();
  const env = sanitizeEnv(ctx.env || process.env);

  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let stdout = '';
    let stderr = '';
    const done = (res) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(finish(res));
    };
    let timer = null;

    let child;
    try {
      child = spawn(bin, args, {
        cwd,
        env,
        // stdin 关闭：prompt 已作 argv 传入，留开放管道会让非交互 claude 等待追加输入
        // （codex driver 同款处理，防假性挂起）。
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      const kind = e && e.code === 'ENOENT' ? 'spawn' : 'agent';
      return done({ ok: false, error: { kind, message: String(e) }, exitCode: null });
    }

    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => {
      const kind = err.code === 'ENOENT' ? 'spawn' : err.code === 'ETIMEDOUT' ? 'timeout' : 'agent';
      done({ ok: false, error: { kind, message: String(err) }, exitCode: null });
    });
    child.on('close', (code) => {
      if (settled) return;
      if (timedOut) {
        done({ ok: false, error: { kind: 'timeout', message: `claude 超时（${timeout}ms），已终止`, retryable: true }, exitCode: code ?? null });
        return;
      }
      if (code !== 0) {
        // 保留 stderr 原文交给统一 contract 分类：401/403 必须落为 auth，
        // 不应被固定标成可重试的 agent 错误。
        done({ ok: false, raw: stdout, error: stderr || `claude 退出码 ${code}`, exitCode: code });
        return;
      }
      const parsed = parseOutput(stdout);
      if (parsed.structured === null) {
        done({ ok: false, raw: stdout, error: { kind: 'protocol', message: 'claude 输出不是有效 JSON', retryable: true }, exitCode: 0 });
        return;
      }
      done({ ok: true, ...parsed, exitCode: 0 });
    });

    // 超时 → SIGTERM 宽限后 SIGKILL；close 会以非零信号码返回，驱动 done。
    if (timeout > 0) timer = scheduleTermination(child, timeout, () => { timedOut = true; });
  });
}

module.exports = { API_VERSION, DRIVER_VERSION: '1.0.0', runAgent, buildArgs, parseOutput, timeoutMs, sanitizeEnv, MODEL_ENV_PATTERN };
