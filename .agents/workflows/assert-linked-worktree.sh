#!/usr/bin/env bash
set -euo pipefail

git_dir=$(git rev-parse --absolute-git-dir)
common_dir=$(git rev-parse --path-format=absolute --git-common-dir)
if [ "$git_dir" = "$common_dir" ]; then
  echo "✗ [bootstrap] 当前目录是主工作树；pipe 变更必须在独立 linked worktree 中运行" >&2
  exit 1
fi
