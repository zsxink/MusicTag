#!/usr/bin/env node
'use strict';
// 确定性合并 wrapper：先查询远端状态，已 merged 则复用；否则 squash 合并。
// 输出机器可读 JSON { ok, number, merged, reused }；退出码 0=成功、1=gh 失败、2=用法错误。
// integrate 的 merge/verify-remote checkpoint 以此为底层命令入口。
import { spawnSync } from 'node:child_process';

const target = process.argv[2];
if (!target || !/^\d+$/.test(target)) {
  console.error('用法: merge-pr.js <pr>');
  process.exit(2);
}
const number = Number(target);

function run(args, timeoutMs = 120_000) {
  return spawnSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs });
}
function fail(r) {
  console.error(r.stderr || r.stdout || `gh 失败（exit ${r.status}）`);
  process.stdout.write(JSON.stringify({ ok: false, exitCode: r.status, error: (r.stderr || r.stdout || '').trim() }));
  process.exit(1);
}

// 查询复用：远端已 merged → 直接成功，不重复合并。
const view = run(['pr', 'view', target, '--json', 'state']);
if (view.error || view.status !== 0) fail(view);
try {
  const data = JSON.parse(view.stdout || '{}');
  if (data && data.state === 'MERGED') {
    process.stdout.write(JSON.stringify({ ok: true, number, merged: true, reused: true }));
    process.exit(0);
  }
} catch (_) { /* 非 JSON → 按未合并处理，交由 create/merge */ }

const merged = run(['pr', 'merge', target, '--squash', '--delete-branch'], 180_000);
if (merged.error || merged.status !== 0) fail(merged);
process.stdout.write(JSON.stringify({ ok: true, number, merged: true, reused: false }));
process.exit(0);