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
  assert.deepEqual(devs[0].dependsOn, ['architect']);
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

test('pipeline: docs/spec/infra 域 → leader 开发节点（自适应编排不触发业务编译门禁）', () => {
  for (const domain of ['docs', 'spec', 'infra']) {
    const defs = pipeline.buildPipeline(stateWithDomain(domain));
    const devs = defs.filter((d) => d.id.startsWith('dev'));
    assert.equal(devs.length, 1, domain);
    assert.equal(devs[0].role, 'leader', domain);
    assert.match(devs[0].prompt({}), /流程\/文档资产/);
  }
});

test('pipeline: architect 未判定前仅 preflight+architect 两个节点', () => {
  const defs = pipeline.buildPipeline({ change: 'demo', nodes: {} });
  assert.deepEqual(defs.map((d) => d.id).sort(), ['architect', 'preflight']);
});

test('pipeline: 完整 DAG 拓扑顺序 preflight→architect→dev→tester→cr→verify→integrate', () => {
  const defs = pipeline.buildPipeline(stateWithDomain('infra'));
  const ids = defs.map((d) => d.id);
  for (const [a, b] of [['preflight', 'architect'], ['architect', 'dev'], ['dev', 'tester'], ['tester', 'cr'], ['cr', 'verify'], ['verify', 'integrate']]) {
    const idxA = ids.indexOf(a);
    const idxB = ids.indexOf(b);
    assert.ok(idxA >= 0 && idxB >= 0 && idxA < idxB, `${a} → ${b}`);
  }
});

test('pipeline: verify prompt 对 infra 域跳过 cargo/npm，执行短路基线', () => {
  const defs = pipeline.buildPipeline(stateWithDomain('infra'));
  const verify = defs.find((d) => d.id === 'verify');
  const p = verify.prompt({});
  assert.match(p, /自适应编排跳过业务编译/);
  assert.match(p, /node --test/);
  assert.ok(!p.includes('cargo check'));
});

test('pipeline: infra 域 verify 测试命令必须 glob 形式（目录形式在 Node≥22 必 exit 1，独立复核 major）', () => {
  const defs = pipeline.buildPipeline(stateWithDomain('infra'));
  const verify = defs.find((d) => d.id === 'verify');
  const p = verify.prompt({});
  // 必须是 glob test/*.test.js，不是目录 .agents/tools/pipe-core/（该目录形式实测 exit 1）
  assert.match(p, /node --test \.agents\/tools\/pipe-core\/test\/\*\.test\.js/);
  assert.doesNotMatch(p, /node --test \.agents\/tools\/pipe-core\/(?!test)/);
});

test('pipeline: verify prompt 对 code 域跑统一基线 + 复盘回归', () => {
  const defs = pipeline.buildPipeline(stateWithDomain('both'));
  const verify = defs.find((d) => d.id === 'verify');
  const p = verify.prompt({});
  assert.match(p, /cargo check --manifest-path src-tauri\/Cargo.toml/);
  assert.match(p, /npm run build/);
  assert.match(p, /复盘回归清单/);
});

test('pipeline: devSpec infra 域自验证只跑 node/openspec，不跑 cargo/npm', () => {
  const p = pipeline.devSpec('demo', 'infra');
  assert.match(p, /node --test/);
  assert.ok(!p.includes('cargo test'));
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
