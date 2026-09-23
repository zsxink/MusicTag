'use strict';
// run.js CLI 端到端（子进程 + fake driver 二进制注入）：
// 覆盖 spec 场景——环境自动感知（P5）、挂起回主会话（exit 3）、用户决策后续跑（--resume）、入口薄壳（退出码契约），
// 以及 CLI 失败路径：未知 driver、无法自动判断、无状态续跑、状态已存在未 --resume、用法错误。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execSync } = require('node:child_process');

const RUNJS = path.join(__dirname, '..', 'run.js');
const FAKE_CLAUDE = path.join(__dirname, 'fixtures', 'fake-pipe-claude.js');
const FAKE_CODEX = path.join(__dirname, 'fixtures', 'fake-pipe-codex.js');
const RECORD_CWD = path.join(__dirname, 'fixtures', 'fake-pipe-record-cwd.js');
const { seedWorkflows } = require('./seed.js');
const { fakeCommands } = require('./fixtures/fake-pipe-commands.js');

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-cli-'));
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email t@t && git config user.name t', { cwd: dir });
  seedWorkflows(dir);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hello');
  execSync('git add . && git commit -qm init', { cwd: dir });
  return dir;
}

function runCli(args, env, repo) {
  return spawnSync(process.execPath, [RUNJS, ...args], {
    encoding: 'utf8',
    cwd: repo || process.cwd(),
    env: { ...process.env, ...env },
  });
}

test('run.js: --self-check 非零失败即 fail-closed（此处真实核心应为 0）', () => {
  const res = runCli(['--self-check'], { PIPE_CORE_REPO_ROOT: process.cwd() });
  assert.equal(res.status, 0, res.stderr);
});

test('run.js: 无参数 → 用法错误退出码 2', () => {
  const repo = tmpRepo();
  const res = runCli([], { PIPE_CORE_REPO_ROOT: repo }, repo);
  assert.equal(res.status, 2);
  fs.rmSync(repo, { recursive: true, force: true });
});

test('run.js: 环境无法自动判断 driver（无 CLAUDECODE/AI_AGENT）→ 退出码 2，要求显式指定', () => {
  const repo = tmpRepo();
  const env = { PIPE_CORE_REPO_ROOT: repo, CLAUDECODE: '', AI_AGENT: '' };
  const res = runCli(['demo'], env, repo);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /无法自动判断 driver/);
  fs.rmSync(repo, { recursive: true, force: true });
});

test('run.js: 未知 driver → 退出码 2', () => {
  const repo = tmpRepo();
  const res = runCli(['demo', '--driver', 'grok'], { PIPE_CORE_REPO_ROOT: repo }, repo);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /未知 driver/);
  fs.rmSync(repo, { recursive: true, force: true });
});

test('run.js: CLAUDECODE 环境 → 自动选 claude driver，全 DAG 成功退出 0', () => {
  const repo = tmpRepo();
  const fake = fakeCommands({ verify: true, gitRemote: true, ghFlat: true });
  const env = {
    PIPE_CORE_REPO_ROOT: repo,
    CLAUDECODE: '1',
    AI_AGENT: '',
    PIPE_CLAUDE_BIN: FAKE_CLAUDE,
    ...fake.env(),
  };
  try {
    const res = runCli(['demo'], env, repo);
    assert.equal(res.status, 0, `stdout=${res.stdout} stderr=${res.stderr}`);
    assert.match(res.stdout, /流水线成功/);
    const state = JSON.parse(fs.readFileSync(path.join(repo, '.agents', 'runs', 'demo', 'state.json'), 'utf8'));
    assert.equal(state.nodes.integrate.status, 'succeeded');
    assert.equal(state.driver, 'claude');
  } finally {
    fake.cleanup();
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('run.js: AI_AGENT=codex 环境 → 自动选 codex driver，全 DAG 成功退出 0', () => {
  const repo = tmpRepo();
  const fake = fakeCommands({ verify: true, gitRemote: true, ghFlat: true });
  const env = {
    PIPE_CORE_REPO_ROOT: repo,
    CLAUDECODE: '',
    AI_AGENT: 'codex',
    PIPE_CODEX_BIN: FAKE_CODEX,
    ...fake.env(),
  };
  try {
    const res = runCli(['demo'], env, repo);
    assert.equal(res.status, 0, `stdout=${res.stdout} stderr=${res.stderr}`);
    const state = JSON.parse(fs.readFileSync(path.join(repo, '.agents', 'runs', 'demo', 'state.json'), 'utf8'));
    assert.equal(state.driver, 'codex');
    assert.equal(state.nodes.integrate.status, 'succeeded');
  } finally {
    fake.cleanup();
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('run.js: tester 语义失败（smokePassed=false）→ 决断链 escalate 挂起退出 3', () => {
  const repo = tmpRepo();
  const env = {
    PIPE_CORE_REPO_ROOT: repo,
    CLAUDECODE: '1',
    AI_AGENT: '',
    PIPE_CLAUDE_BIN: FAKE_CLAUDE,
    FAKE_TESTER_FAIL: '1',
  };
  const res = runCli(['demo'], env, repo);
  assert.equal(res.status, 3, `stderr=${res.stderr}`);
  assert.match(res.stderr, /挂起/);
  const state = JSON.parse(fs.readFileSync(path.join(repo, '.agents', 'runs', 'demo', 'state.json'), 'utf8'));
  assert.equal(state.nodes.tester.status, 'suspended');
  // 挂起前已通过节点完整落盘（bootstrap/architect/dev 已 succeeded）
  assert.equal(state.nodes.bootstrap.status, 'succeeded');
  assert.equal(state.nodes.architect.status, 'succeeded');
  fs.rmSync(repo, { recursive: true, force: true });
});

test('run.js: --resume 从挂起节点续跑，已通过节点复用，修复后退出 0', () => {
  const repo = tmpRepo();
  const fake = fakeCommands({ verify: true, gitRemote: true, ghFlat: true });
  const base = { PIPE_CORE_REPO_ROOT: repo, CLAUDECODE: '1', AI_AGENT: '', PIPE_CLAUDE_BIN: FAKE_CLAUDE, ...fake.env() };
  try {
    // 第一轮：tester 失败 → 挂起
    const r1 = runCli(['demo'], { ...base, FAKE_TESTER_FAIL: '1' }, repo);
    assert.equal(r1.status, 3);
    const before = JSON.parse(fs.readFileSync(path.join(repo, '.agents', 'runs', 'demo', 'state.json'), 'utf8'));
    const archSha = before.nodes.architect.commitSha;

    // 第二轮：修复 tester 语义，--resume 续跑
    const r2 = runCli(['demo', '--resume'], base, repo);
    assert.equal(r2.status, 0, `stdout=${r2.stdout} stderr=${r2.stderr}`);
    const after = JSON.parse(fs.readFileSync(path.join(repo, '.agents', 'runs', 'demo', 'state.json'), 'utf8'));
    assert.equal(after.nodes.integrate.status, 'succeeded');
    // 已通过节点直接复用（commitSha 不变，未重跑）
    assert.equal(after.nodes.architect.commitSha, archSha, '已通过 architect 应复用原 commitSha');
  } finally {
    fake.cleanup();
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('run.js: --resume 无状态文件 → 退出码 2', () => {
  const repo = tmpRepo();
  const res = runCli(['demo', '--resume'], { PIPE_CORE_REPO_ROOT: repo, CLAUDECODE: '1', PIPE_CLAUDE_BIN: FAKE_CLAUDE }, repo);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /无状态文件可续跑/);
  fs.rmSync(repo, { recursive: true, force: true });
});

test('run.js: 状态文件已存在但未 --resume → 退出码 2 阻止误重跑', () => {
  const repo = tmpRepo();
  const fake = fakeCommands({ verify: true, gitRemote: true, ghFlat: true });
  const env = { PIPE_CORE_REPO_ROOT: repo, CLAUDECODE: '1', AI_AGENT: '', PIPE_CLAUDE_BIN: FAKE_CLAUDE, ...fake.env() };
  try {
    assert.equal(runCli(['demo'], env, repo).status, 0);
    const res = runCli(['demo'], env, repo);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /状态文件已存在/);
  } finally {
    fake.cleanup();
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('run.js: CLAUDECODE="0" 不误判为 claude（复核2 minor）', () => {
  const repo = tmpRepo();
  const res = runCli(['demo'], { PIPE_CORE_REPO_ROOT: repo, CLAUDECODE: '0', AI_AGENT: '', PIPE_CLAUDE_BIN: FAKE_CLAUDE }, repo);
  assert.equal(res.status, 2, 'CLAUDECODE="0" 不应被当作 claude 标记，环境无法判断 → exit 2');
  assert.match(res.stderr, /无法自动判断 driver/);
  fs.rmSync(repo, { recursive: true, force: true });
});

test('run.js: B1——driver cwd 取 --cwd worktree 而非 repoRoot（P3 worktree 隔离）', () => {
  const repo = tmpRepo();
  const worktreeDir = path.join(repo, 'wt-sub');
  fs.mkdirSync(worktreeDir);
  // --cwd worktree 是确定性 runner 的工作根：需在 worktree 内种下 pipeline 脚本。
  seedWorkflows(worktreeDir);
  // 记录 driver cwd 的文件必须放在仓库外：仓库内会触发 core 的 workspace 越权审计。
  const cwdFile = path.join(os.tmpdir(), `pipe-driver-cwd-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  const fake = fakeCommands({ verify: true, gitRemote: true, ghFlat: true });
  const env = {
    PIPE_CORE_REPO_ROOT: repo, // repoRoot（主仓库）
    CLAUDECODE: '1',
    AI_AGENT: '',
    PIPE_CLAUDE_BIN: RECORD_CWD,
    FAKE_RECORD_CWD: cwdFile,
    ...fake.env(),
  };
  try {
    const res = runCli(['demo', '--driver', 'claude', '--cwd', worktreeDir], env, repo);
    assert.equal(res.status, 0, `stdout=${res.stdout} stderr=${res.stderr}`);
    const lines = fs.readFileSync(cwdFile, 'utf8').trim().split('\n').filter(Boolean);
    assert.ok(lines.length > 0, 'fake driver 应记录 cwd');
    // macOS /var→/private/var symlink：driver 子进程 process.cwd() 返回真实路径，两侧都 realpath 归一化再比
    const want = fs.realpathSync(worktreeDir);
    for (const l of lines) {
      const got = fs.realpathSync(l);
      assert.equal(got, want, `driver 实际工作目录应为 --cwd 指定的 worktree（${worktreeDir}），而非 repoRoot（${repo}）——实际 ${l}`);
    }
  } finally {
    fake.cleanup();
    fs.rmSync(cwdFile, { force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
