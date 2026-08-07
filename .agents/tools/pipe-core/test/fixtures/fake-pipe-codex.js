#!/usr/bin/env node
// 全流水线 E2E fake codex：模拟 `codex exec <prompt> --json ... -o <result>`，
// 按 prompt 内容返回对应节点 schema 合法的结构化 JSON（写入 -o result 文件）。
const fs = require('node:fs');
const { outputFor } = require('./fake-pipe-common.js');
const idx = process.argv.indexOf('-o');
if (idx !== -1) {
  const file = process.argv[idx + 1];
  const pIdx = process.argv.indexOf('exec');
  const prompt = pIdx !== -1 ? process.argv[pIdx + 1] : '';
  fs.writeFileSync(file, JSON.stringify(outputFor(prompt)));
}
process.stdout.write(JSON.stringify({ type: 'result' }));
