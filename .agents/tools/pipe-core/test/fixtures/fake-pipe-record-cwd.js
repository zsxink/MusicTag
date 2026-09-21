#!/usr/bin/env node
// B1 验证用 fake claude：每次 driver 调用把 process.cwd() 追加到 FAKE_RECORD_CWD 文件，
// 断言 driver 实际工作目录是 --cwd 指定的 worktree 而非 repoRoot（P3 worktree 隔离）。
// 其余输出复用 fake-pipe-common 的 schema 合法输出。
const fs = require('node:fs');
const { outputFor } = require('./fake-pipe-common.js');
const idx = process.argv.indexOf('-p');
const prompt = idx !== -1 ? process.argv[idx + 1] : '';
if (process.env.FAKE_RECORD_CWD) fs.appendFileSync(process.env.FAKE_RECORD_CWD, `${process.cwd()}\n`);
process.stdout.write(JSON.stringify({ type: 'result', structured: outputFor(prompt) }));
