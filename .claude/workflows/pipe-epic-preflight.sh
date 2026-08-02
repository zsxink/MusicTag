#!/usr/bin/env bash
set -euo pipefail

epic_name=${1:?"用法: pipe-epic-preflight.sh <epic-name> <change-name>"}
change_name=${2:?"用法: pipe-epic-preflight.sh <epic-name> <change-name>"}
state_file="openspec/epics/${epic_name}/epic.json"

test -f "$state_file"
test "$(git branch --show-current)" = main
test -z "$(git status --porcelain)"
source_revision=$(node -e '
const fs = require("fs");
const [file, change] = process.argv.slice(1);
const state = JSON.parse(fs.readFileSync(file, "utf8"));
const item = state.items?.[state.cursor];
if (!state.prdConfirmed || !item || item.name !== change || item.status === "done" || !state.sourceRevision) process.exit(1);
console.log(state.sourceRevision);
' "$state_file" "$change_name")
source_path=$(node -e '
const fs = require("fs");
const [file] = process.argv.slice(1);
const state = JSON.parse(fs.readFileSync(file, "utf8"));
const item = state.items?.[state.cursor];
console.log(item?.source || state.source || "");
' "$state_file")
git cat-file -e "${source_revision}^{commit}"
if [ -n "$source_path" ] && [ -f "$source_path" ]; then
  git diff --quiet "$source_revision" -- "$source_path"
fi

# Issue 驱动强制校验：当前 cursor 子变更必须先建 GitHub Issue 且存在
issue_num=$(node -e '
const fs = require("fs");
const state = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const item = state.items?.[state.cursor];
console.log(item?.issue || "");
' "$state_file")
if [ -z "$issue_num" ]; then
  echo "✗ [preflight] 子变更 '$change_name'（epic.json cursor）未关联 Issue 号：请在 epic.json items 该 item 补 \`issue\` 字段" >&2
  exit 1
fi
if ! gh issue view "$issue_num" --json number --jq '.number' >/dev/null 2>&1; then
  echo "✗ [preflight] 子变更关联的 GitHub Issue #$issue_num 不存在或不可访问" >&2
  exit 1
fi
