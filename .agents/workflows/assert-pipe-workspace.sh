#!/usr/bin/env bash
# 判定当前工作区模式，并断言 pipe 可以在此运行。
#
# 主工作树（in-place）与 linked worktree 都接受；两种模式都不再阻断。
# 「当前分支必须等于 change 名」的门禁由 pipe-preflight.sh 负责，它继续挡住「在 main 上直接开发」。
#
# stdout 恒为一行模式标记，供主会话记入 bootstrap 证据：
#   in-place  当前目录是主工作树
#   worktree  当前目录是 linked worktree
set -euo pipefail

git_dir=$(git rev-parse --absolute-git-dir)
common_dir=$(git rev-parse --path-format=absolute --git-common-dir)

if [ "$git_dir" = "$common_dir" ]; then
  echo "in-place"
else
  echo "worktree"
fi
