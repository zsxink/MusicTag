'use strict';

// 任务组 7：可观测性端到端（7.1 run 结束自动生成摘要与 events.jsonl）。
// 真实 run.js 全 DAG 结束后，stdout/stderr 应包含运行摘要（总耗时/模型/命令/CI 等待/
// 重试浪费/最慢三阶段/PR·CI·merge 次数），state.summary 落盘，events.jsonl 存在且唯一。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '../..');
const RUNJS = path.join(REPO, '.agents', 'tools', 'pipe-core', 'run.js');
const { fakeCommands } = require(REPO + '/.agents/tools/pipe-core/test/fixtures/fake-pipe-commands.js');
const { seedWorkflows } = require(REPO + '/.agents/tools/pipe-core/test/seed.js');
const FAKE_CLAUDE = path.join(REPO, '.agents', 'tools', 'pipe-core', 'test', 'fixtures', 'fake-pipe-claude.js');

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-core-obs-'));
  require('node:child_process').execSync('git init -q', { cwd: dir });
  require('node:child_process').execSync('git config user.email t@t && git config user.name t', { cwd: dir });
  seedWorkflows(dir);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hello');
  require('node:child_process').execSync('git add . && git commit -qm init', { cwd: dir });
  return dir;
}

test('metrics 7.1: run 结束自动输出摘要并落盘 state.summary 与 events.jsonl', () => {
  const repo = tmpRepo();
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
    assert.equal(res.status, 0, `stderr=${res.stderr}`);
    const out = res.stdout + res.stderr;
    assert.match(out, /总耗时/);
    assert.match(out, /模型耗时/);
    assert.match(out, /命令耗时/);
    assert.match(out, /CI 等待/);
    assert.match(out, /重试浪费/);
    assert.match(out, /最慢阶段/);
    assert.match(out, /PR=\d.*CI=\d.*merge=\d/);
    const state = JSON.parse(fs.readFileSync(path.join(repo, '.agents', 'runs', 'demo', 'state.json'), 'utf8'));
    assert.ok(state.summary.totalDurationMs >= 0, 'summary 落盘');
    assert.equal(state.summary.prCount, 1);
    // events.jsonl 存在且每次 try attempt 唯一。
    const eventsFile = path.join(repo, '.agents', 'runs', 'demo', 'events.jsonl');
    assert.ok(fs.existsSync(eventsFile), 'events.jsonl 存在');
    const lines = fs.readFileSync(eventsFile, 'utf8').trim().split('\n').filter(Boolean);
    const keys = lines.map((l) => { const e = JSON.parse(l); return `${e.node}:${e.attempt}`; });
    assert.equal(new Set(keys).size, keys.length, 'events 无重复');

    // 再次 resume：已通过节点复用，events.jsonl 不得重复追加。
    const res2 = spawnSync(process.execPath, [RUNJS, 'demo', '--resume'], { cwd: repo, encoding: 'utf8', env });
    assert.equal(res2.status, 0, `resume stderr=${res2.stderr}`);
    const lines2 = fs.readFileSync(eventsFile, 'utf8').trim().split('\n').filter(Boolean);
    assert.equal(lines2.length, keys.length, 'resume 不重复追加 events');
  } finally {
    fake.cleanup();
    fs.rmSync(repo, { recursive: true, force: true });
  }
});