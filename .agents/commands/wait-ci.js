#!/usr/bin/env node
'use strict';
// 确定性等待 CI wrapper：轮询 required checks 直到全部通过（或失败/超时）。
// 输出机器可读 JSON { ok, checks:{ total, passed, failed }, errorKind }；退出码 0=全绿、1=失败/超时、2=用法错误。
// integrate 的 wait-required-ci checkpoint 以此为底层命令入口；已通过的 required checks 直接复用，不重复等待。
//
// 自愈（D3 / Issue #147 第 3 条）：对 gh 的瞬时网络错误做「有上限的退避重试」，并用 errorKind
// 区分「取不到远端事实」（network/auth/...）与「远端事实表明 required checks 未通过」（checks-failed），
// 两者不再同码同形。等待一律用定时器，绝不忙等。
//
// 本文件是零共享依赖的独立 ESM，错误分类在此内聚实现，但词表与 pipe-core 的
// error-classifier.js（TRANSIENT: timeout/network/protocol/spawn/agent/command；
// PERMANENT: auth/config/schema/permission）对齐。
import { spawnSync } from 'node:child_process';

const target = process.argv[2];
if (!target || !/^\d+$/.test(target)) {
  console.error('用法: wait-ci.js <pr>');
  process.exit(2);
}

const POLL_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 30 * 60_000;
const timeoutArg = process.argv.find((a) => a.startsWith('--timeout='));
const timeoutMs = timeoutArg ? Number(timeoutArg.split('=')[1]) || DEFAULT_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;

// 瞬时错误有界退避：最多 5 次重试（首次之外），指数退避 1s→2s→4s→8s→16s，单次上限 30s。
// 任何一次等待都不得超出剩余 timeout 预算，故最坏总退避 ≈ 31s，相对 30min 预算可忽略。
const RETRY_MAX_ATTEMPTS = 5;
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 30_000;
// 单次 gh 调用自身的上限。
const GH_CALL_TIMEOUT_MS = 60_000;

// check 状态词表（沿用改造前的取值，未改变判定语义）。
const PENDING_STATES = ['PENDING', 'IN_PROGRESS', 'QUEUED'];
const FAILED_STATES = ['FAILURE', 'CANCELLED', 'TIMED_OUT'];

// 下面的注入钩子只用于测试把耗时压到毫秒级；生产默认路径不依赖它们
// （未设置时即真实默认值：有上限的指数退避 + 15s 轮询）。
const injectedPollMs = Number(process.env.WAIT_CI_POLL_MS);
const injectedRetryBaseMs = Number(process.env.WAIT_CI_RETRY_BASE_MS);
const injectedRetryMaxMs = Number(process.env.WAIT_CI_RETRY_MAX_MS);
const injectedRetryMaxAttempts = Number(process.env.WAIT_CI_RETRY_MAX_ATTEMPTS);

const pollMs = Number.isFinite(injectedPollMs) && injectedPollMs > 0 ? injectedPollMs : POLL_MS;
const retryBaseMs = Number.isFinite(injectedRetryBaseMs) && injectedRetryBaseMs >= 0 ? injectedRetryBaseMs : RETRY_BASE_MS;
const retryMaxMs = Number.isFinite(injectedRetryMaxMs) && injectedRetryMaxMs >= 0 ? injectedRetryMaxMs : RETRY_MAX_MS;
const retryMaxAttempts = Number.isFinite(injectedRetryMaxAttempts) && injectedRetryMaxAttempts >= 0
  ? Math.floor(injectedRetryMaxAttempts)
  : RETRY_MAX_ATTEMPTS;

// ── 错误分类（词表对齐 pipe-core/error-classifier.js）──────────────────────
// 可重试：EOF、connection reset、timeout、5xx、ETIMEDOUT、ECONNRESET —— 归为 network。
// 不可重试：认证失败（auth）、参数错误（config）、无 required checks（no-checks）。
const AUTH_PATTERN = /(auth|bad credentials|authentication|not logged in|requires authentication|gh auth login|permission denied|403 forbidden)/i;
const NO_CHECKS_PATTERN = /(no.*check|no.*gate|not found.*check)/i;
const RETRYABLE_PATTERN = /(EOF|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EPIPE|EAI_AGAIN|ENOTFOUND|ECONNABORTED|socket hang up|connection reset|connection refused|connection timed out|network (error|is unreachable|timeout)|tls handshake timeout|dns|i\/o timeout|timed? ?out|timeout|temporarily unavailable|bad gateway|service unavailable|gateway timeout|internal server error)/i;
const HTTP_5XX_PATTERN = /\b(500|502|503|504|507|508)\b/;

function classifyFailure(message) {
  const text = String(message || '');
  // 「无 required checks」是状态而非故障：gh 用 `--required` 查询空门禁时报错，
  // 必须先于错误词表判定，否则会被认证/网络规则误捕。
  if (NO_CHECKS_PATTERN.test(text) && !/failed/i.test(text)) return { retryable: false, kind: 'no-checks' };
  if (AUTH_PATTERN.test(text)) return { retryable: false, kind: 'auth' };
  if (RETRYABLE_PATTERN.test(text) || HTTP_5XX_PATTERN.test(text)) return { retryable: true, kind: 'network' };
  // 未知错误保守处理：不重试（避免把参数错误之类的确定性失败重试 5 次）。
  return { retryable: false, kind: 'unknown' };
}

function checksOnce(budgetMs) {
  const r = spawnSync('gh', ['pr', 'checks', target, '--required', '--json', 'name,state,link'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    timeout: Math.min(GH_CALL_TIMEOUT_MS, Math.max(1, Math.floor(budgetMs))),
  });
  if (r.error || r.status !== 0) {
    const msg = [r.stderr, r.stdout, r.error && r.error.code, r.error && r.error.message]
      .filter(Boolean).join('\n') || `gh pr checks 失败（exit ${r.status}）`;
    // 无 required checks（`--required` 返回空）时 gh 可能报错：视为无门禁，直接通过。
    const { kind } = classifyFailure(msg);
    const empty = kind === 'no-checks';
    return { error: empty ? null : msg, runs: [], errorKind: empty ? null : kind, noChecks: empty };
  }
  try { return { error: null, runs: JSON.parse(r.stdout || '[]') || [], errorKind: null }; }
  catch (_) { return { error: 'gh pr checks 输出非 JSON', runs: [], errorKind: 'protocol' }; }
}

// 定时器等待（非忙等）：不超过剩余预算，因此超时能在预算内及时收口。
function sleepCapped(ms, budgetMs) {
  const capped = Math.max(0, Math.min(ms, Math.max(0, budgetMs)));
  if (capped === 0) return Promise.resolve();
  return new Promise((resolve) => { setTimeout(resolve, capped); });
}

function emit(payload) {
  process.stdout.write(JSON.stringify(payload));
}

async function main() {
  const deadline = Date.now() + timeoutMs;
  const remaining = () => deadline - Date.now();
  const timeoutPayload = (runs) => ({
    ok: false,
    checks: { total: runs.length, passed: runs.filter((c) => !PENDING_STATES.includes(c.state || c.status)
      && !FAILED_STATES.includes((c.conclusion || c.state || '').toUpperCase())).length, failed: 0 },
    error: `等待 required checks 超时（${Math.round(timeoutMs / 60000)}min）`,
    errorKind: 'timeout',
  });

  let runs = [];
  for (;;) {
    // 瞬时错误的有上限退避重试：只在这一层重试，拿到远端事实后即进入判定。
    let attempt = 0;
    for (;;) {
      const callBudget = remaining();
      if (callBudget <= 0) { emit(timeoutPayload(runs)); return 1; }
      const result = checksOnce(callBudget);
      if (!result.error) {
        // 截止后返回的远端结果不再接受，避免慢查询把已超时等待判成成功。
        if (remaining() <= 0) { emit(timeoutPayload(runs)); return 1; }
        runs = result.runs;
        break;
      }
      if (result.noChecks) {
        // 无 required checks：视为无 CI 门禁，保持全绿。
        emit({ ok: true, checks: { total: 0, passed: 0, failed: 0 }, error: null, errorKind: null });
        return 0;
      }
      const budget = remaining();
      if (result.errorKind === 'network' && attempt < retryMaxAttempts && budget > 0) {
        // 有上限的指数退避，且单次等待不得超出剩余预算。
        await sleepCapped(Math.min(retryMaxMs, retryBaseMs * (2 ** attempt)), budget);
        attempt += 1;
        if (remaining() <= 0) {
          // 预算在退避中耗尽：按网络失败收口（取不到远端事实）。
          emit({ ok: false, checks: { total: 0, passed: 0, failed: 0 }, error: result.error, errorKind: 'network', retries: attempt });
          return 1;
        }
        continue;
      }
      emit({
        ok: false,
        checks: { total: 0, passed: 0, failed: 0 },
        error: result.error,
        errorKind: result.errorKind || 'unknown',
        retries: attempt,
      });
      return 1;
    }

    const pending = runs.filter((c) => PENDING_STATES.includes(c.state || c.status));
    const failed = runs.filter((c) => FAILED_STATES.includes((c.conclusion || c.state || '').toUpperCase()));
    if (failed.length) {
      emit({
        ok: false,
        checks: { total: runs.length, passed: runs.length - failed.length, failed: failed.length },
        error: `required checks 失败：${failed.map((c) => c.name).join(', ')}`,
        errorKind: 'checks-failed',
      });
      return 1;
    }
    if (runs.length > 0 && pending.length === 0) {
      emit({ ok: true, checks: { total: runs.length, passed: runs.length, failed: 0 }, errorKind: null });
      return 0;
    }
    if (runs.length === 0) {
      // 无 required checks：视为无 CI 门禁，保持全绿。
      emit({ ok: true, checks: { total: 0, passed: 0, failed: 0 }, error: null, errorKind: null });
      return 0;
    }
    if (remaining() <= 0) { emit(timeoutPayload(runs)); return 1; }
    // 定时器等待（绝不忙等），且不超过剩余预算 → 超时能在预算内及时收口。
    await sleepCapped(pollMs, remaining());
    if (remaining() <= 0) { emit(timeoutPayload(runs)); return 1; }
  }
}

main().then((code) => { process.exitCode = code; }).catch((e) => {
  emit({ ok: false, checks: { total: 0, passed: 0, failed: 0 }, error: String((e && e.message) || e), errorKind: 'unknown' });
  process.exitCode = 1;
});
