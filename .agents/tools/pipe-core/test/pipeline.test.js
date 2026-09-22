'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const pipeline = require('../pipeline.js');

function stateWithDomain(domain) {
  return {
    change: 'demo',
    nodes: {
      architect: {
        status: 'succeeded',
        result: { domain, designSummary: 's', keyDecisions: [], taskGroups: [] },
      },
    },
  };
}

test('pipeline: DOMAINS 六元 + 码/非码域划分', () => {
  assert.deepEqual(pipeline.DOMAINS, ['backend', 'frontend', 'both', 'docs', 'spec', 'infra']);
  assert.deepEqual(pipeline.CODE_DOMAINS, ['backend', 'frontend', 'both']);
  assert.deepEqual(pipeline.NON_CODE_DOMAINS, ['docs', 'spec', 'infra']);
});

test('pipeline: backend 域 → 只派 rust-backend 开发节点', () => {
  const defs = pipeline.buildPipeline(stateWithDomain('backend'));
  const devs = defs.filter((d) => d.id.startsWith('dev'));
  assert.equal(devs.length, 1);
  assert.equal(devs[0].id, 'dev-rust');
  assert.equal(devs[0].role, 'rust-backend');
  assert.deepEqual(devs[0].dependsOn, ['spec-gate']);
});

test('pipeline: frontend 域 → 只派 vue-frontend 开发节点', () => {
  const defs = pipeline.buildPipeline(stateWithDomain('frontend'));
  const devs = defs.filter((d) => d.id.startsWith('dev'));
  assert.equal(devs.length, 1);
  assert.equal(devs[0].id, 'dev-vue');
  assert.equal(devs[0].role, 'vue-frontend');
});

test('pipeline: both 域 → rust→vue 串行（vue dependsOn dev-rust）', () => {
  const defs = pipeline.buildPipeline(stateWithDomain('both'));
  const devs = defs.filter((d) => d.id.startsWith('dev'));
  assert.deepEqual(devs.map((d) => d.id), ['dev-rust', 'dev-vue']);
  assert.deepEqual(devs[1].dependsOn, ['dev-rust']);
});

test('pipeline: Agent 写入节点声明最小 writeScopes 和 core commit，prompt 禁止自行提交', () => {
  const both = pipeline.buildPipeline(stateWithDomain('both'));
  const rust = both.find((d) => d.id === 'dev-rust');
  const vue = both.find((d) => d.id === 'dev-vue');
  const tester = both.find((d) => d.id === 'tester');
  assert.deepEqual(rust.writeScopes, ['src-tauri/']);
  assert.deepEqual(vue.writeScopes, ['src/']);
  assert.deepEqual(tester.writeScopes, ['src-tauri/', 'src/']);
  for (const def of [rust, vue, tester]) {
    assert.match(def.commitMessage, /^feat\(demo\):/);
    assert.match(def.prompt({}), /不得执行 git add 或 git commit/);
  }

  const infra = pipeline.buildPipeline(stateWithDomain('infra'));
  const infraDev = infra.find((d) => d.id === 'dev');
  assert.deepEqual(infraDev.writeScopes, ['.agents/', '.claude/', '.opencode/', 'openspec/', 'tests/workflow-core/', 'AGENTS.md']);
});

test('pipeline: Architect 只可写当前 change 的 design/tasks 且不单独提交', () => {
  const architect = pipeline.buildPipeline({ change: 'demo', nodes: {} }).find((d) => d.id === 'architect');
  assert.deepEqual(architect.writeScopes, [
    'openspec/changes/demo/design.md',
    'openspec/changes/demo/tasks.md',
  ]);
  assert.equal(architect.coreCommit, false);
});

test('pipeline: docs/spec/infra 域 → leader 开发节点（自适应编排不触发业务编译门禁）', () => {
  for (const domain of ['docs', 'spec', 'infra']) {
    const defs = pipeline.buildPipeline(stateWithDomain(domain));
    const devs = defs.filter((d) => d.id.startsWith('dev'));
    assert.equal(devs.length, 1, domain);
    assert.equal(devs[0].role, 'leader', domain);
    assert.match(devs[0].prompt({}), /流程\/文档资产/);
  }
});

test('pipeline: dev 节点必须拒绝 done=false 的未完成结果', () => {
  const dev = pipeline.buildPipeline(stateWithDomain('infra')).find((d) => d.id === 'dev');
  assert.equal(dev.resultOk({ done: true }), true);
  assert.equal(dev.resultOk({ done: false }), false);
});

test('pipeline: architect 未判定前包含 bootstrap→architect→spec-gate 边界', () => {
  const defs = pipeline.buildPipeline({ change: 'demo', nodes: {} });
  assert.deepEqual(defs.map((d) => d.id), ['bootstrap', 'architect', 'spec-gate']);
});

test('pipeline: bootstrap/spec-gate 均 fail-closed', () => {
  for (const id of ['bootstrap', 'spec-gate']) {
    const gate = pipeline.buildPipeline({ change: 'demo', nodes: {} }).find((d) => d.id === id);
    assert.equal(gate.resultOk({ ready: true }), true);
    assert.equal(gate.resultOk({ ready: false }), false);
  }
});

test('pipeline: 完整 DAG 拓扑顺序 bootstrap→architect→spec-gate→dev→tester→cr→verify→integrate', () => {
  const defs = pipeline.buildPipeline(stateWithDomain('infra'));
  const ids = defs.map((d) => d.id);
  for (const [a, b] of [['bootstrap', 'architect'], ['architect', 'spec-gate'], ['spec-gate', 'dev'], ['dev', 'tester'], ['tester', 'cr'], ['cr', 'verify'], ['verify', 'integrate']]) {
    const idxA = ids.indexOf(a);
    const idxB = ids.indexOf(b);
    assert.ok(idxA >= 0 && idxB >= 0 && idxA < idxB, `${a} → ${b}`);
  }
});

test('pipeline: 内置节点显式 kind，确定性节点不携带 Agent role/prompt', () => {
  const defs = pipeline.buildPipeline(stateWithDomain('infra'));
  for (const def of defs) assert.ok(['agent', 'deterministic'].includes(def.kind), def.id);
  for (const id of ['bootstrap', 'spec-gate', 'verify', 'integrate']) {
    const def = defs.find((item) => item.id === id);
    assert.equal(def.kind, 'deterministic');
    assert.equal(typeof def.runner, 'string');
    assert.equal(def.role, undefined);
    assert.equal(def.prompt, undefined);
  }
});

test('pipeline: verify 对 infra 域交给确定性 runner', () => {
  const defs = pipeline.buildPipeline(stateWithDomain('infra'));
  const verify = defs.find((d) => d.id === 'verify');
  assert.equal(verify.kind, 'deterministic');
  assert.equal(verify.runner, 'verify');
  assert.equal(verify.domain, 'infra');
});

test('pipeline: infra 域 verify 携带 change/domain 供 runner 生成计划', () => {
  const defs = pipeline.buildPipeline(stateWithDomain('infra'));
  const verify = defs.find((d) => d.id === 'verify');
  assert.equal(verify.change, 'demo');
  assert.equal(verify.domain, 'infra');
});

test('pipeline: code 域 verify 仍由同一定义传递 domain', () => {
  const defs = pipeline.buildPipeline(stateWithDomain('both'));
  const verify = defs.find((d) => d.id === 'verify');
  assert.equal(verify.runner, 'verify');
  assert.equal(verify.domain, 'both');
});

test('pipeline: devSpec infra 域自验证只跑 node/openspec，不跑 cargo/npm', () => {
  const p = pipeline.devSpec('demo', 'infra');
  assert.match(p, /node --test/);
  assert.ok(!p.includes('cargo test'));
  assert.doesNotMatch(p, /git add \+ commit/);
  assert.match(p, /提交由 core 统一完成/);
});

test('pipeline: CR 复盘专项三检（跨模块状态/竞态与串扰/网络与离线判定）在新核心保留', () => {
  const defs = pipeline.buildPipeline(stateWithDomain('both'));
  const cr = defs.find((d) => d.id === 'cr');
  const p = cr.prompt({});
  assert.match(p, /跨模块状态语义/);
  assert.match(p, /竞态与串扰/);
  assert.match(p, /网络与离线判定/);
  assert.match(p, /specReference/);
  assert.match(p, /pass=true 仅当无 blocker 且无 major/);
});

test('pipeline: integrate 由确定性 runner 执行', () => {
  const integrate = pipeline.buildPipeline(stateWithDomain('infra')).find((d) => d.id === 'integrate');
  assert.equal(integrate.kind, 'deterministic');
  assert.equal(integrate.runner, 'integrate');
});

test('pipeline: integrate 只有真实 PR 合并才算成功', () => {
  const integrate = pipeline.buildPipeline(stateWithDomain('infra')).find((d) => d.id === 'integrate');
  assert.equal(integrate.resultOk({ archived: true, prUrl: '', merged: false, summary: 'PR 创建失败' }), false);
  assert.equal(integrate.resultOk({ archived: true, prUrl: 'https://github.com/x/y/pull/1', merged: true, summary: 'merged' }), true);
});
