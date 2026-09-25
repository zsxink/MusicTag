#!/usr/bin/env bash
set -euo pipefail

change_name=${1:?'用法: pipe-preflight.sh <change-name> [bootstrap|spec-gate]'}
stage=${2:-all}
change_dir="openspec/changes/${change_name}"

run_bootstrap() {
  test "$(git branch --show-current)" = "$change_name"
  bash .agents/workflows/assert-linked-worktree.sh
  test -z "$(git status --porcelain)"
  test -f "$change_dir/proposal.md"
  test -n "$(rg --files "$change_dir/specs" -g '*.md' | head -1)"
  git merge-base --is-ancestor main HEAD
  node .agents/tools/pipe-native/self-check.js
  node --check .agents/tools/pipe-native/progress.js
  node --check .agents/tools/pipe-native/progress-cli.js
  node --check .agents/tools/pipe-native/self-check.js
  bash -n .agents/workflows/pipe-preflight.sh
  bash -n .agents/workflows/pipe-epic-preflight.sh

  issue_num=$(rg -o 'GitHub Issue[：:][[:space:]]*`?#[0-9]+`?' "$change_dir/proposal.md" | head -1 | rg -o '[0-9]+' | head -1 || true)
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
  test -n "$(rg --files "$change_dir/specs" -g '*.md' | head -1)"
  npx openspec validate "$change_name" --strict --no-interactive
}

case "$stage" in
  bootstrap) run_bootstrap ;;
  spec-gate) run_spec_gate ;;
  all) run_bootstrap; run_spec_gate ;;
  *) echo "未知 preflight stage: $stage" >&2; exit 2 ;;
esac
