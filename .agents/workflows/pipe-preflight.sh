#!/usr/bin/env bash
set -euo pipefail

change_name=${1:?'用法: pipe-preflight.sh <change-name>'}
change_dir="openspec/changes/${change_name}"

test "$(git branch --show-current)" = "$change_name"
test -z "$(git status --porcelain)"
test -f "$change_dir/proposal.md"
test -f "$change_dir/design.md"
test -f "$change_dir/tasks.md"
find "$change_dir/specs" -type f -name '*.md' -print -quit | grep -q .
git merge-base --is-ancestor main HEAD
openspec validate "$change_name" --strict --no-interactive

node .agents/tools/pipe-core/run.js --self-check

issue_num=$(grep -oE 'GitHub Issue：`#[0-9]+`' "$change_dir/proposal.md" | grep -oE '[0-9]+' | head -1)
if [ -z "$issue_num" ]; then
  echo "✗ [preflight] 变更 '$change_name' 未关联 GitHub Issue" >&2
  exit 1
fi
if ! gh issue view "$issue_num" --json number --jq '.number' >/dev/null 2>&1; then
  echo "✗ [preflight] 关联的 GitHub Issue #$issue_num 不存在或不可访问" >&2
  exit 1
fi
