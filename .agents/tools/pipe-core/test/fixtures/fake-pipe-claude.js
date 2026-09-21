#!/usr/bin/env node
// 全流水线 E2E fake claude：模拟 `claude -p <prompt> --output-format json`，
// 按 prompt 内容返回对应节点 schema 合法的结构化 JSON（输出到 stdout）。
const { outputFor } = require('./fake-pipe-common.js');
const idx = process.argv.indexOf('-p');
const prompt = idx !== -1 ? process.argv[idx + 1] : '';
process.stdout.write(JSON.stringify({ type: 'result', structured: outputFor(prompt) }));
