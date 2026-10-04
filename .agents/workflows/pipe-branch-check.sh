#!/usr/bin/env bash
# 只读报告当前分支状态，供 pipe 主会话决定如何进入变更分支。
#
# 本脚本不做任何 Git 写入：不切分支、不建分支、不 stash、不提交。
# 是否切换、切到哪里、还是改用 worktree，由主会话按下面的状态裁决。
#
# 用法: pipe-branch-check.sh <change> [--main <branch>]
# stdout: <state>\t<current-branch>\t<clean|dirty>
#
#   state            条件                     主会话动作
#   already-on-change  当前分支 == change      clean 则直接进 bootstrap
#   on-main            当前分支 == main        git switch -c <change>（已存在则 git switch <change>）
#   on-other           其它分支               AskUserQuestion 三选一：切分支 / 改用 worktree / 中止
#   detached           detached HEAD          同 on-other
#
# current-branch 在 detached 时输出 `-`（Git 不允许以 `-` 开头的分支名，故无歧义）。
# 「切分支」前须自行确认 `git merge-base --is-ancestor <main> HEAD` 成立。
set -euo pipefail

usage() {
  echo "用法: pipe-branch-check.sh <change> [--main <branch>]" >&2
  exit 2
}

# 显式求助不是用法错误：打印用法到 stdout 并以 0 退出。
help() {
  echo "用法: pipe-branch-check.sh <change> [--main <branch>]"
  echo "只读报告 <state>\\t<current-branch>\\t<clean|dirty>，不做任何 Git 写入。"
  echo "state ∈ already-on-change | on-main | on-other | detached；退出码 0 正常 / 1 非 Git 仓库 / 2 用法错误。"
  exit 0
}

change=""
main_branch="main"

while [ $# -gt 0 ]; do
  case "$1" in
    --main)
      if [ $# -lt 2 ]; then
        echo "--main 需要一个分支名" >&2
        usage
      fi
      main_branch=$2
      shift 2
      ;;
    -h|--help)
      help
      ;;
    -*)
      echo "未知参数: $1" >&2
      usage
      ;;
    *)
      if [ -n "$change" ]; then
        echo "多余参数: $1" >&2
        usage
      fi
      change=$1
      shift
      ;;
  esac
done

[ -n "$change" ] || usage

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "✗ [branch-check] 当前目录不是 Git 仓库" >&2
  exit 1
fi

current=$(git branch --show-current)

if [ -z "$current" ]; then
  # detached HEAD；全新仓库的 unborn HEAD 同样没有当前分支，一并记为 detached。
  # 正常的 pipe 流程必定已有 change 分支与提交，不会落到这里。
  state="detached"
  current="-"
elif [ "$current" = "$change" ]; then
  state="already-on-change"
elif [ "$current" = "$main_branch" ]; then
  state="on-main"
else
  state="on-other"
fi

if [ -z "$(git status --porcelain)" ]; then
  workspace="clean"
else
  workspace="dirty"
fi

printf '%s\t%s\t%s\n' "$state" "$current" "$workspace"
