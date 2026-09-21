#!/usr/bin/env bash
set -euo pipefail

epic_name=${1:?'用法: pipe-epic-preflight.sh <epic-name>'}
epic_file="openspec/epics/${epic_name}/epic.json"

test -f "$epic_file"
test "$(git branch --show-current)" = main
test -z "$(git status --porcelain)"

node - "$epic_file" <<'NODE'
const fs = require('node:fs');
const file = process.argv[2];
const state = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!state.prdConfirmed || !state.sourceRevision) process.exit(1);
NODE
git cat-file -e "$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).sourceRevision)' "$epic_file")^{commit}"

node - "$epic_file" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const state = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
for (const item of (state.items || []).filter((entry) => entry.status !== 'done')) {
  for (const file of ['proposal.md', 'design.md', 'tasks.md']) {
    if (!fs.existsSync(path.join('openspec', 'changes', item.name, file))) {
      console.error(`✗ [epic-preflight] 子变更 ${item.name} 缺 ${file}`); process.exit(1);
    }
  }
  if (!fs.existsSync(path.join('openspec', 'changes', item.name, 'specs'))) process.exit(1);
  if (!item.issue) process.exit(1);
}
NODE
