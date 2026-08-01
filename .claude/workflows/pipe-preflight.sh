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
