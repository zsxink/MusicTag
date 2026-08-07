#!/usr/bin/env bash
set -euo pipefail

epic_name=${1:?"用法: pipe-epic-preflight.sh <epic-name>"}
epic_file="openspec/epics/${epic_name}/epic.json"

test -f "$epic_file"
test "$(git branch --show-current)" = main
test -z "$(git status --porcelain)"

# 并行语义（D4）：cursor 字段废弃，推进判定按就绪集/批次。
# 机械校验：prdConfirmed、sourceRevision、来源文件漂移、每个未完成子项的 artifacts 与 Issue。
source_revision=$(node -e '
const fs = require("fs");
const [file] = process.argv.slice(1);
const state = JSON.parse(fs.readFileSync(file, "utf8"));
if (!state.prdConfirmed || !state.sourceRevision) process.exit(1);
process.stdout.write(state.sourceRevision);
' "$epic_file")
source_path=$(node -e '
const fs = require("fs");
const [file] = process.argv.slice(1);
const state = JSON.parse(fs.readFileSync(file, "utf8"));
process.stdout.write(state.source || "");
' "$epic_file")
git cat-file -e "${source_revision}^{commit}"
if [ -n "$source_path" ] && [ -f "$source_path" ]; then
  git diff --quiet "$source_revision" -- "$source_path"
fi

# 未完成子项（status !== done）的 artifacts 校验 + Issue 校验
node -e '
const fs = require("fs");
const path = require("path");
const [file] = process.argv.slice(1);
const state = JSON.parse(fs.readFileSync(file, "utf8"));
const items = state.items || [];
const pending = items.filter((it) => it.status !== "done");
if (!pending.length) process.exit(0);
const required = ["proposal.md", "design.md", "tasks.md"];
for (const it of pending) {
  const dir = path.join("openspec/changes", it.name);
  for (const f of required) {
    if (!fs.existsSync(path.join(dir, f))) { console.error(`✗ [epic-preflight] 子变更 ${it.name} 缺 ${f}`); process.exit(1); }
  }
  if (!fs.existsSync(path.join(dir, "specs"))) { console.error(`✗ [epic-preflight] 子变更 ${it.name} 缺 specs/`); process.exit(1); }
  if (!it.issue) { console.error(`✗ [epic-preflight] 子变更 ${it.name} 未关联 Issue 号（epic.json items 缺 issue 字段）`); process.exit(1); }
}
' "$epic_file"

# Issue 驱动强制校验：每个未完成子项必须先建 GitHub Issue 且存在
node -e '
const fs = require("fs");
const [file] = process.argv.slice(1);
const state = JSON.parse(fs.readFileSync(file, "utf8"));
const issues = (state.items || []).filter((it) => it.status !== "done").map((it) => it.issue).filter(Boolean);
process.stdout.write(issues.join(" "));
' "$epic_file" | tr ' ' '\n' | while read -r issue_num; do
  [ -z "$issue_num" ] && continue
  if ! gh issue view "$issue_num" --json number --jq '.number' >/dev/null 2>&1; then
    echo "✗ [epic-preflight] 子变更关联的 GitHub Issue #$issue_num 不存在或不可访问" >&2
    exit 1
  fi
done
