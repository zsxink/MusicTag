'use strict';

// P6 共享 conformance：同一组行为断言逐一跑过 claude/codex/opencode，
// 防止某个 runtime 只在 registry 层“看起来兼容”，实际缺 cwd、结构化输出、
// 协议错误或超时语义。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const claude = require('../../.agents/tools/pipe-core/drivers/claude.js');
const codex = require('../../.agents/tools/pipe-core/drivers/codex.js');
const opencode = require('../../.agents/tools/pipe-core/drivers/opencode.js');
const epic = require('../../.agents/tools/pipe-core/epic.js');
const OPENCODE_PIPE_FIXTURE = path.resolve(__dirname, '../../.agents/tools/pipe-core/test/fixtures/fake-pipe-common.js');
const REPO = path.resolve(__dirname, '../..');
const pipeline = require('../../.agents/tools/pipe-core/pipeline.js');

const SCHEMA = {
  type: 'object',
  properties: { ready: { type: 'boolean' } },
  required: ['ready'],
};

function executable(dir, name, body) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!/usr/bin/env node\n${body}\n`);
  fs.chmodSync(file, 0o755);
  return file;
}

function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-core-conformance-'));
  const cwd = path.join(dir, 'worktree');
  fs.mkdirSync(cwd);
  const marker = path.join(cwd, 'cwd.txt');
  const writeCwd = `require('node:fs').writeFileSync(${JSON.stringify(marker)}, process.cwd());`;
  const runtimes = {
    claude: {
      module: claude,
      ctx: { claudeBin: executable(dir, 'claude.js', `${writeCwd}\nprocess.stdout.write(JSON.stringify({ structured_output: { ready: true } }));`) },
      badProtocol: { claudeBin: executable(dir, 'claude-bad.js', 'process.stdout.write("{broken");') },
      timeout: { claudeBin: executable(dir, 'claude-timeout.js', 'setTimeout(() => {}, 500);') },
    },
    codex: {
      module: codex,
      ctx: { codexBin: executable(dir, 'codex.js', `${writeCwd}\nconst fs=require('node:fs');const i=process.argv.indexOf('-o');fs.writeFileSync(process.argv[i+1], JSON.stringify({ ready: true }));`) },
      badProtocol: { codexBin: executable(dir, 'codex-bad.js', 'const fs=require("node:fs");const i=process.argv.indexOf("-o");fs.writeFileSync(process.argv[i+1], "{broken");') },
      timeout: { codexBin: executable(dir, 'codex-timeout.js', 'setTimeout(() => {}, 500);') },
    },
    opencode: {
      module: opencode,
      ctx: { opencodeBin: executable(dir, 'opencode.js', `${writeCwd}\nprocess.stdout.write(JSON.stringify({ type: 'message', role: 'assistant', final: true, content: '{\\"ready\\":true}' }) + '\\n');`) },
      badProtocol: { opencodeBin: executable(dir, 'opencode-bad.js', 'process.stdout.write("not-ndjson\\n");') },
      timeout: { opencodeBin: executable(dir, 'opencode-timeout.js', 'setTimeout(() => {}, 500);') },
    },
  };
  return { dir, cwd, marker, runtimes };
}

function task() {
  return { id: 'conformance', role: 'tester', prompt: 'return the structured result', schema: SCHEMA };
}

test('P4 adaptive verify conformance: docs/spec/infra skip cargo and npm', () => {
  const verify = require('../../.agents/tools/pipe-core/verify.js');
  for (const domain of ['docs', 'spec', 'infra']) {
    const plans = verify.buildPlan({ change: 'workflow-core', domain, root: REPO });
    const steps = plans.map((p) => p.step);
    assert.ok(steps.includes('OpenSpec strict validate'), `${domain} 必须含 OpenSpec strict validate`);
    assert.doesNotMatch(steps.join(','), /cargo (check|test)/, `${domain} 不得跑 cargo`);
    assert.doesNotMatch(steps.join(','), /npm run (test|build)/, `${domain} 不得跑 npm`);
    if (domain === 'infra') {
      assert.ok(steps.includes('node 静态检查'), 'infra 必须含 node 静态检查');
      assert.ok(steps.includes('shell 静态检查'), 'infra 必须含 shell 静态检查');
      assert.ok(steps.includes('pipe-core/workflow-core 全量测试'), 'infra 必须含全量测试');
      assert.ok(steps.includes('self-check'), 'infra 必须含 self-check');
    }
    if (domain === 'docs' || domain === 'spec') {
      assert.ok(steps.includes('文档一致性审计'), `${domain} 必须含文档一致性审计`);
    }
  }
});

test('P4 adaptive verify conformance: backend/frontend/both 含业务基线且 OpenSpec 汇合后执行', () => {
  const verify = require('../../.agents/tools/pipe-core/verify.js');
  for (const domain of ['backend', 'frontend', 'both']) {
    const plans = verify.buildPlan({ change: 'workflow-core', domain, root: REPO });
    const steps = plans.map((p) => p.step);
    const openspecIdx = steps.lastIndexOf('OpenSpec strict validate');
    assert.ok(openspecIdx >= 0, `${domain} 必须含 OpenSpec`);
    if (domain === 'backend' || domain === 'both') {
      assert.ok(steps.indexOf('cargo check') >= 0 && steps.indexOf('cargo test') >= 0, `${domain} 必须含 cargo 基线`);
    }
    if (domain === 'frontend' || domain === 'both') {
      assert.ok(steps.indexOf('npm test') >= 0 && steps.indexOf('npm build') >= 0, `${domain} 必须含 npm 基线`);
    }
    // both：业务 lane 之后才是 OpenSpec 汇合门禁。
    if (domain === 'both') {
      const lastBusiness = Math.max(...steps.map((s, i) => (s.startsWith('cargo') || s.startsWith('npm') ? i : -1)));
      assert.ok(openspecIdx > lastBusiness, 'both 的 OpenSpec 在业务 lane 汇合后执行');
    }
  }
});

test('P6 shared conformance: all registered drivers preserve cwd and structured output', () => {
  const h = harness();
  try {
    for (const [name, runtime] of Object.entries(h.runtimes)) {
      const result = runtime.module.runAgent(task(), { ...runtime.ctx, cwd: h.cwd });
      assert.equal(result.ok, true, `${name} success result`);
      assert.deepEqual(result.structured, { ready: true }, `${name} structured result`);
      assert.equal(fs.realpathSync(fs.readFileSync(h.marker, 'utf8')), fs.realpathSync(h.cwd), `${name} child cwd`);
      fs.rmSync(h.marker, { force: true });
    }
  } finally {
    fs.rmSync(h.dir, { recursive: true, force: true });
  }
});

test('P6 shared conformance: all registered drivers classify damaged output as protocol', () => {
  const h = harness();
  try {
    for (const [name, runtime] of Object.entries(h.runtimes)) {
      const result = runtime.module.runAgent(task(), { ...runtime.badProtocol, cwd: h.cwd });
      assert.equal(result.ok, false, `${name} malformed output must fail`);
      assert.equal(result.error.kind, 'protocol', `${name} malformed output kind`);
    }
  } finally {
    fs.rmSync(h.dir, { recursive: true, force: true });
  }
});

test('P6 shared conformance: all registered drivers expose timeout termination', () => {
  const h = harness();
  try {
    for (const [name, runtime] of Object.entries(h.runtimes)) {
      const result = runtime.module.runAgent(task(), { ...runtime.timeout, cwd: h.cwd, timeoutMs: 20 });
      assert.equal(result.ok, false, `${name} timeout must fail`);
      assert.equal(result.error.kind, 'timeout', `${name} timeout kind`);
      assert.equal(result.error.retryable, true, `${name} timeout retryability`);
    }
  } finally {
    fs.rmSync(h.dir, { recursive: true, force: true });
  }
});

test('P6 epic OpenCode conformance: three parallel worktrees receive isolated cwd', async () => {
  const h = harness();
  const main = path.join(h.dir, 'main');
  fs.mkdirSync(main);
  const git = (args) => execFileSync('git', args, { cwd: main, stdio: 'ignore' });
  const timeline = path.join(main, 'cwd-timeline.txt');
  const fake = executable(h.dir, 'opencode-epic.js', [
    `const fs=require('node:fs');fs.appendFileSync(${JSON.stringify(timeline)}, process.cwd()+'\\n');`,
    `const { outputFor }=require(${JSON.stringify(OPENCODE_PIPE_FIXTURE)});`,
    "const prompt=process.argv[process.argv.length-1]||'';",
    "process.stdout.write(JSON.stringify({type:'message',role:'assistant',final:true,content:JSON.stringify(outputFor(prompt))})+'\\n');",
  ].join('\n'));
  const previousRoot = process.env.PIPE_CORE_REPO_ROOT;
  const previousBin = process.env.PIPE_OPENCODE_BIN;
  const previousPolicy = process.env.PIPE_OPENCODE_READ_ONLY_POLICY;
  try {
    fs.writeFileSync(path.join(main, '.gitignore'), '.worktrees/\n.agents/runs/\n');
    fs.writeFileSync(path.join(main, 'seed.txt'), 'seed');
    git(['init', '-q']);
    git(['config', 'user.email', 'test@example.com']);
    git(['config', 'user.name', 'test']);
    git(['add', '.']);
    git(['commit', '-qm', 'init']);
    fs.mkdirSync(path.join(main, 'openspec', 'epics', 'e'), { recursive: true });
    fs.writeFileSync(path.join(main, 'openspec', 'epics', 'e', 'epic.json'), JSON.stringify({
      name: 'e',
      items: ['A', 'B', 'C'].map((name) => ({ name, dependsOn: [], status: 'pending', issue: 1 })),
    }));
    git(['add', 'openspec']);
    git(['commit', '-qm', 'add epic']);

    process.env.PIPE_CORE_REPO_ROOT = main;
    process.env.PIPE_OPENCODE_BIN = fake;
    process.env.PIPE_OPENCODE_READ_ONLY_POLICY = 'enforced';
    const code = await epic.run('e', 'opencode');
    assert.equal(code, 0);
    const paths = fs.readFileSync(timeline, 'utf8').trim().split('\n').filter(Boolean).map((p) => path.resolve(p));
    assert.equal(paths.length, 21, '三个子项各自完整执行 7 个节点');
    for (const name of ['A', 'B', 'C']) {
      const expected = path.join(fs.realpathSync(main), '.worktrees', name);
      assert.equal(paths.filter((p) => p === expected).length, 7, `${name} 的 7 个节点必须使用同一独立 worktree cwd`);
      assert.ok(!fs.existsSync(path.join(main, name)), `${name} 不得写入主仓库`);
    }
    fs.rmSync(timeline, { force: true });
    assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: main, encoding: 'utf8' }).trim(), '');
  } finally {
    if (previousRoot === undefined) delete process.env.PIPE_CORE_REPO_ROOT;
    else process.env.PIPE_CORE_REPO_ROOT = previousRoot;
    if (previousBin === undefined) delete process.env.PIPE_OPENCODE_BIN;
    else process.env.PIPE_OPENCODE_BIN = previousBin;
    if (previousPolicy === undefined) delete process.env.PIPE_OPENCODE_READ_ONLY_POLICY;
    else process.env.PIPE_OPENCODE_READ_ONLY_POLICY = previousPolicy;
    try { execFileSync('git', ['worktree', 'prune'], { cwd: main, stdio: 'ignore' }); } catch (_) { /* cleanup best effort */ }
    fs.rmSync(h.dir, { recursive: true, force: true });
  }
});
