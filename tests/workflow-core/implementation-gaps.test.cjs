'use strict';

// Fail-closed implementation regressions found during the scenario audit.
// These assertions are intentionally executable: a static roles/manifest check
// is not enough when run.js consumes registry.get(), and a returned suspended
// result is not enough when the node state machine is required to persist it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const registry = require('../../.agents/tools/pipe-core/drivers/registry.js');
const core = require('../../.agents/tools/pipe-core/core.js');
const stateApi = require('../../.agents/tools/pipe-core/state.js');

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

test('role injection contract: registry.get exposes the manifest capability consumed by run.js', () => {
  const expected = {
    claude: 'system-prompt-file',
    codex: 'prompt-prefix',
    opencode: 'prompt-prefix',
  };
  for (const [name, roleInjection] of Object.entries(expected)) {
    assert.equal(
      registry.get(name).roleInjection,
      roleInjection,
      `${name} 的 registry.get() 必须返回 roleInjection，否则公共 wrapper 不会注入 roles/ 单源文案`,
    );
  }
});

test('suspended state contract: an escalated node is persisted as suspended, not only returned as suspended', async () => {
  const repo = tempRepo('workflow-core-suspended-state-');
  const previous = process.env.PIPE_CORE_REPO_ROOT;
  process.env.PIPE_CORE_REPO_ROOT = repo;
  try {
    const change = 'suspended-state';
    const state = stateApi.newState(change, 'mock');
    const result = await core.runPipeline({
      change,
      state,
      defsFn: () => [{
        id: 'n1',
        role: 'tester',
        prompt: 'audit',
        schema: { type: 'object' },
        dependsOn: [],
        retry: { max: 0, intervalMs: 0 },
      }],
      driver: { runAgent: () => ({ ok: false, error: { kind: 'config', message: 'needs user decision' } }) },
      commitRoot: repo,
      getHead: () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
    });

    assert.equal(result.status, 'suspended');
    assert.equal(state.nodes.n1.status, 'suspended', '挂起是节点状态机终态，必须落盘供 --resume 读取');
    const persisted = JSON.parse(fs.readFileSync(stateApi.stateFile(change), 'utf8'));
    assert.equal(persisted.nodes.n1.status, 'suspended');
  } finally {
    if (previous === undefined) delete process.env.PIPE_CORE_REPO_ROOT;
    else process.env.PIPE_CORE_REPO_ROOT = previous;
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
