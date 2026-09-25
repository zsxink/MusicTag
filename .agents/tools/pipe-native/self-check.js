#!/usr/bin/env node
'use strict';

// Static, fail-closed validation for the native pipe contract. This program
// reads files only and deliberately does not invoke a shell, git, or an Agent.
const fs = require('node:fs');
const path = require('node:path');
const runtime = require('./progress.js');

function read(root, relative, issues) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) {
    issues.push('缺少 ' + relative);
    return null;
  }
  return fs.readFileSync(file, 'utf8');
}

function jsSyntax(relative, source, issues) {
  if (source === null) return;
  try {
    new Function(source.replace(/^#![^\n]*\n/, ''));
  } catch (error) {
    issues.push(relative + ' JavaScript 语法错误：' + error.message);
  }
}

function shellSyntax(relative, source, issues) {
  if (source === null) return;
  if (source.includes('<<<<<<<') || source.includes('=======') || source.includes('>>>>>>>')) {
    issues.push(relative + ' 含未解决的冲突标记');
  }
}

function checkEntrypoint(relative, text, issues, requireSharedReference = true) {
  if (text === null) return;
  const forbidden = [
    /^\s*\x60?\s*node\s+\.agents\/tools\/pipe-core\/run\.js\b/m,
    /^\s*\x60?\s*codex\s+exec\b/m,
    /^\s*\x60?\s*claude\s+-p\b/m,
    /^\s*\x60?\s*opencode\s+(?:run|chat)\b/m,
  ];
  for (const expression of forbidden) {
    if (expression.test(text)) issues.push(relative + ' 仍引用已退役的 CLI Agent 调度：' + expression);
  }
  if (requireSharedReference && !/WORKFLOW\.md|\.agents\/skills\/pipe\/SKILL\.md/.test(text)) {
    issues.push(relative + ' 未引用共享 WORKFLOW.md 或 pipe skill');
  }
}

function checkRoles(root, issues) {
  const rolesDir = '.agents/tools/pipe-core/roles';
  const index = read(root, rolesDir + '/roles.json', issues);
  let roleDefinitions = null;
  if (index !== null) {
    try { roleDefinitions = JSON.parse(index); }
    catch (error) { issues.push(rolesDir + '/roles.json 不是有效 JSON：' + error.message); }
  }
  for (const name of ['leader', 'architect', 'tester', 'cr-agent', 'verify-agent', 'rust-backend', 'vue-frontend']) {
    read(root, rolesDir + '/' + name + '.md', issues);
  }
  for (const name of ['leader', 'architect', 'tester', 'cr-agent', 'verify-agent', 'rust-backend', 'vue-frontend']) {
    const claudePath = name === 'leader' ? null : `.claude/agents/${name}.md`;
    const opencodePath = name === 'leader' ? null : `.opencode/agents/${name}.md`;
    for (const [relative, source] of [
      [claudePath, claudePath ? read(root, claudePath, issues) : null],
      [opencodePath, opencodePath ? read(root, opencodePath, issues) : null],
    ]) {
      if (relative && source !== null && !source.includes(`${rolesDir}/${name}.md`)) {
        issues.push(relative + ' 未引用公共角色规则');
      }
    }
  }
  for (const name of ['cr-agent', 'verify-agent']) {
    const claudePath = `.claude/agents/${name}.md`;
    const claude = read(root, claudePath, issues);
    if (claude !== null) {
      if (!/^permissionMode:\s*plan\s*$/m.test(claude)) issues.push(claudePath + ' 必须使用 plan 只读权限');
      const tools = /^tools:\s*(.+)$/m.exec(claude);
      if (!tools || /\b(?:Edit|Write)\b/.test(tools[1]) || (name === 'cr-agent' && /\bBash\b/.test(tools[1]))) {
        issues.push(claudePath + ' 的工具列表必须排除 Edit/Write，CR 还必须排除 Bash');
      }
    }
    const opencodePath = `.opencode/agents/${name}.md`;
    const opencode = read(root, opencodePath, issues);
    if (opencode !== null && (!/^mode:\s*subagent\s*$/m.test(opencode) || !/^  edit:\s*deny\s*$/m.test(opencode) || !/^  task:\s*deny\s*$/m.test(opencode) || !/^    "\*":\s*deny\s*$/m.test(opencode))) {
      issues.push(opencodePath + ' 必须禁止嵌套派发；只读角色还需禁止编辑与默认 Bash 命令');
    }
    if (name === 'cr-agent' && opencode !== null && /^    "[^"]+":\s*allow\s*$/m.test(opencode)) {
      issues.push(opencodePath + ' 的 CR 角色不得开放 Bash 命令；由主会话提供审查材料');
    }
  }
  const crCapabilities = roleDefinitions && roleDefinitions['cr-agent'] && roleDefinitions['cr-agent'].capabilities;
  if (!Array.isArray(crCapabilities) || !crCapabilities.includes('read_files') || !crCapabilities.includes('search_files') || crCapabilities.some((item) => ['shell', 'git_read', 'write_files', 'git_write', 'network'].includes(item))) {
    issues.push(rolesDir + '/roles.json 的 CR capability 必须只要求 read_files/search_files，不得要求 shell/git/network/write');
  }
  if (fs.existsSync(path.join(root, '.claude/agents/leader.md'))) issues.push('.claude/agents/leader.md 已过时：Leader 必须由当前主会话担任');
  if (fs.existsSync(path.join(root, '.opencode/agents/leader.md'))) issues.push('.opencode/agents/leader.md 已过时：Leader 必须由当前主会话担任');
}

function run(rootInput = process.cwd()) {
  const root = path.resolve(rootInput);
  const issues = [];
  const base = runtime.selfCheck(root);
  issues.push(...base.issues);

  const skill = read(root, '.agents/skills/pipe/SKILL.md', issues);
  const workflow = read(root, '.agents/skills/pipe/WORKFLOW.md', issues);
  if (skill !== null && !/WORKFLOW\.md/.test(skill)) issues.push('pipe SKILL.md 未指向共享 WORKFLOW.md');
  if (workflow !== null) {
    checkEntrypoint('.agents/skills/pipe/WORKFLOW.md', workflow, issues, false);
    if (!/progress-cli\.js/.test(workflow)) issues.push('共享 WORKFLOW.md 未使用 progress-cli.js 记录 checkpoint');
    if (!/source-fingerprint\.js/.test(workflow) || !/--source-manifest/.test(workflow)) issues.push('共享 WORKFLOW.md 未记录版本化源码 manifest 与 Verify 证据');
  }
  checkRoles(root, issues);

  const entries = [
    'AGENTS.md',
    '.claude/commands/pipe.md',
    '.claude/commands/pipe-epic.md',
    '.claude/commands/pipe-init.md',
    '.claude/commands/pipe-epic-status.md',
    '.claude/CLAUDE.md',
    '.opencode/commands/pipe.md',
    '.opencode/commands/pipe-epic.md',
  ];
  for (const relative of entries) checkEntrypoint(relative, read(root, relative, issues), issues);

  for (const relative of [
    '.claude/commands/pipe-epic.md',
    '.claude/commands/pipe-init.md',
    '.claude/commands/pipe-epic-status.md',
    '.opencode/commands/pipe-epic.md',
  ]) {
    const source = read(root, relative, issues);
    if (source !== null && !source.includes('.agents/runs/<epic>/epic-progress.md')) {
      issues.push(relative + ' 必须使用统一 Epic 进度路径 epic-progress.md');
    }
  }

  for (const relative of ['.agents/workflows/pipe-preflight.sh', '.agents/workflows/pipe-epic-preflight.sh', '.agents/workflows/assert-linked-worktree.sh']) {
    const source = read(root, relative, issues);
    shellSyntax(relative, source, issues);
    if (source !== null && /pipe-core\/run\.js|pipe-core\/.*self-check/.test(source)) {
      issues.push(relative + ' 仍依赖旧 pipe-core 自检或运行入口');
    }
  }
  jsSyntax('.agents/tools/pipe-native/progress.js', read(root, '.agents/tools/pipe-native/progress.js', issues), issues);
  jsSyntax('.agents/tools/pipe-native/progress-cli.js', read(root, '.agents/tools/pipe-native/progress-cli.js', issues), issues);
  jsSyntax('.agents/tools/pipe-native/epic-preflight.js', read(root, '.agents/tools/pipe-native/epic-preflight.js', issues), issues);
  jsSyntax('.agents/tools/pipe-native/source-fingerprint.js', read(root, '.agents/tools/pipe-native/source-fingerprint.js', issues), issues);
  const epicPreflight = read(root, '.agents/tools/pipe-native/epic-preflight.js', issues);
  if (epicPreflight !== null && (!/mergedClosingPr/.test(epicPreflight) || !/remotelyMergedIssues/.test(epicPreflight))) {
    issues.push('Epic preflight 必须以精确匹配的本轮远端 merged facts 控制子项跳过');
  }
  const epicShell = read(root, '.agents/workflows/pipe-epic-preflight.sh', issues);
  if (epicShell !== null && (!/gh issue view/.test(epicShell) || !/openspec validate .*--strict/.test(epicShell) || !/epic-preflight\.js active/.test(epicShell) || !/epic_owner=\$\{2/.test(epicShell) || /includeClosedPrs/.test(epicShell))) {
    issues.push('Epic preflight 必须验证显式 owner、精确 GitHub closing PR、Issue 与活动 OpenSpec strict');
  }
  if (read(root, '.agents/tools/pipe-native/progress-template.md', issues) === null) issues.push('缺少 progress 模板');

  return { ok: issues.length === 0, issues, checkedAt: new Date().toISOString() };
}

module.exports = { run };
if (require.main === module) {
  const result = run(process.cwd());
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}
