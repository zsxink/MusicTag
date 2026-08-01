#!/usr/bin/env bash
set -euo pipefail

epic_name=${1:?"用法: pipe-epic-preflight.sh <epic-name> <change-name>"}
change_name=${2:?"用法: pipe-epic-preflight.sh <epic-name> <change-name>"}
state_file="openspec/epics/${epic_name}/epic.json"

test -f "$state_file"
test "$(git branch --show-current)" = main
test -z "$(git status --porcelain)"
readarray -t state_values < <(node -e '
const fs = require("fs");
const [file, change] = process.argv.slice(1);
const state = JSON.parse(fs.readFileSync(file, "utf8"));
const item = state.items?.[state.cursor];
if (!state.prdConfirmed || !item || item.name !== change || item.status === "done" || !state.sourceRevision) process.exit(1);
console.log(state.sourceRevision);
console.log(state.source || "");
' "$state_file" "$change_name")

source_revision=${state_values[0]}
source_path=${state_values[1]:-}
git cat-file -e "${source_revision}^{commit}"
if [ -n "$source_path" ] && [ -f "$source_path" ]; then
  git diff --quiet "$source_revision" -- "$source_path"
fi
