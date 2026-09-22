#!/usr/bin/env node
'use strict';
// 确定性建 PR wrapper：按 head branch 查询已有 PR，存在则复用；否则创建。
// 向 stdout 输出机器可读 JSON { ok, prUrl, number, reused }；退出码 0=成功、1=gh 失败、2=用法错误。
// integrate 的 get-or-create-pr checkpoint 以此为底层命令入口，查询复用逻辑由 wrapper 承担。
import { spawnSync } from 'node:child_process';

const [head, title, body] = process.argv.slice(2);
if (!head || !title) {
  console.error('用法: create-pr.js <head> <title> [body]');
  process.exit(2);
}

function run(args, timeoutMs = 120_000) {
  return spawnSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs });
}
function fail(r) {
  console.error(r.stderr || r.stdout || `gh 失败（exit ${r.status}）`);
  process.stdout.write(JSON.stringify({ ok: false, exitCode: r.status, error: (r.stderr || r.stdout || '').trim() }));
  process.exit(1);
}

// 查询复用：head branch 已有 open 或 merged PR → 直接返回，不重复创建。
const list = run(['pr', 'list', '--head', head, '--state', 'all', '--json', 'number,state,url,title', '--limit', '20']);
if (list.error || list.status !== 0) fail(list);
let existing = null;
try {
  const items = JSON.parse(list.stdout || '[]') || [];
  existing = items.find((p) => p.state === 'OPEN') || items.find((p) => p.state === 'MERGED') || items[0] || null;
} catch (_) { existing = null; }
if (existing) {
  process.stdout.write(JSON.stringify({ ok: true, prUrl: existing.url, number: existing.number, reused: true, state: existing.state }));
  process.exit(0);
}

const created = run(['pr', 'create', '--base', 'main', '--head', head, '--title', title, ...(body ? ['--body', body] : [])], 180_000);
if (created.error || created.status !== 0) fail(created);
const prUrl = (created.stdout || created.stderr || '').trim();
const m = /\/pull\/(\d+)/.exec(prUrl);
process.stdout.write(JSON.stringify({ ok: true, prUrl, number: m ? Number(m[1]) : null, reused: false }));
process.exit(0);