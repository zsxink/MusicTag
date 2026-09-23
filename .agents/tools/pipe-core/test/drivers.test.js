'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const claude = require('../drivers/claude.js');
const codex = require('../drivers/codex.js');

const FAKE_CLAUDE = path.join(__dirname, 'fixtures', 'fake-claude.js');
const FAKE_CODEX = path.join(__dirname, 'fixtures', 'fake-codex.js');

const SCHEMA = { type: 'object', properties: { ready: { type: 'boolean' } }, required: ['ready'] };

test('claude: buildArgs 拼装完整（--json-schema + --append-system-prompt-file + 工具/模型）', () => {
  // 子进程工作目录由 spawnSync 的 `cwd` 选项控制（B1 复核：driver cwd 指向 worktree），
  // claude CLI 无 --cwd 参数；拼进去会被 claude 拒为 unknown option（P1-P5 深埋 bug）。
  const args = claude.buildArgs({ prompt: 'P', schema: SCHEMA }, {
    roleFile: '/r/roles/leader.md', cwd: '/repo', permissionMode: 'acceptEdits',
    allowedTools: ['Bash', 'Read'], model: 'sonnet',
  });
  assert.deepEqual(args, [
    '-p', 'P', '--output-format', 'json',
    '--json-schema', JSON.stringify(SCHEMA),
    '--append-system-prompt-file', '/r/roles/leader.md',
    '--permission-mode', 'acceptEdits',
    '--allowedTools', 'Bash,Read',
    '--model', 'sonnet',
  ]);
  assert.ok(!args.includes('--cwd'), 'claude CLI 无 --cwd 参数，不得拼入');
});

test('claude: 只读角色使用 Claude CLI 的 plan 权限模式', () => {
  const args = claude.buildArgs({ prompt: 'P' }, {
    roleFile: '/r/roles/cr-agent.md', permissionMode: 'plan', allowedTools: ['Read'],
  });
  assert.ok(args.includes('--permission-mode'));
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'plan');
});

test('claude: 不用 --agent（D7 拍板）', () => {
  const args = claude.buildArgs({ prompt: 'P', schema: SCHEMA }, { roleFile: '/r/roles/leader.md' });
  assert.ok(!args.includes('--agent'));
});

test('claude: sanitizeEnv 剥离宿主模型覆盖变量，保留代理连接变量', () => {
  const env = claude.sanitizeEnv({
    ANTHROPIC_MODEL: 'opencode-free',
    ANTHROPIC_DEFAULT_SONNET_MODEL: 'opencode-free',
    ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: 'opencode-free',
    CLAUDE_CODE_SUBAGENT_MODEL: 'opencode-free',
    ANTHROPIC_AUTH_TOKEN: 'sk-keep',
    ANTHROPIC_BASE_URL: 'http://proxy:20128/v1',
    PATH: '/usr/bin',
  });
  assert.equal(env.ANTHROPIC_MODEL, undefined);
  assert.equal(env.ANTHROPIC_DEFAULT_SONNET_MODEL, undefined);
  assert.equal(env.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME, undefined);
  assert.equal(env.CLAUDE_CODE_SUBAGENT_MODEL, undefined);
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, 'sk-keep');
  assert.equal(env.ANTHROPIC_BASE_URL, 'http://proxy:20128/v1');
  assert.equal(env.PATH, '/usr/bin');
});

test('drivers: agent 超时可由 PIPE_AGENT_TIMEOUT_MS 配置，默认仍为 10 分钟', () => {
  const previous = process.env.PIPE_AGENT_TIMEOUT_MS;
  delete process.env.PIPE_AGENT_TIMEOUT_MS;
  try {
    assert.equal(claude.timeoutMs({}), 600000);
    assert.equal(codex.timeoutMs({}), 600000);
    assert.equal(claude.timeoutMs({ timeoutMs: 1234 }), 1234);
    assert.equal(codex.timeoutMs({ timeoutMs: 5678 }), 5678);
  } finally {
    if (previous === undefined) delete process.env.PIPE_AGENT_TIMEOUT_MS;
    else process.env.PIPE_AGENT_TIMEOUT_MS = previous;
  }
});

test('claude: parseOutput 提取 .structured', () => {
  const parsed = claude.parseOutput(JSON.stringify({ type: 'result', structured: { ready: true } }));
  assert.deepEqual(parsed.structured, { ready: true });
  const nested = claude.parseOutput(JSON.stringify({ type: 'result', result: { type: 'text', result: { ready: false } } }));
  assert.deepEqual(nested.structured, { ready: false });
  const bad = claude.parseOutput('not json');
  assert.equal(bad.structured, null);
});

test('claude: parseOutput 支持真实 structured_output 字段（实测字段名，下划线）', () => {
  const parsed = claude.parseOutput(JSON.stringify({ type: 'result', structured_output: { ready: true, branch: 'workflow-core', issues: [] } }));
  assert.deepEqual(parsed.structured, { ready: true, branch: 'workflow-core', issues: [] });
});

test('claude: runAgent 成功解析结构化输出', async () => {
  const res = await claude.runAgent({ prompt: 'P', schema: SCHEMA }, { claudeBin: FAKE_CLAUDE });
  assert.equal(res.ok, true);
  assert.deepEqual(res.structured, { ready: true, branch: 'demo', issues: [] });
});

test('claude: runAgent 非零退出上报失败', async () => {
  const res = await claude.runAgent({ prompt: 'P', schema: SCHEMA }, { claudeBin: FAKE_CLAUDE, env: { ...process.env, FAKE_EXIT: '1' } });
  assert.equal(res.ok, false);
  assert.equal(res.exitCode, 1);
});

test('codex: buildArgs 拼装完整（--json --cd --sandbox --output-schema -o --model）', () => {
  const previous = process.env.PIPE_CODEX_SANDBOX;
  delete process.env.PIPE_CODEX_SANDBOX;
  try {
    const args = codex.buildArgs({ prompt: 'P', schema: SCHEMA }, {
      cwd: '/repo', sandbox: 'workspace-write', schemaFile: '/tmp/s.json', resultFile: '/tmp/r.json', model: 'gpt-5',
    });
    assert.deepEqual(args, [
      'exec', '--ephemeral', 'P', '--json', '--cd', '/repo', '--sandbox', 'workspace-write',
      '--output-schema', '/tmp/s.json', '-o', '/tmp/r.json', '--model', 'gpt-5',
    ]);
  } finally {
    if (previous === undefined) delete process.env.PIPE_CODEX_SANDBOX;
    else process.env.PIPE_CODEX_SANDBOX = previous;
  }
});

test('codex: 可通过 PIPE_CODEX_SANDBOX 显式提升本地写权限', () => {
  const previous = process.env.PIPE_CODEX_SANDBOX;
  process.env.PIPE_CODEX_SANDBOX = 'danger-full-access';
  try {
    const args = codex.buildArgs({ prompt: 'P' }, { cwd: '/repo', sandbox: 'workspace-write' });
    assert.deepEqual(args.slice(0, 6), ['exec', '--ephemeral', 'P', '--json', '--cd', '/repo',]);
    assert.ok(args.includes('danger-full-access'));
  } finally {
    if (previous === undefined) delete process.env.PIPE_CODEX_SANDBOX;
    else process.env.PIPE_CODEX_SANDBOX = previous;
  }
});

test('codex: response schema 为 object 递归补齐 additionalProperties=false', () => {
  const normalized = codex.codexSchema({
    type: 'object',
    properties: { nested: { type: 'object', properties: { ok: { type: 'boolean' } } } },
  });
  assert.equal(normalized.additionalProperties, false);
  assert.equal(normalized.properties.nested.additionalProperties, false);
  assert.deepEqual(normalized.required, ['nested']);
  assert.deepEqual(normalized.properties.nested.required, ['ok']);
});

test('codex: runAgent 读 result 文件 + schema 二次校验', () => {
  const res = codex.runAgent({ prompt: 'P', schema: SCHEMA }, { codexBin: FAKE_CODEX, env: { ...process.env, FAKE_OUTPUT: JSON.stringify({ ready: true }) } });
  assert.equal(res.ok, true);
  assert.deepEqual(res.structured, { ready: true });
});

test('codex: 输出违反 schema 二次校验 → 节点失败', () => {
  const res = codex.runAgent({ prompt: 'P', schema: SCHEMA }, { codexBin: FAKE_CODEX, env: { ...process.env, FAKE_OUTPUT: JSON.stringify({ ready: 'yes' }) } });
  assert.equal(res.ok, false);
  assert.match(res.error.message, /schema 二次校验/);
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
  assert.match(res.error.message, /未产出 result 文件/);
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
  assert.match(res.error.message, /非 JSON/);
  fs.rmSync(badJson, { force: true });
});

test('claude: 二进制缺失（spawn 失败）→ 显式上报失败，不崩溃', async () => {
  const res = await claude.runAgent({ prompt: 'P', schema: SCHEMA }, { claudeBin: '/nonexistent/claude-bin' });
  assert.equal(res.ok, false);
  assert.equal(res.exitCode, null);
});

test('claude: 长任务超时 → kind=timeout 显式上报（异步 spawn 不假性挂起）', async () => {
  const res = await claude.runAgent({ prompt: 'P', schema: SCHEMA }, {
    claudeBin: FAKE_CLAUDE,
    env: { ...process.env, FAKE_DELAY_MS: '2000' },
    timeoutMs: 100,
  });
  assert.equal(res.ok, false);
  assert.equal(res.error.kind, 'timeout');
  assert.equal(res.error.retryable, true);
});

test('claude: 异步 runAgent 成功路径延迟输出仍正确解析', async () => {
  const res = await claude.runAgent({ prompt: 'P', schema: SCHEMA }, {
    claudeBin: FAKE_CLAUDE,
    env: { ...process.env, FAKE_DELAY_MS: '100' },
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.structured, { ready: true, branch: 'demo', issues: [] });
});
