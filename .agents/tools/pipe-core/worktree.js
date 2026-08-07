'use strict';
// P3: git worktree 创建/清理/分支隔离/合并回主 + 前置合并后 refresh（rebase main）。
// 独立分支必须（防并写污染——对应记忆 music-tag-branch-switch-during-workflow 教训）。
// 合并回 main 由子流程 integrate（gh pr merge）完成；本模块只负责隔离与清理。

const { execSync } = require('node:child_process');

function git(args, opts = {}) {
  return execSync(`git ${args}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

// 纯命令构造（供单测断言，不执行）
function addArgs({ worktreePath, branch }) {
  return `worktree add "${worktreePath}" -b "${branch}"`;
}
function removeArgs({ worktreePath }) {
  return `worktree remove --force "${worktreePath}"`;
}
function rebaseArgs({ remote } = {}) {
  return remote ? 'rebase origin/main' : 'rebase main';
}
function branchDeleteArgs({ branch }) {
  return `branch -d "${branch}"`;
}

// 主仓库创建 worktree + 独立分支（防并写污染）。
function add({ worktreePath, branch, main }) {
  git(addArgs({ worktreePath, branch }), { cwd: main });
  return worktreePath;
}

// 崩溃恢复：确保 worktree 在目标分支上（已存在则 checkout）。
// 独立复核 major：此前吞掉全部 checkout 错误——若 worktree 停在错误分支（如孤儿提交残留），
// 后续 rebase/开发会在错误分支上进行。改为失败即抛错，由 runItemAsync 捕获置 failed 交主会话。
function ensureBranch(worktreePath, branch) {
  git(`checkout "${branch}"`, { cwd: worktreePath });
}

// 前置合并后 refresh（D4）：predecessors 已合回 main → worktree 先 rebase 刷新基准，
// 再 git diff main...HEAD 与开 PR，避免合并期冲突。优先以 origin/main 为基准（PR 合并在远端）。
function rebaseMain(worktreePath) {
  let fetched = false;
  try { git('fetch origin main', { cwd: worktreePath }); fetched = true; } catch (_) { /* 无远程时回退本地 main */ }
  git(rebaseArgs({ remote: fetched }), { cwd: worktreePath });
}

// 清理：合并已由子流程完成 → 删除 worktree；已合并分支删除（-d 只删已合并，未合并不删保留）。
function cleanup(worktreePath, branch, main) {
  git(removeArgs({ worktreePath }), { cwd: main });
  try { git(branchDeleteArgs({ branch }), { cwd: main }); } catch (_) { /* 未合并分支保留供查 */ }
}

module.exports = {
  git,
  addArgs,
  removeArgs,
  rebaseArgs,
  branchDeleteArgs,
  add,
  ensureBranch,
  rebaseMain,
  cleanup,
};
