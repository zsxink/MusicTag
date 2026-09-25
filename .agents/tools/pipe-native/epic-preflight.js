#!/usr/bin/env node
'use strict';

// Deterministic Epic item selection/validation. Remote facts are supplied by
// the shell preflight; this module never launches an Agent or another process.
const fs = require('node:fs');
const path = require('node:path');
const progressRuntime = require('./progress.js');

function completedCandidates(epic, progress) {
  return (epic.items || []).filter((item) => {
    const record = progress && progress.epicItems && progress.epicItems[item.name];
    return record && record.status === 'done' && record.remoteMerged === true && item.issue;
  });
}

function activeItems(epic, progress, remotelyMergedIssues = []) {
  const merged = new Set(remotelyMergedIssues.map(String));
  return (epic.items || []).filter((item) => {
    return !merged.has(String(item.issue));
  });
}

function mergedClosingPr(pullRequests, repository, issueNumber) {
  return (pullRequests || []).find((pr) => pr && pr.mergedAt && pr.repository && pr.repository.nameWithOwner === repository
    && (pr.closingIssuesReferences && pr.closingIssuesReferences.nodes || []).some((issue) => Number(issue.number) === Number(issueNumber)
      && issue.repository && issue.repository.nameWithOwner === repository)) || null;
}

async function validateActiveItems({ epic, progress, remotelyMergedIssues, repoRoot, artifactExists, issueExists, specValid }) {
  const active = activeItems(epic, progress, remotelyMergedIssues);
  for (const item of active) {
    if (!Number.isInteger(Number(item.issue)) || Number(item.issue) <= 0) throw new Error(`活动子变更 ${item.name} 缺少有效 Issue 编号`);
    for (const file of ['proposal.md', 'design.md', 'tasks.md']) {
      const target = path.join(repoRoot, 'openspec', 'changes', item.name, file);
      if (!await artifactExists(target)) throw new Error(`子变更 ${item.name} 缺 ${file}`);
    }
    if (!await artifactExists(path.join(repoRoot, 'openspec', 'changes', item.name, 'specs'))) throw new Error(`子变更 ${item.name} 缺 specs`);
    if (!await issueExists(item.issue)) throw new Error(`子变更 ${item.name} 的 GitHub Issue #${item.issue} 无法读取`);
    if (!await specValid(item.name)) throw new Error(`子变更 ${item.name} 未通过 openspec validate --strict`);
  }
  return active;
}

function loadEpicContext(epicFile, repoRoot = process.cwd()) {
  const epic = JSON.parse(fs.readFileSync(epicFile, 'utf8'));
  const epicName = epic.name || path.basename(path.dirname(epicFile));
  const progress = progressRuntime.loadEpicProgress(repoRoot, epicName);
  if (!progress) throw new Error(`Epic 尚无 epic-progress.md：${epicName}`);
  const lock = progressRuntime.readLock(repoRoot, epicName);
  if (!lock || lock.owner !== progress.owner) throw new Error('Epic progress 与活动 lock owner 不匹配；禁止调度');
  return { epic, progress };
}

function writeRemoteFacts(epicFile, rowsFile, outputFile, branch, worktree, head, repoRoot = process.cwd()) {
  const { epic, progress } = loadEpicContext(epicFile, repoRoot);
  if (branch !== progress.branch || path.resolve(worktree) !== progress.worktree || progress.sourceRevision !== epic.sourceRevision) {
    throw new Error('Epic branch/worktree/sourceRevision 与持久化基线不匹配');
  }
  const rows = fs.readFileSync(rowsFile, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => line.split('\t'));
  const byName = new Map(rows.map(([name, issue, prNumber, mergeSha, mergedAt]) => [name, {
    issueNumber: Number(issue), remoteMerged: Boolean(prNumber), prNumber: prNumber ? Number(prNumber) : null,
    mergeSha: mergeSha || null, mergedAt: mergedAt || null,
  }]));
  if (byName.size !== epic.items.length || epic.items.some((item) => !byName.has(item.name))) throw new Error('远端事实必须覆盖 Epic 的每个子项');
  for (const item of epic.items) if (byName.get(item.name).issueNumber !== Number(item.issue)) throw new Error(`远端事实 Issue 不匹配：${item.name}`);
  const facts = {
    remoteVerified: true, verifiedAt: new Date().toISOString(), branch, worktree: path.resolve(worktree),
    sourceRevision: progress.sourceRevision, head,
    epicItems: Object.fromEntries([...byName.entries()].map(([name, value]) => [name, value])),
  };
  const temp = `${outputFile}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(facts, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, outputFile);
  return facts;
}

function run(argv) {
  const [command, epicFile, issueList = ''] = argv;
  if (!command || !epicFile || !['candidates', 'active', 'items', 'facts', 'match-pr'].includes(command)) {
    throw new Error('用法: epic-preflight.js <candidates|active|items|facts|match-pr> <参数>');
  }
  if (command === 'match-pr') {
    const pr = mergedClosingPr(JSON.parse(argv[3]), epicFile, argv[2]);
    console.log(pr ? `${pr.number}\t${pr.mergeCommit && pr.mergeCommit.oid || ''}\t${pr.mergedAt}` : '\t\t');
    return;
  }
  if (command === 'facts') { writeRemoteFacts(epicFile, argv[2], argv[3], argv[4], argv[5], argv[6]); return; }
  const { epic, progress } = loadEpicContext(epicFile);
  const items = command === 'candidates'
    ? completedCandidates(epic, progress)
    : command === 'items' ? epic.items : activeItems(epic, progress, issueList ? issueList.split(',') : []);
  for (const item of items) console.log(`${item.name}\t${item.issue || ''}`);
}

if (require.main === module) {
  try { run(process.argv.slice(2)); }
  catch (error) { console.error(`✗ [epic-preflight] ${error.message}`); process.exitCode = 1; }
}

module.exports = { completedCandidates, activeItems, mergedClosingPr, validateActiveItems, loadEpicContext, writeRemoteFacts };
