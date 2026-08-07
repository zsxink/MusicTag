'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const claude = require('../drivers/claude.js');
const codex = require('../drivers/codex.js');

const FAKE_CLAUDE = path.join(__dirname, 'fixtures', 'fake-claude.js');
const FAKE_CODEX = path.join(__dirname, 'fixtures', 'fake-codex.js');

const SCHEMA = { type: 'object', properties: { ready: { type: 'boolean' } }, required: ['ready'] };

test('claude: buildArgs 拼装完整（--json-schema + --append-system-prompt + 工具/模型）', () => {
  const args = claude.buildArgs({ prompt: 'P', schema: SCHEMA }, {
    roleFile: '/r/roles/leader.md', cwd: '/repo', permissionMode: 'acceptEdits',
    allowedTools: ['Bash', 'Read'], model: 'sonnet',
  });
  assert.deepEqual(args, [
    '-p', 'P', '--output-format', 'json',
    '--json-schema', JSON.stringify(SCHEMA),
    '--append-system-prompt', '/r/roles/leader.md',
    '--cwd', '/repo',
    '--permission-mode', 'acceptEdits',
    '--allowedTools', 'Bash,Read',
    '--model', 'sonnet',
  ]);
});

test('claude: 不用 --agent（D7 拍板）', () => {
  const args = claude.buildArgs({ prompt: 'P', schema: SCHEMA }, { roleFile: '/r/roles/leader.md' });
  assert.ok(!args.includes('--agent'));
});

test('claude: parseOutput 提取 .structured', () => {
  const parsed = claude.parseOutput(JSON.stringify({ type: 'result', structured: { ready: true } }));
  assert.deepEqual(parsed.structured, { ready: true });
  const nested = claude.parseOutput(JSON.stringify({ type: 'result', result: { type: 'text', result: { ready: false } } }));
  assert.deepEqual(nested.structured, { ready: false });
  const bad = claude.parseOutput('not json');
  assert.equal(bad.structured, null);
});

test('claude: runAgent 成功解析结构化输出', () => {
  const res = claude.runAgent({ prompt: 'P', schema: SCHEMA }, { claudeBin: FAKE_CLAUDE });
  assert.equal(res.ok, true);
  assert.deepEqual(res.structured, { ready: true, branch: 'demo', issues: [] });
});

test('claude: runAgent 非零退出上报失败', () => {
  const res = claude.runAgent({ prompt: 'P', schema: SCHEMA }, { claudeBin: FAKE_CLAUDE, env: { ...process.env, FAKE_EXIT: '1' } });
  assert.equal(res.ok, false);
  assert.equal(res.exitCode, 1);
});

test('codex: buildArgs 拼装完整（--json --cd --sandbox --output-schema -o --model）', () => {
  const args = codex.buildArgs({ prompt: 'P', schema: SCHEMA }, {
    cwd: '/repo', sandbox: 'workspace-write', schemaFile: '/tmp/s.json', resultFile: '/tmp/r.json', model: 'gpt-5',
  });
  assert.deepEqual(args, [
    'exec', 'P', '--json', '--cd', '/repo', '--sandbox', 'workspace-write',
    '--output-schema', '/tmp/s.json', '-o', '/tmp/r.json', '--model', 'gpt-5',
  ]);
});

test('codex: runAgent 读 result 文件 + schema 二次校验', () => {
  const res = codex.runAgent({ prompt: 'P', schema: SCHEMA }, { codexBin: FAKE_CODEX, env: { ...process.env, FAKE_OUTPUT: JSON.stringify({ ready: true }) } });
  assert.equal(res.ok, true);
  assert.deepEqual(res.structured, { ready: true });
});

test('codex: 输出违反 schema 二次校验 → 节点失败', () => {
  const res = codex.runAgent({ prompt: 'P', schema: SCHEMA }, { codexBin: FAKE_CODEX, env: { ...process.env, FAKE_OUTPUT: JSON.stringify({ ready: 'yes' }) } });
  assert.equal(res.ok, false);
  assert.match(res.error, /schema 二次校验/);
});

test('codex: 认证/配置缺失退出码非零 → 显式上报不降级', () => {
  const res = codex.runAgent({ prompt: 'P', schema: SCHEMA }, { codexBin: FAKE_CODEX, env: { ...process.env, FAKE_EXIT: '1' } });
  assert.equal(res.ok, false);
  assert.notEqual(res.exitCode, 0);
});

test('codex: 退出 0 但未产出 result 文件 → 显式失败', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const noOutput = path.join(__dirname, 'fixtures', 'fake-codex-no-output.js');
  fs.writeFileSync(noOutput, '#!/usr/bin/env node\nprocess.exit(0);\n');
  fs.chmodSync(noOutput, 0o755);
  const res = codex.runAgent({ prompt: 'P', schema: SCHEMA }, { codexBin: noOutput });
  assert.equal(res.ok, false);
  assert.match(res.error, /未产出 result 文件/);
  fs.rmSync(noOutput, { force: true });
});

test('codex: result 文件非 JSON → 显式失败', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const badJson = path.join(__dirname, 'fixtures', 'fake-codex-bad-json.js');
  fs.writeFileSync(badJson, '#!/usr/bin/env node\nconst fs=require("fs");const i=process.argv.indexOf("-o");if(i!==-1){fs.writeFileSync(process.argv[i+1],"{not json");}\n');
  fs.chmodSync(badJson, 0o755);
  const res = codex.runAgent({ prompt: 'P', schema: SCHEMA }, { codexBin: badJson });
  assert.equal(res.ok, false);
  assert.match(res.error, /非 JSON/);
  fs.rmSync(badJson, { force: true });
});

test('claude: 二进制缺失（spawn 失败）→ 显式上报失败，不崩溃', () => {
  const res = claude.runAgent({ prompt: 'P', schema: SCHEMA }, { claudeBin: '/nonexistent/claude-bin' });
  assert.equal(res.ok, false);
  assert.equal(res.exitCode, null);
});
