'use strict';

// Tester 补齐场景审计中缺失的可执行边界：真实 driver 的网络错误分类、
// OpenCode worktree 写入隔离、挂起状态落盘和确定性归档 wrapper。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '../..');
const CORE = path.join(REPO, '.agents', 'tools', 'pipe-core');
const RUNJS = path.join(CORE, 'run.js');
const { seedWorkflows } = require(path.join(CORE, 'test', 'seed.js'));

function tempRepo(prefix = 'workflow-core-gap-') {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: repo });
  seedWorkflows(repo);
  fs.writeFileSync(path.join(repo, 'seed.txt'), 'seed');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: repo });
  return repo;
}

function writeExecutable(dir, name, source) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!/usr/bin/env node\n${source}`);
  fs.chmodSync(file, 0o755);
  return file;
}

test('shared conformance: real drivers classify HTTP auth failure instead of silently treating it as agent retry', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-core-driver-error-'));
  const failing = writeExecutable(dir, 'runtime.js', "process.stderr.write('HTTP 401 Unauthorized\\n'); process.exit(1);");
  const claude = require('../../.agents/tools/pipe-core/drivers/claude.js');
  const codex = require('../../.agents/tools/pipe-core/drivers/codex.js');
  const opencode = require('../../.agents/tools/pipe-core/drivers/opencode.js');
  const task = { id: 'n1', role: 'tester', prompt: 'P' };
  try {
    const results = await Promise.all([
      claude.runAgent(task, { claudeBin: failing }),
      codex.runAgent(task, { codexBin: failing }),
      opencode.runAgent(task, { opencodeBin: failing }),
    ]);
    for (const result of results) {
      assert.equal(result.ok, false);
      assert.equal(result.error.kind, 'auth', `HTTP 401 不应被分类为 ${result.error.kind}`);
      assert.equal(result.error.retryable, false);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('OpenCode worktree isolation: adapter child writes only in the requested cwd', () => {
  const repo = tempRepo('workflow-core-opencode-isolation-');
  const worktree = path.join(repo, 'worktree');
  fs.mkdirSync(worktree);
  const marker = 'opencode-child-write.txt';
  const fake = writeExecutable(worktree, 'fake-opencode.js', [
    "const fs = require('node:fs');",
    `fs.writeFileSync('${marker}', 'worktree');`,
    "process.stdout.write(JSON.stringify({ type: 'message', role: 'assistant', final: true, content: '{\"ready\":true}' }) + '\\n');",
  ].join('\n'));
  const opencode = require('../../.agents/tools/pipe-core/drivers/opencode.js');
  try {
    const result = opencode.runAgent(
      { id: 'n1', role: 'tester', prompt: 'P', schema: { type: 'object', required: ['ready'], properties: { ready: { type: 'boolean' } } } },
      { opencodeBin: fake, cwd: worktree },
    );
    assert.equal(result.ok, true);
    assert.equal(fs.existsSync(path.join(worktree, marker)), true);
    assert.equal(fs.existsSync(path.join(repo, marker)), false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('suspended workflow: failed tester persists a complete handoff state for the main session', () => {
  const repo = tempRepo('workflow-core-suspended-');
  const fake = writeExecutable(repo, 'fake-runtime.js', [
    "const args = process.argv.join(' ');",
    "const fail = args.includes('你是测试角色');",
    "const result = fail ? { covered: [], missing: ['失败路径'], smokePassed: false, risks: [] } : (args.includes('只读执行') ? { ready: true, branch: 'demo', issues: [] } : args.includes('架构设计师') ? { domain: 'infra', designSummary: 'audit' } : args.includes('流程维护') ? { done: true, summary: 'ok' } : { pass: true, blockers: [], majors: [], minors: [] });",
    "process.stdout.write(JSON.stringify({ structured_output: result }));",
    "if (fail) process.exit(1);",
  ].join('\n'));
  try {
    const result = spawnSync(process.execPath, [RUNJS, 'demo', '--driver', 'claude'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, PIPE_CORE_REPO_ROOT: repo, PIPE_CLAUDE_BIN: fake, CLAUDECODE: '1', AI_AGENT: '' },
    });
    assert.equal(result.status, 3, result.stderr);
    const stateFile = path.join(repo, '.agents', 'runs', 'demo', 'state.json');
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(state.nodes.tester.status, 'suspended');
    assert.equal(typeof state.nodes.tester.error, 'string');
    assert.ok(state.nodes.tester.error.length > 0);
    assert.equal(state.nodes.bootstrap.status, 'succeeded');
    assert.equal(state.nodes.architect.status, 'succeeded');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('archive wrapper: integrate path invokes deterministic .agents command with exact change and --yes', () => {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-core-archive-bin-'));
  const argsFile = path.join(binDir, 'args.txt');
  writeExecutable(binDir, 'openspec', [
    "const fs = require('node:fs');",
    `fs.writeFileSync(${JSON.stringify(argsFile)}, process.argv.slice(2).join('\\n'));`,
  ].join('\n'));
  try {
    const result = spawnSync(process.execPath, [path.join(REPO, '.agents', 'commands', 'archive-change.js'), 'workflow-core'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}` },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(argsFile, 'utf8'), 'archive\nworkflow-core\n--yes');
  } finally {
    fs.rmSync(binDir, { recursive: true, force: true });
  }
});

test('code-domain verify contract: buildPlan 基线按序产出结构化步骤，必选项与顺序明确', () => {
  const verify = require(path.join(CORE, 'verify.js'));
  const plans = verify.buildPlan({ change: 'workflow-core', domain: 'both', root: REPO });
  const ordered = plans.map((p) => p.step);
  // 代码域基线顺序：cargo → npm → OpenSpec 汇合门禁。
  const cargoIdx = ordered.indexOf('cargo check');
  const npmIdx = ordered.indexOf('npm test');
  const openspecIdx = ordered.lastIndexOf('OpenSpec strict validate');
  assert.ok(cargoIdx >= 0, 'cargo check 必选');
  assert.ok(npmIdx >= 0, 'npm test 必选');
  assert.ok(openspecIdx >= 0, 'OpenSpec strict validate 必选');
  assert.ok(cargoIdx < openspecIdx && npmIdx < openspecIdx, 'OpenSpec 在 lane 汇合后执行');
  // 每条命令产生结构化 step（command + cwd + timeoutMs）。
  for (const p of plans) assert.ok(p.command && p.cwd && p.timeoutMs, `step ${p.step} 缺少执行元数据`);
  // 搜索联动回归：specs 标记了取词/换源/并发/离线任一维度时，verify.steps 逐项记录且缺失必选项即失败。
  const regSteps = verify.searchRegressionSteps('workflow-core', REPO);
  const regNames = regSteps.map((s) => s.step);
  assert.ok(regSteps.length > 0, 'specs 含搜索联动维度时应有回归步骤');
  assert.ok(regNames.some((s) => s.includes('取词')), '取词回归必选');
  assert.ok(regNames.some((s) => s.includes('换源')), '换源回归必选');
  assert.ok(regNames.some((s) => s.includes('并发')), '并发回归必选');
  assert.ok(regNames.some((s) => s.includes('离线')), '离线判定回归必选');
});
