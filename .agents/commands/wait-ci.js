#!/usr/bin/env node
'use strict';
// 确定性等待 CI wrapper：轮询 required checks 直到全部通过（或失败/超时）。
// 输出机器可读 JSON { ok, checks:{ total, passed, failed } }；退出码 0=全绿、1=失败/超时、2=用法错误。
// integrate 的 wait-required-ci checkpoint 以此为底层命令入口；已通过的 required checks 直接复用，不重复等待。
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

function checksOnce() {
  const r = spawnSync('gh', ['pr', 'checks', target, '--required', '--json', 'name,state,link'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000,
  });
  if (r.error || r.status !== 0) {
    const msg = r.stderr || r.stdout || `gh pr checks 失败（exit ${r.status}）`;
    // 无 required checks（`--required` 返回空）时 gh 可能报错：视为无门禁，直接通过。
    const empty = /no.*check/i.test(msg) && !r.stderr.includes('failed');
    return { error: empty ? null : msg, runs: [] };
  }
  try { return { error: null, runs: JSON.parse(r.stdout || '[]') || [] }; }
  catch (_) { return { error: 'gh pr checks 输出非 JSON', runs: [] }; }
}

const deadline = Date.now() + timeoutMs;
for (;;) {
  const { error, runs } = checksOnce();
  if (error) {
    process.stdout.write(JSON.stringify({ ok: false, checks: { total: 0, passed: 0, failed: 0 }, error }));
    process.exit(1);
  }
  const pending = runs.filter((c) => (c.state || c.status) === 'PENDING' || (c.state || c.status) === 'IN_PROGRESS' || (c.state || c.status) === 'QUEUED');
  const failed = runs.filter((c) => ['FAILURE', 'CANCELLED', 'TIMED_OUT'].includes((c.conclusion || c.state || '').toUpperCase()));
  if (failed.length) {
    process.stdout.write(JSON.stringify({ ok: false, checks: { total: runs.length, passed: runs.length - failed.length, failed: failed.length }, error: `required checks 失败：${failed.map((c) => c.name).join(', ')}` }));
    process.exit(1);
  }
  if (runs.length > 0 && pending.length === 0) {
    process.stdout.write(JSON.stringify({ ok: true, checks: { total: runs.length, passed: runs.length, failed: 0 } }));
    process.exit(0);
  }
  if (runs.length === 0) {
    // 无 required checks：视为无 CI 门禁，保持全绿。
    process.stdout.write(JSON.stringify({ ok: true, checks: { total: 0, passed: 0, failed: 0 }, error: null }));
    process.exit(0);
  }
  if (Date.now() > deadline) {
    process.stdout.write(JSON.stringify({ ok: false, checks: { total: runs.length, passed: runs.length - pending.length, failed: 0 }, error: `等待 required checks 超时（${Math.round(timeoutMs / 60000)}min）` }));
    process.exit(1);
  }
  // 同步轮询：用同步 sleep 保持 wrapper 自包含（spawnSync 环境无法让事件循环并发）。
  const t = Date.now() + POLL_MS;
  while (Date.now() < t) { /* busy wait */ }
}