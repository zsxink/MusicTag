'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');
const workspace = require('../workspace.js');

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-workspace-'));
  execSync('git init -q && git config user.email t@t && git config user.name t', { cwd: dir });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.txt'), 'base');
  fs.writeFileSync(path.join(dir, '.gitignore'), 'ignored/\n');
  execSync('git add . && git commit -qm init', { cwd: dir });
  return dir;
}

test('workspace: 节点启动前已有差异不误归属，允许范围内新增被识别', () => {
  const repo = tmpRepo();
  fs.writeFileSync(path.join(repo, 'preexisting.txt'), 'user');
  const before = workspace.snapshot(repo);
  fs.writeFileSync(path.join(repo, 'src', 'a.txt'), 'changed');
  const after = workspace.snapshot(repo);
  const audit = workspace.audit(before, after, ['src/']);
  assert.deepEqual(audit.changedPaths, ['src/a.txt']);
  assert.deepEqual(audit.unauthorizedPaths, []);
  fs.rmSync(repo, { recursive: true, force: true });
});

test('workspace: 越权与 ignored 写入均 fail-closed，HEAD 变化单独报告', () => {
  const repo = tmpRepo();
  const before = workspace.snapshot(repo);
  fs.writeFileSync(path.join(repo, 'outside.txt'), 'bad');
  fs.mkdirSync(path.join(repo, 'ignored'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'ignored', 'secret.txt'), 'bad');
  execSync('git add outside.txt && git commit -qm agent-commit', { cwd: repo });
  const after = workspace.snapshot(repo);
  const audit = workspace.audit(before, after, ['src/']);
  assert.equal(audit.headChanged, true);
  // ignore 目录折叠为目录级条目（防大型 node_modules 逐文件枚举 ENOBUFS/性能问题），
  // fail-closed 语义保留：在 ignore 目录内写入 → 目录本身作为 unauthorized 路径被捕获。
  assert.ok(audit.unauthorizedPaths.includes('ignored/'));
  assert.ok(audit.unauthorizedPaths.includes('outside.txt'));
  fs.rmSync(repo, { recursive: true, force: true });
});

test('workspace: core 只提交本节点授权新增路径，不夹带已有差异', async () => {
  const repo = tmpRepo();
  fs.writeFileSync(path.join(repo, 'preexisting.txt'), 'user');
  const before = workspace.snapshot(repo);
  fs.writeFileSync(path.join(repo, 'src', 'new.txt'), 'node');
  const after = workspace.snapshot(repo);
  const audit = workspace.audit(before, after, ['src/']);
  const result = await workspace.commitChanges(repo, audit.changedPaths, 'feat(test): scoped');
  assert.equal(result.ok, true);
  assert.match(execSync('git show --name-only --format=', { cwd: repo, encoding: 'utf8' }), /src\/new.txt/);
  assert.doesNotMatch(execSync('git show --name-only --format=', { cwd: repo, encoding: 'utf8' }), /preexisting/);
  assert.match(execSync('git status --porcelain', { cwd: repo, encoding: 'utf8' }), /preexisting.txt/);
  fs.rmSync(repo, { recursive: true, force: true });
});

test('workspace: 节点修改启动前已脏的同一路径时 fail-closed', () => {
  const repo = tmpRepo();
  fs.writeFileSync(path.join(repo, 'src', 'a.txt'), 'user-change');
  const before = workspace.snapshot(repo);
  fs.writeFileSync(path.join(repo, 'src', 'a.txt'), 'agent-overwrite');
  const after = workspace.snapshot(repo);
  const audit = workspace.audit(before, after, ['src/']);
  assert.deepEqual(audit.preexistingTouchedPaths, ['src/a.txt']);
  assert.equal(audit.safeToCommit, false);
  fs.rmSync(repo, { recursive: true, force: true });
});

test('workspace: Agent 改动 index 即视为 git 越权', () => {
  const repo = tmpRepo();
  fs.writeFileSync(path.join(repo, 'src', 'new.txt'), 'node');
  const before = workspace.snapshot(repo);
  execSync('git add src/new.txt', { cwd: repo });
  const after = workspace.snapshot(repo);
  const audit = workspace.audit(before, after, ['src/']);
  assert.equal(audit.indexChanged, true);
  assert.equal(audit.safeToCommit, false);
  fs.rmSync(repo, { recursive: true, force: true });
});
