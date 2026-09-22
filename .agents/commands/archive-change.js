#!/usr/bin/env node
'use strict';
// 确定性归档 wrapper：执行 openspec archive，并向 stdout 输出机器可读 JSON。
// CLI 兼容：退出码 0=成功、1=归档失败、2=用法错误；人类可读消息走 stderr。
// integrate 的 archive checkpoint 以此为底层命令入口，依赖其 exit code + JSON。
import { spawnSync } from 'node:child_process';

const change = process.argv[2];
if (!change || !/^[a-z0-9][a-z0-9-]*$/.test(change)) {
  console.error('用法: node .agents/commands/archive-change.js <change>');
  process.exit(2);
}
const result = spawnSync('openspec', ['archive', change, '--yes'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
if (result.error) {
  console.error(`openspec archive 启动失败: ${result.error.message}`);
  process.stdout.write(JSON.stringify({ ok: false, error: result.error.message }));
  process.exit(1);
}
if (result.status !== 0) {
  console.error(result.stderr || result.stdout || `openspec archive 失败（exit ${result.status}）`);
  process.stdout.write(JSON.stringify({ ok: false, change, exitCode: result.status, error: (result.stderr || result.stdout || '').trim() }));
  process.exit(1);
}
process.stdout.write(JSON.stringify({ ok: true, change, archived: true }));
process.exit(0);