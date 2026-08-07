#!/usr/bin/env node
// 模拟 codex exec：把 FAKE_OUTPUT 写入 -o 指定的 result 文件
const fs = require('node:fs');
const idx = process.argv.indexOf('-o');
if (idx !== -1) {
  const file = process.argv[idx + 1];
  fs.writeFileSync(file, process.env.FAKE_OUTPUT || '{}');
}
process.stdout.write(JSON.stringify({ type: 'result' }));
if (process.env.FAKE_EXIT) process.exit(Number(process.env.FAKE_EXIT));
