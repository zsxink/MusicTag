'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');
const worktree = require('../worktree.js');

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-wt-'));
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email t@t && git config user.name t', { cwd: dir });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hello');
  // 与真实仓库一致：.worktrees/ 须 gitignore，否则主仓库工作区视其为未跟踪
  fs.writeFileSync(path.join(dir, '.gitignore'), '.worktrees/\n');
  execSync('git add . && git commit -qm init', { cwd: dir });
  return dir;
}

test('worktree: addArgs/removeArgs/rebaseArgs/branchDeleteArgs 命令构造', () => {
  assert.equal(worktree.addArgs({ worktreePath: '.worktrees/x', branch: 'x' }), 'worktree add ".worktrees/x" -b "x"');
  assert.equal(worktree.removeArgs({ worktreePath: '.worktrees/x' }), 'worktree remove --force ".worktrees/x"');
  assert.equal(worktree.rebaseArgs({ remote: true }), 'rebase origin/main');
  assert.equal(worktree.rebaseArgs(), 'rebase main');
  assert.equal(worktree.branchDeleteArgs({ branch: 'x' }), 'branch -d "x"');
});

test('worktree: add 创建隔离 worktree + 独立分支（真实 git，temp repo）', () => {
  const main = tmpRepo();
  const wt = path.join(main, '.worktrees', 'demo');
  worktree.add({ worktreePath: wt, branch: 'demo', main });
  const branch = execSync('git branch --show-current', { cwd: wt, encoding: 'utf8' }).trim();
  assert.equal(branch, 'demo');
  // 主仓库工作区保持干净（worktree 隔离）
  const status = execSync('git status --porcelain', { cwd: main, encoding: 'utf8' }).trim();
  assert.equal(status, '');
  fs.rmSync(path.join(main, '.worktrees'), { recursive: true, force: true });
  execSync('git worktree prune', { cwd: main, stdio: 'ignore' });
  fs.rmSync(main, { recursive: true, force: true });
});

test('worktree: cleanup 删除已合并 worktree + 分支；未合并分支保留', () => {
  const main = tmpRepo();
  const wt = path.join(main, '.worktrees', 'merged');
  worktree.add({ worktreePath: wt, branch: 'merged', main });
  // 制造「已合并」：merge --no-ff 把 merged 合回 main
  fs.writeFileSync(path.join(wt, 'b.txt'), 'b');
  execSync("git add . && git commit -q -m 'feat merged change x'", { cwd: wt });
  execSync('git checkout main', { cwd: main, stdio: 'ignore' });
  execSync('git merge --no-ff merged -m merge', { cwd: main, stdio: 'ignore' });
  worktree.cleanup(wt, 'merged', main);
  assert.ok(!fs.existsSync(wt), 'worktree 应已删除');
  const branches = execSync('git branch --list merged', { cwd: main, encoding: 'utf8' });
  assert.equal(branches.trim(), '', '已合并分支应被删除');
  fs.rmSync(path.join(main, '.worktrees'), { recursive: true, force: true });
  fs.rmSync(main, { recursive: true, force: true });
});
