#!/usr/bin/env bash
set -euo pipefail

change_name=${1:?'用法: pipe-preflight.sh <change-name> [bootstrap|spec-gate]'}
stage=${2:-all}
change_dir="openspec/changes/${change_name}"

run_bootstrap() {
  test "$(git branch --show-current)" = "$change_name"
  test -z "$(git status --porcelain)"
  test -f "$change_dir/proposal.md"
  find "$change_dir/specs" -type f -name '*.md' -print -quit | grep -q .
  git merge-base --is-ancestor main HEAD
  node .agents/tools/pipe-core/run.js --self-check

  issue_num=$(grep -oE 'GitHub Issue：`#[0-9]+`' "$change_dir/proposal.md" | grep -oE '[0-9]+' | head -1)
  if [ -z "$issue_num" ]; then
    echo "✗ [bootstrap] 变更 '$change_name' 未关联 GitHub Issue" >&2
    exit 1
  fi
  if ! gh issue view "$issue_num" --json number --jq '.number' >/dev/null 2>&1; then
    echo "✗ [bootstrap] 关联的 GitHub Issue #$issue_num 不存在或不可访问" >&2
    exit 1
  fi
}

run_spec_gate() {
  test -f "$change_dir/design.md"
  test -f "$change_dir/tasks.md"
  find "$change_dir/specs" -type f -name '*.md' -print -quit | grep -q .
  openspec validate "$change_name" --strict --no-interactive
}

case "$stage" in
  bootstrap) run_bootstrap ;;
  spec-gate) run_spec_gate ;;
  all) run_bootstrap; run_spec_gate ;;
  *) echo "未知 preflight stage: $stage" >&2; exit 2 ;;
esac
