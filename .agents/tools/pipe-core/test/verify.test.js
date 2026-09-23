'use strict';
// Verify 确定性 runner 测试（5.1/5.2/5.3）：
//  - 5.1 源码快照：target/dist/cache 可写，源码/规格/fixture/HEAD 修改 → source-mutation 失败并报精确路径。
//  - 5.2 按域验证计划：infra/code 域每条命令产生结构化 step，短路/失败记录。
//  - 5.3 lane 并发 + 汇合门禁 + 输入摘要缓存（同一 HEAD cache hit，输入变化失效）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');
const verify = require('../verify.js');

function tmpRepoWithChange(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix || 'pipe-verify-'));
  execSync('git init -q && git config user.email t@t && git config user.name t', { cwd: dir });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src-tauri'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'openspec', 'changes', 'demo', 'specs'), { recursive: true });
  // infra 计划检查 .agents/tools/pipe-core/run.js 与 .agents/workflows/pipe-preflight.sh 存在性。
  fs.mkdirSync(path.join(dir, '.agents', 'tools', 'pipe-core'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.agents', 'tools', 'pipe-core', 'run.js'), '#!/usr/bin/env node\nconsole.log("stub-run");\n');
  require('./seed.js').seedWorkflows(dir);
  fs.writeFileSync(path.join(dir, 'src', 'a.rs'), 'fn main() {}');
  fs.writeFileSync(path.join(dir, 'src-tauri', 'Cargo.toml'), '[package]\nname="demo"\n');
  fs.writeFileSync(path.join(dir, 'openspec', 'changes', 'demo', 'spec.md'), '# spec');
  fs.writeFileSync(path.join(dir, '.gitignore'), '.agents/runs/\ntarget/\ndist/\n');
  execSync('git add . && git commit -qm init', { cwd: dir });
  return dir;
}

// 假命令目录：按需放行 `cargo`、`npm`、`npx` 桩。
function fakeCmdDir(failOn = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-verify-cmds-'));
  const write = (name, body) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, `#!/usr/bin/env bash\nset -e\n${body}\n`);
    fs.chmodSync(file, 0o755);
  };
  write('cargo', 'echo fake-cargo "$@"; exit 0');
  write('npm', 'echo fake-npm "$@"; exit 0');
  write('npx', 'echo fake-npx "$@"; exit 0');
  // node 桩：--check / --self-check / --test 一律假成功（temp repo 测试目录不存在也可短路）。
  write('node', 'exit 0');
  for (const name of ['cargo', 'npm', 'npx', 'node']) {
    if (failOn.includes(name)) write(name, `echo fake-${name} "$@"; exit 1`);
  }
  return dir;
}

function baseCtx(repo, opts = {}) {
  return {
    env: {
      ...process.env,
      PIPE_FAKE_CMDS: opts.fakeCmdDir || fakeCmdDir(),
      ...(opts.concurrency ? { PIPE_VERIFY_CONCURRENCY: opts.concurrency } : {}),
    },
  };
}

function defFor(domain, change = 'demo') {
  return { id: 'verify', kind: 'deterministic', runner: 'verify', change, domain, schema: {} };
}

test('verify 5.1: target/dist/cache 写目录允许，源码污染路径精确报告', async () => {
  const repo = tmpRepoWithChange('pipe-verify-whitelist-');
  const cmds = fakeCmdDir();
  // 构建产物 lane 写 target/（白名单允许）
  fs.mkdirSync(path.join(repo, 'src-tauri', 'target', 'debug'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src-tauri', 'target', 'debug', 'bin'), 'built');
  const ctx = baseCtx(repo, { fakeCmdDir: cmds });
  const state = { change: 'demo', nodes: {} };
  const res = await verify.runVerify({ def: defFor('backend'), change: 'demo', state, ctx, root: repo, log: () => {}, saveState: () => {} });
  assert.equal(res.ok, true, JSON.stringify(res.structured));
  assert.equal(res.structured.pass, true);
  assert.ok(res.structured.steps.some((s) => s.step === 'cargo check' && s.status === 'pass'));

  // 源码污染：fake cargo 在运行时改 src/a.rs → source-mutation。
  const dirty = tmpRepoWithChange('pipe-verify-source-');
  const cmds2 = fakeCmdDir();
  fs.writeFileSync(path.join(cmds2, 'cargo'), `#!/usr/bin/env bash\necho "polluting" >> "${path.join(dirty, 'src', 'a.rs')}"\nexit 0\n`);
  fs.chmodSync(path.join(cmds2, 'cargo'), 0o755);
  const ctx2 = baseCtx(dirty, { fakeCmdDir: cmds2 });
  const state2 = { change: 'demo', nodes: {} };
  const res2 = await verify.runVerify({ def: defFor('backend'), change: 'demo', state: state2, ctx: ctx2, root: dirty, log: () => {}, saveState: () => {} });
  assert.equal(res2.ok, false);
  assert.equal(res2.error.kind, 'source-mutation');
  assert.match(res2.error.message, /src\/a\.rs/);
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(dirty, { recursive: true, force: true });
});

test('verify 5.2: infra 域生成结构化步骤，含 node 检查、self-check、OpenSpec，不跑 cargo/npm', async () => {
  const repo = tmpRepoWithChange('pipe-verify-infra-');
  const cmds = fakeCmdDir();
  const ctx = baseCtx(repo, { fakeCmdDir: cmds });
  const state = { change: 'demo', nodes: {} };
  const res = await verify.runVerify({ def: defFor('infra'), change: 'demo', state, ctx, root: repo, log: () => {}, saveState: () => {} });
  assert.equal(res.ok, true, JSON.stringify(res.structured));
  const stepNames = res.structured.steps.map((s) => s.step);
  assert.ok(stepNames.includes('node 静态检查'), stepNames.join(','));
  assert.ok(stepNames.includes('shell 静态检查'), stepNames.join(','));
  assert.ok(stepNames.includes('OpenSpec strict validate'), stepNames.join(','));
  // infra 不跑 cargo/npm
  assert.ok(!stepNames.some((s) => s.includes('cargo') || s.includes('npm')), stepNames.join(','));
  // 每条命令产生结构化 step
  for (const step of res.structured.steps) {
    assert.ok(typeof step.step === 'string' && step.step.length > 0);
    assert.ok(step.status === 'pass' || step.status === 'fail');
  }
  fs.rmSync(repo, { recursive: true, force: true });
});

test('verify 5.3: 默认串行，PIPE_VERIFY_CONCURRENCY=parallel 时 lane 汇合后跑 OpenSpec', async () => {
  const repo = tmpRepoWithChange('pipe-verify-lane-');
  const cmds = fakeCmdDir();
  const ctx = baseCtx(repo, { fakeCmdDir: cmds, concurrency: 'parallel' });
  const state = { change: 'demo', nodes: {} };
  const res = await verify.runVerify({ def: defFor('both'), change: 'demo', state, ctx, root: repo, log: () => {}, saveState: () => {} });
  assert.equal(res.ok, true, JSON.stringify(res.structured));
  const stepNames = res.structured.steps.map((s) => s.step);
  assert.ok(stepNames.includes('cargo check') && stepNames.includes('npm test'));
  assert.ok(stepNames.includes('OpenSpec strict validate'));
  // 默认串行：断言同一计划在 serial 下也通过。
  const ctx2 = baseCtx(repo, { fakeCmdDir: cmds, concurrency: 'serial' });
  const state2 = { change: 'demo', nodes: {} };
  const res2 = await verify.runVerify({ def: defFor('both'), change: 'demo', state: state2, ctx: ctx2, root: repo, log: () => {}, saveState: () => {} });
  assert.equal(res2.ok, true);
  assert.ok(res2.structured.steps.every((s) => s.status === 'pass'));
  fs.rmSync(repo, { recursive: true, force: true });
});

test('verify 5.3: 同一 HEAD cache hit，输入变化（计划摘要）后失效重跑', async () => {
  const repo = tmpRepoWithChange('pipe-verify-cache-');
  const cmds = fakeCmdDir();
  const ctx = baseCtx(repo, { fakeCmdDir: cmds });
  const state = { change: 'demo', nodes: {} };
  const def = defFor('infra');
  const r1 = await verify.runVerify({ def, change: 'demo', state, ctx, root: repo, log: () => {}, saveState: () => {} });
  assert.equal(r1.ok, true, JSON.stringify(r1.structured));
  // 模拟 succeeded 落盘 + cacheKey。
  state.nodes.verify = { status: 'succeeded', result: r1.structured, cacheKey: r1.structured.cacheKey };
  const r2 = await verify.runVerify({ def, change: 'demo', state, ctx, root: repo, log: () => {}, saveState: () => {} });
  assert.equal(r2.ok, true);
  assert.equal(r2.structured.cacheHit, true, '同一 HEAD 应 cache hit');
  // 输入变化：改 domain → 计划摘要变化 → cache miss。
  const r3 = await verify.runVerify({ def: defFor('backend'), change: 'demo', state, ctx, root: repo, log: () => {}, saveState: () => {} });
  assert.equal(r3.structured.cacheHit, false, '输入（计划）变化应 cache miss');
  fs.rmSync(repo, { recursive: true, force: true });
});