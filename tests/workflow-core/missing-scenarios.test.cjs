'use strict';

// Fail-closed audit additions for workflow-core. These cases must exercise
// runtime guardrails rather than only checking that a prompt/source string
// exists. A failing assertion is an implementation defect and blocks CR.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '../..');
const CORE = path.join(REPO, '.agents', 'tools', 'pipe-core');
const RUNJS = path.join(CORE, 'run.js');

function tempRepo(prefix) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'seed.txt'), 'seed');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: repo });
  return repo;
}

test('contract boundary: an unknown DriverResult error kind is canonicalized', () => {
  const contract = require('../../.agents/tools/pipe-core/drivers/contract.js');
  const result = contract.normalizeResult({
    ok: false,
    error: { kind: 'vendor-private-kind', message: 'unclassified runtime failure' },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'agent', '核心不得把非标准 kind 传播到决断链');
  assert.equal(result.error.retryable, true);
});

test('core boundary: reroute repair output must pass DEV_SCHEMA before re-review', () => {
  const core = require('../../.agents/tools/pipe-core/core.js');
  const stateApi = require('../../.agents/tools/pipe-core/state.js');
  const repo = tempRepo('workflow-core-reroute-contract-');
  const previous = process.env.PIPE_CORE_REPO_ROOT;
  process.env.PIPE_CORE_REPO_ROOT = repo;
  let crCalls = 0;

  try {
    const state = stateApi.newState('reroute-contract', 'mock');
    const result = core.runPipeline({
      change: 'reroute-contract',
      state,
      defsFn: () => [{
        id: 'cr',
        role: 'cr-agent',
        prompt: 'review',
        schema: { type: 'object', required: ['pass'], properties: { pass: { type: 'boolean' } } },
        dependsOn: [],
        maxRounds: 2,
        retry: { max: 1, intervalMs: 0 },
        resultOk: (value) => value.pass === true,
      }],
      decider: () => ({
        action: 'reroute',
        node: 'cr',
        reason: '修复后复审',
        problems: [{ file: 'src/App.vue', issue: '缺陷', specReference: 'spec', suggestion: '修复' }],
      }),
      driver: {
        runAgent(task) {
          if (task.id === 'cr') {
            crCalls += 1;
            return { ok: true, structured: { pass: crCalls > 1 } };
          }
          // Missing DEV_SCHEMA.summary is deliberately invalid.
          return { ok: true, structured: { done: true } };
        },
      },
      commitRoot: repo,
      getHead: () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
    });

    assert.equal(result.status, 'suspended');
    assert.equal(result.stage, 'reroute-fix-failed');
  } finally {
    if (previous === undefined) delete process.env.PIPE_CORE_REPO_ROOT;
    else process.env.PIPE_CORE_REPO_ROOT = previous;
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('core boundary: an empty task prompt is rejected before the driver runs', () => {
  const core = require('../../.agents/tools/pipe-core/core.js');
  const stateApi = require('../../.agents/tools/pipe-core/state.js');
  const repo = tempRepo('workflow-core-empty-task-');
  const previous = process.env.PIPE_CORE_REPO_ROOT;
  process.env.PIPE_CORE_REPO_ROOT = repo;
  let calls = 0;

  try {
    const state = stateApi.newState('empty-task', 'mock');
    core.runPipeline({
      change: 'empty-task',
      state,
      defsFn: () => [{
        id: 'n1',
        role: 'tester',
        prompt: '   ',
        schema: { type: 'object' },
        dependsOn: [],
      }],
      driver: {
        runAgent() {
          calls += 1;
          return { ok: true, structured: {} };
        },
      },
      commitRoot: repo,
      getHead: () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
    });
  } finally {
    if (previous === undefined) delete process.env.PIPE_CORE_REPO_ROOT;
    else process.env.PIPE_CORE_REPO_ROOT = previous;
    fs.rmSync(repo, { recursive: true, force: true });
  }

  assert.equal(calls, 0, '非法 task 不得先调用 runtime 再由结果兜底');
});

test('state boundary: a new node persists pending before ready/running', () => {
  const core = require('../../.agents/tools/pipe-core/core.js');
  const stateApi = require('../../.agents/tools/pipe-core/state.js');
  const repo = tempRepo('workflow-core-pending-state-');
  const previous = process.env.PIPE_CORE_REPO_ROOT;
  process.env.PIPE_CORE_REPO_ROOT = repo;
  const snapshots = [];
  const originalSave = stateApi.saveState;

  try {
    stateApi.saveState = (change, state) => {
      snapshots.push(state.nodes.n1 && state.nodes.n1.status);
      originalSave(change, state);
    };
    const state = stateApi.newState('pending-state', 'mock');
    core.runPipeline({
      change: 'pending-state',
      state,
      defsFn: () => [{ id: 'n1', role: 'tester', prompt: 'p', schema: { type: 'object' }, dependsOn: [] }],
      driver: { runAgent: () => ({ ok: true, structured: {} }) },
      commitRoot: repo,
      getHead: () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
    });
  } finally {
    stateApi.saveState = originalSave;
    if (previous === undefined) delete process.env.PIPE_CORE_REPO_ROOT;
    else process.env.PIPE_CORE_REPO_ROOT = previous;
    fs.rmSync(repo, { recursive: true, force: true });
  }

  assert.equal(snapshots[0], 'pending');
  assert.deepEqual(snapshots.slice(1, 3), ['ready', 'running']);
});

test('Claude driver boundary: exit 0 with damaged JSON is protocol failure', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-core-claude-protocol-'));
  const fake = path.join(dir, 'fake-claude.js');
  fs.writeFileSync(fake, '#!/usr/bin/env node\nprocess.stdout.write("not-json");\n');
  fs.chmodSync(fake, 0o755);
  try {
    const claude = require('../../.agents/tools/pipe-core/drivers/claude.js');
    const result = claude.runAgent({ id: 'n1', role: 'tester', prompt: 'P' }, { claudeBin: fake });
    assert.equal(result.ok, false);
    assert.equal(result.error.kind, 'protocol');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('read-only boundary: ignored workspace writes are rejected', () => {
  const core = require('../../.agents/tools/pipe-core/core.js');
  const stateApi = require('../../.agents/tools/pipe-core/state.js');
  const repo = tempRepo('workflow-core-readonly-ignored-');
  const previous = process.env.PIPE_CORE_REPO_ROOT;
  process.env.PIPE_CORE_REPO_ROOT = repo;

  try {
    fs.writeFileSync(path.join(repo, '.gitignore'), 'ignored.txt\n');
    execFileSync('git', ['add', '.gitignore'], { cwd: repo });
    execFileSync('git', ['commit', '-qm', 'ignore'], { cwd: repo });
    const state = stateApi.newState('readonly-ignored', 'mock');
    const result = core.runPipeline({
      change: 'readonly-ignored',
      state,
      defsFn: () => [{ id: 'cr', role: 'cr-agent', prompt: 'review', schema: { type: 'object' }, dependsOn: [] }],
      ctx: { readOnly: true, cwd: repo },
      driver: {
        runAgent() {
          fs.writeFileSync(path.join(repo, 'ignored.txt'), 'must be detected');
          return { ok: true, structured: {} };
        },
      },
      commitRoot: repo,
      getHead: () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
    });
    assert.equal(result.status, 'suspended');
    assert.equal(state.nodes.cr.errorKind, 'config');
  } finally {
    if (previous === undefined) delete process.env.PIPE_CORE_REPO_ROOT;
    else process.env.PIPE_CORE_REPO_ROOT = previous;
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('contract version boundary: module API mismatch is rejected before state creation', () => {
  const repo = tempRepo('workflow-core-api-mismatch-');
  const preload = path.join(repo, 'patch-registry.js');
  const registryFile = path.join(CORE, 'drivers', 'registry.js');
  fs.writeFileSync(preload, [
    "const Module = require('node:module');",
    "const originalLoad = Module._load;",
    "const target = process.env.PIPE_REGISTRY_FILE;",
    "Module._load = function(request, parent, isMain) {",
    "  const resolved = Module._resolveFilename(request, parent, isMain);",
    "  const value = originalLoad.apply(this, arguments);",
    "  if (resolved === target) return { ...value, get(name) {",
    "    const info = value.get(name);",
    "    return info && info.module ? { ...info, module: { ...info.module, API_VERSION: '0.0.0' } } : info;",
    "  } };",
    "  return value;",
    "};",
  ].join('\n'));

  try {
    const result = spawnSync(process.execPath, [
      '-r', preload, RUNJS, 'demo', '--driver', 'claude',
    ], {
      cwd: repo,
      encoding: 'utf8',
      env: {
        ...process.env,
        PIPE_CORE_REPO_ROOT: repo,
        PIPE_REGISTRY_FILE: registryFile,
        PIPE_CLAUDE_BIN: '/definitely-missing-claude',
      },
    });

    assert.equal(result.status, 2, `API mismatch must fail before pipeline: ${result.stderr}`);
    assert.match(result.stderr, /契约版本不兼容/);
    assert.equal(fs.existsSync(path.join(repo, '.agents', 'runs', 'demo', 'state.json')), false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('DAG boundary: non-positive maxConcurrency must fail closed instead of hanging', () => {
  const dagFile = path.join(CORE, 'dag.js');
  const probe = spawnSync(process.execPath, ['-e', [
    `const { batches } = require(${JSON.stringify(dagFile)});`,
    "batches([{ id: 'n1', dependsOn: [] }], { nodes: {} }, 0);",
  ].join('\n')], { encoding: 'utf8', timeout: 300 });

  assert.equal(probe.error, undefined, 'maxConcurrency=0 必须快速拒绝，不能进入无限循环');
  assert.notEqual(probe.status, 0, '非正并发上限必须返回明确错误');
});
