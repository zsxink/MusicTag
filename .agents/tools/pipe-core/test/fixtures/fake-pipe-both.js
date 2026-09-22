#!/usr/bin/env node
// 任务组 7.2 端到端专用 fake claude：architect 返回 domain=both，
// dev-rust/dev-vue 实际写各自 writeScopes 内文件（core 才能生成提交），
// tester 返回满覆盖、CR 通过、verify/integrate 走确定性 runner 短路（fakeCommands）。
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const idx = process.argv.indexOf('-p');
const prompt = idx !== -1 ? process.argv[idx + 1] : '';
const cwd = process.cwd();

// 记录一次驱动调用（写往仓库外绝对路径，避免触发 workspace 越权审计）。
function driverNote(text) {
  const file = process.env.FAKE_DRIVER_CALLS;
  if (file) fs.appendFileSync(file, text.replace(/\n/g, ' ') + '\n');
}

driverNote(`[call] ${prompt}`);

// dev-rust / dev-vue 写入各自 scope 内的锚点文件，core 审计后提交。
if (prompt.includes('Rust 开发')) {
  const f = path.join(cwd, 'src-tauri', 'anchor.rs');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, `// ${new Date().toISOString()}\n`);
  process.stdout.write(JSON.stringify({ type: 'result', structured: { done: true, summary: 'rust dev done', filesChanged: ['src-tauri/anchor.rs'], tests: 'cargo test' } }));
} else if (prompt.includes('Vue 开发')) {
  const f = path.join(cwd, 'src', 'anchor.ts');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, `// ${new Date().toISOString()}\n`);
  process.stdout.write(JSON.stringify({ type: 'result', structured: { done: true, summary: 'vue dev done', filesChanged: ['src/anchor.ts'], tests: 'npm run test' } }));
} else if (prompt.includes('架构设计师')) {
  process.stdout.write(JSON.stringify({ type: 'result', structured: { domain: 'both', designSummary: 'domain=both e2e fixture', keyDecisions: [], taskGroups: [] } }));
} else if (prompt.includes('你是测试角色')) {
  process.stdout.write(JSON.stringify({ type: 'result', structured: { covered: ['s1', 's2'], missing: [], smokePassed: true, risks: [] } }));
} else if (prompt.includes('CR（只读') || prompt.includes('你是 CR') || prompt.includes('代码审查者')) {
  process.stdout.write(JSON.stringify({ type: 'result', structured: { pass: true, blockers: [], majors: [], minors: [] } }));
} else {
  process.stdout.write(JSON.stringify({ type: 'result', structured: { done: true, summary: 'fallback' } }));
}