'use strict';

const { spawn } = require('node:child_process');

const DEFAULT_HEARTBEAT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_CHARS = 16_384;
const DEFAULT_KILL_GRACE_MS = 1_000;
const SECRET_NAME = /(token|key|secret|password)/i;

function displayCommand(command, args) {
  return [command, ...(args || []).map((arg) => {
    const value = String(arg);
    return /^[A-Za-z0-9_./:@%+=,-]+$/.test(value) ? value : JSON.stringify(value);
  })].join(' ');
}

function allowedEnvironment(extra, allowlist) {
  const env = {};
  const baseline = ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM', 'SystemRoot', 'WINDIR'];
  for (const key of baseline) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  for (const key of allowlist || []) {
    if (extra && extra[key] !== undefined) env[key] = String(extra[key]);
  }
  return env;
}

function secretValues(extra, allowlist) {
  return (allowlist || [])
    .filter((key) => SECRET_NAME.test(key) && extra && extra[key] !== undefined)
    .map((key) => String(extra[key]))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
}

function redact(value, secrets) {
  let text = String(value || '');
  for (const secret of secrets || []) text = text.split(secret).join('[REDACTED]');
  return text.replace(/\b(token|api[_-]?key|secret|password)\s*[=:]\s*([^\s]+)/gi, '$1=[REDACTED]');
}

function classifyExit({ spawnError, timedOut, cancelled, exitCode }) {
  if (timedOut) return 'timeout';
  if (cancelled) return 'cancelled';
  if (spawnError) return 'spawn';
  if (exitCode !== 0) return 'command';
  return null;
}

function terminateProcess(child, graceMs) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM');
    else child.kill('SIGTERM');
  } catch (_) {
    try { child.kill('SIGTERM'); } catch (_) { /* already gone */ }
  }
  const forceTimer = setTimeout(() => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try {
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
      else child.kill('SIGKILL');
    } catch (_) {
      try { child.kill('SIGKILL'); } catch (_) { /* already gone */ }
    }
  }, Math.max(0, graceMs));
  forceTimer.unref();
}

async function runCommand(options) {
  const {
    command,
    args = [],
    cwd = process.cwd(),
    env = {},
    envAllowlist = [],
    heartbeatMs = DEFAULT_HEARTBEAT_MS,
    timeoutMs = 0,
    killGraceMs = DEFAULT_KILL_GRACE_MS,
    maxOutputChars = DEFAULT_MAX_OUTPUT_CHARS,
    signal,
    onOutput,
    onHeartbeat,
  } = options || {};
  if (!command || typeof command !== 'string') throw new TypeError('command 必须是非空字符串');
  if (!Array.isArray(args)) throw new TypeError('args 必须是数组');

  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  const display = displayCommand(command, args);
  const secrets = secretValues(env, envAllowlist);
  let outputTail = '';
  let timedOut = false;
  let cancelled = !!(signal && signal.aborted);
  let spawnError = null;

  const append = (stream, chunk) => {
    const text = redact(chunk.toString(), secrets);
    const combined = `${outputTail}${text}`;
    const limit = Math.max(0, maxOutputChars);
    outputTail = combined.slice(-limit);
    // Keep evidence that redaction happened even when later noisy output evicts
    // the original secret-bearing line from the bounded tail.
    if (limit >= '[REDACTED]'.length && combined.includes('[REDACTED]') && !outputTail.includes('[REDACTED]')) {
      outputTail = `[REDACTED]${outputTail.slice(-(limit - '[REDACTED]'.length))}`;
    }
    if (onOutput) onOutput({ stream, text, command: display, elapsedMs: Date.now() - startedMs });
  };

  return new Promise((resolve) => {
    let settled = false;
    let heartbeatTimer;
    let timeoutTimer;
    let child;
    const finish = (exitCode, exitSignal) => {
      if (settled) return;
      settled = true;
      clearInterval(heartbeatTimer);
      clearTimeout(timeoutTimer);
      if (signal) signal.removeEventListener('abort', abortHandler);
      const endedMs = Date.now();
      const errorKind = classifyExit({ spawnError, timedOut, cancelled, exitCode });
      resolve({
        ok: errorKind === null,
        command: display,
        cwd,
        startedAt,
        endedAt: new Date(endedMs).toISOString(),
        durationMs: endedMs - startedMs,
        exitCode: Number.isInteger(exitCode) ? exitCode : null,
        signal: exitSignal || null,
        errorKind,
        timedOut,
        cancelled,
        outputTail,
        error: spawnError ? redact(spawnError.message || spawnError, secrets) : null,
      });
    };
    const abortHandler = () => {
      cancelled = true;
      terminateProcess(child, killGraceMs);
    };

    try {
      child = spawn(command, args.map(String), {
        cwd,
        env: allowedEnvironment(env, envAllowlist),
        shell: false,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      spawnError = error;
      finish(null, null);
      return;
    }

    child.stdout.on('data', (chunk) => append('stdout', chunk));
    child.stderr.on('data', (chunk) => append('stderr', chunk));
    child.on('error', (error) => {
      spawnError = error;
      finish(null, null);
    });
    child.on('close', finish);

    if (heartbeatMs > 0) {
      heartbeatTimer = setInterval(() => {
        if (onHeartbeat) onHeartbeat({ command: display, cwd, elapsedMs: Date.now() - startedMs });
      }, heartbeatMs);
      heartbeatTimer.unref();
    }
    if (timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        terminateProcess(child, killGraceMs);
      }, timeoutMs);
      timeoutTimer.unref();
    }
    if (signal) signal.addEventListener('abort', abortHandler, { once: true });
    if (cancelled) abortHandler();
  });
}

module.exports = {
  DEFAULT_HEARTBEAT_MS,
  DEFAULT_MAX_OUTPUT_CHARS,
  runCommand,
  redact,
  displayCommand,
};
