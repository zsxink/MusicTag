#!/usr/bin/env node
// 并发证明用 fake claude：模拟 `claude -p <prompt> --output-format json`。
// 对 preflight 节点做固定 sleep（FAKE_PIPE_DELAY_MS），并在 FAKE_TIMELINE 文件逐条追加
// `nodeId start/end <timestamp>`，供测试断言三个子项的子进程真正并发存活（P3 证据）。
// 复用 fake-pipe-common 的 schema 合法输出。
const fs = require('node:fs');
const { outputFor } = require('./fake-pipe-common.js');

const idx = process.argv.indexOf('-p');
const prompt = idx !== -1 ? process.argv[idx + 1] : '';
const timeline = process.env.FAKE_TIMELINE;
const delayMs = Number(process.env.FAKE_PIPE_DELAY_MS || 0);

function log(ev) {
  if (timeline) fs.appendFileSync(timeline, `${ev} ${Date.now()}\n`);
}

// preflight 是每个子项子进程的第一个节点：sleep 保证批次内三个子进程同时存活，便于证明并发。
if (prompt.includes('pipe-preflight.sh') && delayMs > 0) {
  log('preflight-start');
  const buf = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(buf, 0, 0, delayMs);
  log('preflight-end');
}

process.stdout.write(JSON.stringify({ type: 'result', structured: outputFor(prompt) }));
