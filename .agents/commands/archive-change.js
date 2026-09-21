#!/usr/bin/env node
'use strict';

// DAG 节点使用的确定性 OpenSpec wrapper；入口层的 /opsx:archive 不进入核心。
const { spawnSync } = require('node:child_process');
const change = process.argv[2];
if (!change || !/^[a-z0-9][a-z0-9-]*$/.test(change)) {
  console.error('用法: node .agents/commands/archive-change.js <change>'); process.exit(2);
}
const result = spawnSync('openspec', ['archive', change, '--yes'], { stdio: 'inherit', encoding: 'utf8' });
if (result.error) { console.error(`openspec archive 启动失败: ${result.error.message}`); process.exit(1); }
process.exit(result.status === null ? 1 : result.status);
