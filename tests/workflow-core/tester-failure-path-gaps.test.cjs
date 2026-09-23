'use strict';

// Tester 覆盖审计补齐：spec scenario 的失败路径与边界缺口。
// 这三条是审计发现的、spec 明确要求但此前无可执行 e2e 的断点：
//   1. 决断链「--force-retry 必须与 --resume 同用」的 CLI 约束（错误输入 fail-fast）。
//   2. P6/bootstrap–spec-gate 分离：「spec-gate 失败会阻止开发节点，dev 不得启动」。
//   3. Verify「源码不可变」：HEAD 被修改 / 规格（openspec/）被修改 → source-mutation 失败。
// 全部只跑受影响测试（临时 git 仓库 + fake driver），不重复 Verify 的完整本地基线。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '../..');
const RUNJS = path.join(REPO, '.agents', 'tools', 'pipe-core', 'run.js');
const FAKE_CLAUDE = path.join(REPO, '.agents', 'tools', 'pipe-core', 'test', 'fixtures', 'fake-pipe-claude.js');
const { seedWorkflows } = require(path.join(REPO, '.agents', 'tools', 'pipe-core', 'test', 'seed.js'));
const { fakeCommands } = require(path.join(REPO, '.agents', 'tools', 'pipe-core', 'test', 'fixtures', 'fake-pipe-commands.js'));

function tmpRepo(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix || 'tester-gap-'));
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email t@t && git config user.name t', { cwd: dir });
  seedWorkflows(dir);
  fs.writeFileSync(path.join(dir, '.gitignore'), '.agents/runs/\n');
  fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed');
  execSync('git add . && git commit -qm init', { cwd: dir });
  return dir;
}

test('决断链边界: --force-retry 未与 --resume 同用 → 退出码 2 拒绝（错误输入 fail-fast）', () => {
  const repo = tmpRepo('tester-gap-force-retry-');
  try {
    const res = spawnSync(process.execPath, [RUNJS, 'demo', '--force-retry', 'dev'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, PIPE_CORE_REPO_ROOT: repo, CLAUDECODE: '1', AI_AGENT: '', PIPE_CLAUDE_BIN: FAKE_CLAUDE },
    });
    assert.equal(res.status, 2, `--force-retry 无 --resume 必须拒绝，实际 exit ${res.status}`);
    assert.match(res.stderr, /--force-retry 必须与 --resume 同用/);
    // 不得产生任何 state 副作用。
    assert.equal(fs.existsSync(path.join(repo, '.agents', 'runs', 'demo', 'state.json')), false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('bootstrap/spec-gate 分离失败路径: spec-gate 失败 → dev 不启动且流程挂起', () => {
  const repo = tmpRepo('tester-gap-specgate-');
  // 真实 preflight 桩：bootstrap 阶段通过，spec-gate 阶段恒失败。
  //（seedWorkflows 已写入可执行桩，这里覆盖为可控失败版本。）
  const stub = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'change_name=${1:?}',
    'stage=${2:-all}',
    'if [ "$stage" = "spec-gate" ]; then',
    '  echo "spec-gate 校验失败（受控测试）" >&2',
    '  exit 1',
    'fi',
    'exit 0',
  ].join('\n');
  fs.writeFileSync(path.join(repo, '.agents', 'workflows', 'pipe-preflight.sh'), stub);
  fs.chmodSync(path.join(repo, '.agents', 'workflows', 'pipe-preflight.sh'), 0o755);
  const fake = fakeCommands({ verify: true, gitRemote: true, ghFlat: true });
  const env = {
    ...process.env,
    PIPE_CORE_REPO_ROOT: repo,
    CLAUDECODE: '1',
    AI_AGENT: '',
    PIPE_CLAUDE_BIN: FAKE_CLAUDE,
    ...fake.env(),
  };
  try {
    const res = spawnSync(process.execPath, [RUNJS, 'demo'], { cwd: repo, encoding: 'utf8', env });
    // spec-gate 失败（不可重试的 preflight 发现）→ 决断 escalate → 挂起退出 3。
    assert.equal(res.status, 3, `spec-gate 失败应挂起，实际 exit ${res.status}\nstdout=${res.stdout}\nstderr=${res.stderr}`);
    const stateFile = path.join(repo, '.agents', 'runs', 'demo', 'state.json');
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    const sg = state.nodes['spec-gate'];
    assert.equal(sg.status, 'suspended', 'spec-gate 应挂起');
    // dev 节点从未创建/执行（状态里不存在）。
    assert.equal(!!state.nodes.dev, false, 'spec-gate 失败时 dev 不得启动');
    // architect 已通过（它在 spec-gate 之前）。
    assert.equal(state.nodes.architect.status, 'succeeded', 'spec-gate 前 architect 已成功');
  } finally {
    fake.cleanup();
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('verify 不可变失败路径: 规格文件被验证命令修改 → source-mutation 失败并精确报告', async () => {
  const repo = tmpRepo('tester-gap-verify-spec-');
  // backend 域 verify 计划需要 src-tauri/Cargo.toml 与 .agents/tools/pipe-core/run.js（node 桩路径）。
  fs.mkdirSync(path.join(repo, 'src-tauri'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src-tauri', 'Cargo.toml'), '[package]\nname="demo"\n');
  fs.mkdirSync(path.join(repo, '.agents', 'tools', 'pipe-core'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.agents', 'tools', 'pipe-core', 'run.js'), 'console.log("stub");\n');
  fs.mkdirSync(path.join(repo, 'openspec', 'changes', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'openspec', 'changes', 'demo', 'spec.md'), '# baseline spec\n');
  fs.writeFileSync(path.join(repo, '.gitignore'), '.agents/runs/\ntarget/\ndist/\n');
  execSync('git add -A && git commit -qm "spec baseline"', { cwd: repo });

  const fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tester-gap-verifycmds-'));
  const writeFx = (name, body) => {
    const f = path.join(fakeDir, name);
    fs.writeFileSync(f, `#!/usr/bin/env bash\n${body}\n`);
    fs.chmodSync(f, 0o755);
  };
  writeFx('cargo', `echo 'polluting specs' >> "${path.join(repo, 'openspec', 'changes', 'demo', 'spec.md')}"; exit 0`);
  writeFx('npm', 'exit 0');
  writeFx('npx', 'exit 0');
  writeFx('node', 'exit 0');
  try {
    const verify = require(path.join(REPO, '.agents', 'tools', 'pipe-core', 'verify.js'));
    const ctx = { env: { ...process.env, PIPE_FAKE_CMDS: fakeDir } };
    const state = { change: 'demo', nodes: {} };
    const def = { id: 'verify', kind: 'deterministic', runner: 'verify', change: 'demo', domain: 'backend', schema: {} };
    const res = await verify.runVerify({ def, change: 'demo', state, ctx, root: repo, log: () => {}, saveState: () => {} });
    assert.equal(res.ok, false, 'tracked 规格文件被验证命令修改 → 必须 source-mutation 失败');
    assert.equal(res.error.kind, 'source-mutation');
    assert.match(res.error.message, /openspec[\\/]changes[\\/]demo[\\/]spec\.md/, '应精确报告污染路径');
  } finally {
    try { fs.rmSync(fakeDir, { recursive: true, force: true }); } catch (_) {}
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('verify 不可变失败路径: 验证命令改变 HEAD → source-mutation 精确报告 HEAD 变化', async () => {
  const repo = tmpRepo('tester-gap-verify-head-');
  // backend 域 verify 需要 src-tauri/Cargo.toml 与 .agents/tools/pipe-core/run.js（node 桩）。
  fs.mkdirSync(path.join(repo, 'src-tauri'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src-tauri', 'Cargo.toml'), '[package]\nname="demo"\n');
  fs.mkdirSync(path.join(repo, '.agents', 'tools', 'pipe-core'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.agents', 'tools', 'pipe-core', 'run.js'), 'console.log("stub");\n');
  fs.writeFileSync(path.join(repo, '.gitignore'), '.agents/runs/\ntarget/\ndist/\n');
  execSync('git add -A && git commit -qm "baseline"', { cwd: repo });

  const fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tester-gap-verifyhead-'));
  const writeFx = (name, body) => {
    const f = path.join(fakeDir, name);
    fs.writeFileSync(f, `#!/usr/bin/env bash\n${body}\n`);
    fs.chmodSync(f, 0o755);
  };
  // cargo 命令执行一个真实空提交 → verify 后 HEAD 前移，源码快照必须捕获并精确报告。
  writeFx('cargo', 'git -C "' + repo + '" commit --allow-empty -qm "polluted by verify cmd"; exit 0');
  writeFx('npm', 'exit 0');
  writeFx('npx', 'exit 0');
  writeFx('node', 'exit 0');
  try {
    const verify = require(path.join(REPO, '.agents', 'tools', 'pipe-core', 'verify.js'));
    const ctx = { env: { ...process.env, PIPE_FAKE_CMDS: fakeDir } };
    const state = { change: 'demo', nodes: {} };
    const def = { id: 'verify', kind: 'deterministic', runner: 'verify', change: 'demo', domain: 'backend', schema: {} };
    const res = await verify.runVerify({ def, change: 'demo', state, ctx, root: repo, log: () => {}, saveState: () => {} });
    assert.equal(res.ok, false, '验证命令改变 HEAD → 必须 source-mutation 失败');
    assert.equal(res.error.kind, 'source-mutation');
    assert.match(res.error.message, /\(HEAD 变化\)/, '应精确报告是 HEAD 变化（而非仅路径污染）');
  } finally {
    try { fs.rmSync(fakeDir, { recursive: true, force: true }); } catch (_) {}
    fs.rmSync(repo, { recursive: true, force: true });
  }
});