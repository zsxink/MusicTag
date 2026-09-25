#!/usr/bin/env bash
set -euo pipefail

epic_name=${1:?'用法: pipe-epic-preflight.sh <epic-name> <current-owner>'}
epic_owner=${2:?'用法: pipe-epic-preflight.sh <epic-name> <current-owner>'}
epic_file="openspec/epics/${epic_name}/epic.json"

test -f "$epic_file"
test "$(git branch --show-current)" = main
test -z "$(git status --porcelain)"
node .agents/tools/pipe-native/self-check.js
node --check .agents/tools/pipe-native/progress.js
node --check .agents/tools/pipe-native/progress-cli.js
node --check .agents/tools/pipe-native/epic-preflight.js
node --check .agents/tools/pipe-native/source-fingerprint.js
node --check .agents/tools/pipe-native/self-check.js
bash -n .agents/workflows/pipe-preflight.sh
bash -n .agents/workflows/pipe-epic-preflight.sh

source_revision=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).sourceRevision)' "$epic_file")
node - "$epic_file" <<'NODE'
const fs = require('node:fs');
const file = process.argv[2];
const state = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!state.prdConfirmed || !state.sourceRevision) process.exit(1);
NODE
git cat-file -e "${source_revision}^{commit}"
if ! git merge-base --is-ancestor "$source_revision" main; then
  echo "✗ [epic-preflight] sourceRevision 必须是 main 的祖先；Epic 基线已过期或来自其他分支" >&2
  exit 1
fi

node - "$epic_file" <<'NODE'
const fs = require('node:fs');
const runtime = require('./.agents/tools/pipe-native/progress.js');
const file = process.argv[2];
const epic = JSON.parse(fs.readFileSync(file, 'utf8'));
try { runtime.validateEpicDefinition(epic); }
catch (error) { console.error(`✗ [epic-preflight] ${error.message}`); process.exit(1); }
NODE

# Query every child Issue and persist the freshly verified merge set before
# calculating DAG readiness. A stale Markdown `done` marker never unlocks work.
repo_owner=$(gh repo view --json owner --jq '.owner.login')
repo_name=$(gh repo view --json name --jq '.name')
node - "$epic_name" "$epic_owner" <<'NODE'
const runtime = require('./.agents/tools/pipe-native/progress.js');
const [epic, owner] = process.argv.slice(2);
const progress = runtime.loadEpicProgress(process.cwd(), epic);
const lock = runtime.readLock(process.cwd(), epic);
if (!progress || progress.owner !== owner || !lock || lock.owner !== owner) {
  console.error('✗ [epic-preflight] 必须显式提供当前 Epic lock/progress owner；旧会话 owner 需先经 takeover 核验');
  process.exit(1);
}
NODE
rows_file=".agents/runs/${epic_name}/remote-merge-rows.tsv"
facts_file=".agents/runs/${epic_name}/remote-facts.json"
mkdir -p ".agents/runs/${epic_name}"
: > "$rows_file"
graphql_query='query($owner:String!, $name:String!, $number:Int!) { repository(owner:$owner,name:$name) { issue(number:$number) { timelineItems(first:100,itemTypes:CROSS_REFERENCED_EVENT) { nodes { ... on CrossReferencedEvent { source { ... on PullRequest { number mergedAt mergeCommit { oid } repository { nameWithOwner } closingIssuesReferences(first:100) { nodes { number repository { nameWithOwner } } } } } } } } } } } }'
all_rows=$(node .agents/tools/pipe-native/epic-preflight.js items "$epic_file")
while IFS=$'\t' read -r item_name issue_number; do
  test -n "$item_name" || continue
  timeline=$(gh api graphql -F owner="$repo_owner" -F name="$repo_name" -F number="$issue_number" -f query="$graphql_query" --jq '[.data.repository.issue.timelineItems.nodes[]?.source]')
  fact=$(node .agents/tools/pipe-native/epic-preflight.js match-pr "$repo_owner/$repo_name" "$issue_number" "$timeline")
  printf '%s\t%s\t%s\n' "$item_name" "$issue_number" "$fact" >> "$rows_file"
done <<< "$all_rows"
node .agents/tools/pipe-native/epic-preflight.js facts "$epic_file" "$rows_file" "$facts_file" main "$PWD" "$(git rev-parse HEAD)"
merged_issue_csv=$(node -e 'const f=require(process.argv[1]);process.stdout.write(Object.entries(f.epicItems).filter(([,v])=>v.remoteMerged).map(([,v])=>v.issueNumber).join(","))' "$PWD/$facts_file")
active_rows=$(node .agents/tools/pipe-native/epic-preflight.js active "$epic_file" "$merged_issue_csv")
while IFS=$'\t' read -r item_name issue_number; do
  test -n "$item_name" || continue
  for artifact in proposal.md design.md tasks.md; do
    test -f "openspec/changes/$item_name/$artifact" || { echo "✗ [epic-preflight] 子变更 $item_name 缺 $artifact" >&2; exit 1; }
  done
  test -d "openspec/changes/$item_name/specs" || { echo "✗ [epic-preflight] 子变更 $item_name 缺 specs" >&2; exit 1; }
  actual_issue=$(gh issue view "$issue_number" --json number --jq '.number')
  test "$actual_issue" = "$issue_number" || { echo "✗ [epic-preflight] 子变更 $item_name 的 GitHub Issue #$issue_number 无法核实" >&2; exit 1; }
  npx openspec validate "$item_name" --strict --no-interactive
done <<< "$active_rows"

node .agents/tools/pipe-native/progress-cli.js resume-apply "$epic_name" --epic --owner "$epic_owner" --facts "$facts_file" --json >/dev/null
node .agents/tools/pipe-native/progress-cli.js epic-ready "$epic_name" --owner "$epic_owner" --facts "$facts_file" --json
