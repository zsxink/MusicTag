#!/usr/bin/env bash
set -euo pipefail

change_name=${1:?"用法: pipe-preflight.sh <change-name>"}
change_dir="openspec/changes/${change_name}"

test "$(git branch --show-current)" = "$change_name"
test -z "$(git status --porcelain)"
test -f "$change_dir/proposal.md"
test -f "$change_dir/design.md"
test -f "$change_dir/tasks.md"
find "$change_dir/specs" -type f -name '*.md' -print -quit | grep -q .
git merge-base --is-ancestor main HEAD
openspec validate "$change_name" --strict --no-interactive

# 流程脚本静态自检（fail-closed）：Workflow 调用无编译期检查，语法错误是静默炸点
# Node：workflow 引擎把脚本包进 async function 求值，语法检查需等价还原该环境
for js in .claude/workflows/*.js; do
  [ -e "$js" ] || continue
  if ! node -e '
    const fs = require("fs");
    const file = process.argv[1];
    let src = fs.readFileSync(file, "utf8");
    src = src.replace(/^export /gm, "");
    new Function("async function __wf__(args, phase, agent, log) {\n" + src + "\n}");
  ' "$js"; then
    echo "✗ [preflight] 流程脚本语法错误：$js" >&2
    exit 1
  fi
done
# Shell：bash -n 只查语法
for sh in .claude/workflows/*.sh; do
  [ -e "$sh" ] || continue
  if ! bash -n "$sh"; then
    echo "✗ [preflight] 流程脚本语法错误：$sh" >&2
    exit 1
  fi
done

# Issue 驱动强制校验：变更必须先建 GitHub Issue，proposal 必须关联 Issue 号，且该 Issue 存在
issue_num=$(grep -oE 'GitHub Issue：`#[0-9]+`' "$change_dir/proposal.md" | grep -oE '[0-9]+' | head -1)
if [ -z "$issue_num" ]; then
  echo "✗ [preflight] 变更 '$change_name' 未关联 GitHub Issue：请在 proposal.md 写「## 关联 Issue」段（GitHub Issue：\`#<号>\`）" >&2
  exit 1
fi
if ! gh issue view "$issue_num" --json number --jq '.number' >/dev/null 2>&1; then
  echo "✗ [preflight] 关联的 GitHub Issue #$issue_num 不存在或不可访问" >&2
  exit 1
fi
