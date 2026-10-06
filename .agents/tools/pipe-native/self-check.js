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

// ── openspec 版本固定（Issue #147 第 1 条 hardening / design D1）────────────
//
// fail-closed 静态校验：任一 openspec 调用点都必须固定到 openspec-version.cjs 声明的
// 同一版本。本检查只读文件、不启动子进程；命中未固定调用时报告「文件:行号」。
// 与既有 self-check.js:157 的正则断言同一手法（断言调用点内容），只是断言点从
// 「有没有 --strict」升级为「有没有固定版本」。

const OPENSPEC_VERSION_MODULE = '.agents/tools/pipe-native/openspec-version.cjs';
// 经共享常量派生的调用点：命令由 openspecArchiveArgs/openspecValidateArgs 生成，
// 文件里不应再出现裸版本字面量或裸 openspec 可执行名。
const OPENSPEC_DERIVED_CALL_SITES = [
  '.agents/commands/archive-change.js',
  '.agents/tools/pipe-core/verify.js',
  '.agents/tools/pipe-core/integrate.js',
];
// shell 与 YAML 无法 require 该常量，按 design D1 显式写字面量并由此处校验一致性；
// .github/workflows/ci.yml:21 是本项的既有基准。
const OPENSPEC_LITERAL_CALL_SITES = [
  '.agents/workflows/pipe-preflight.sh',
  '.agents/workflows/pipe-epic-preflight.sh',
  '.github/workflows/ci.yml',
];
// 散文指令面与只读角色权限白名单（Issue #147 D1 扩展 / 用户裁决「全修」）。
// 这些文件教主 Agent 或子 Agent「怎么跑 openspec」，形态同样必须固定，否则
// 执行时落到 PATH 版本（实测 1.13.2）与 CI/自检的固定版本（1.5.0）漂移。
// 注意区分两种合法固定形态：散文行写死与常量同源的完整版本；
// .opencode 权限白名单按模式匹配，版本用通配（@fission-ai/openspec@*），
// 避免每次 bump 都要改权限表。本检查的判据是「不存在裸形态」，两种都天然通过。
const OPENSPEC_PROSE_CALL_SITES = [
  'AGENTS.md',
  '.claude/CLAUDE.md',
  '.agents/skills/pipe/WORKFLOW.md',
  '.agents/tools/pipe-core/roles/verify-agent.md',
  '.opencode/agents/verify-agent.md',
  '.claude/commands/verify.md',
  '.claude/commands/opsx/apply.md',
  '.claude/commands/opsx/archive.md',
  '.claude/commands/opsx/explore.md',
  '.claude/commands/opsx/propose.md',
  '.claude/commands/opsx/run.md',
  '.claude/commands/opsx/sync.md',
  '.claude/skills/openspec-apply-change/SKILL.md',
  '.claude/skills/openspec-archive-change/SKILL.md',
  '.claude/skills/openspec-explore/SKILL.md',
  '.claude/skills/openspec-propose/SKILL.md',
  '.claude/skills/openspec-sync-specs/SKILL.md',
];

// 去掉行注释：注释里合法地提到旧的裸命令形态（如「不再用 `npx openspec`」），
// 不应被当成调用点误报。报告时仍用原始行，便于定位。
function stripLineComment(line) {
  const cuts = [line.indexOf('//')];
  const hash = line.search(/\s#/);
  if (hash >= 0) cuts.push(hash);
  const valid = cuts.filter((i) => i >= 0);
  return valid.length ? line.slice(0, Math.min(...valid)) : line;
}

// 该行（去注释后）是否在**执行** openspec。两种合法形态：
//   1. 命令数组位置：command: 'npx', args: [...'openspec'...]  —— 未固定的裸 npx 调用
//   2. 裸可执行名：command: 'openspec', args: [...]
// 刻意不匹配 path.join(root, 'openspec', ...) 这类**目录路径**——那是规格目录布局
// （openspec/changes、openspec/specs），不是 CLI 调用，不受版本固定约束。
// 判据：'openspec' 出现在「可执行名位置」——即紧跟 command:/args:/spawnSync( 之后，
// 或作为 npx 参数。'openspec', 'changes' 这种目录序列不匹配（后面跟的是路径段而非 CLI 子命令）。
function invokesOpenspec(code) {
  const npxCall = /\bnpx\b[^;'"]*\bopenspec\b/.test(code);
  // 可执行名位置：'openspec' 后面必须跟 CLI 子命令或参数，且不是目录段。
  const bareCall = /(['"`]openspec['"`]\s*,\s*(?:args\s*:\s*)?\[?\s*['"`](?:archive|validate|list|view|show|init)\b)/.test(code);
  return npxCall || bareCall;
}

// 裸散文形态：`openspec` 后直接跟空白 + CLI 子命令（如 `openspec validate`、
// 反引号包裹的 `` `npx openspec status` ``）。固定形态是
// `@fission-ai/openspec@<ver|*> <子命令>`——@ 之后不匹配，目录路径
// `openspec/changes`（/ 之后）也不匹配；行首边界排除 \w@./\- 防止把
// `music-openspec` 这类词的一部分当命令。大小写敏感：`OpenSpec validate`
// 是产品名叙述，不是可执行形态。
function bareProseOpenspec(code) {
  return /(^|[^@\w./\\-])openspec[ \t]+(validate|archive|new|status|instructions|list|show|init)\b/.test(code)
    || /\bnpx[ \t]+openspec\b/.test(code);
}

function proseOpenspecPins(code, raw, relative, spec) {
  const pins = [...code.matchAll(/@fission-ai\/openspec@([^\s"'`]+)/g)];
  if (!pins.length) return false;
  return pins.some((match) => {
    const pin = '@fission-ai/openspec@' + match[1].replace(/[),.;]+$/, '');
    const exactVerifyAllowlist = relative === '.opencode/agents/verify-agent.md'
      && /^\s*"npx --yes @fission-ai\/openspec@\* validate \*": allow\s*$/.test(raw);
    return pin !== spec && !(exactVerifyAllowlist && pin === '@fission-ai/openspec@*');
  });
}

function checkOpenspecPinning(root, issues) {
  // 唯一真值：从常量模块文本里静态取出固定版本。刻意用读文本 + 正则而非 require()，
  // 以保持 self-check「纯静态、不执行仓库代码」的定位；取不到即 fail-closed。
  const source = read(root, OPENSPEC_VERSION_MODULE, issues);
  if (source === null) {
    issues.push('缺少 openspec 版本常量，无法校验各调用点是否固定版本（fail-closed）');
    return;
  }
  const matched = /OPENSPEC_CLI_SPEC\s*=\s*'@fission-ai\/openspec@([^']+)'/.exec(source);
  if (!matched) {
    issues.push(OPENSPEC_VERSION_MODULE + ' 未声明固定版本 OPENSPEC_CLI_SPEC（fail-closed）');
    return;
  }
  const spec = '@fission-ai/openspec@' + matched[1];

  for (const relative of OPENSPEC_DERIVED_CALL_SITES) {
    const text = read(root, relative, issues);
    if (text === null) continue;
    if (!text.includes('openspec-version.cjs')) {
      issues.push(relative + ' 必须从 ' + OPENSPEC_VERSION_MODULE + ' 派生 openspec 命令，不得自带版本字面量');
    }
    text.split('\n').forEach((raw, index) => {
      if (invokesOpenspec(stripLineComment(raw))) {
        issues.push(`${relative}:${index + 1} openspec 调用未固定版本（应由 ${OPENSPEC_VERSION_MODULE} 派生）：${raw.trim()}`);
      }
    });
  }

  for (const relative of OPENSPEC_LITERAL_CALL_SITES) {
    const text = read(root, relative, issues);
    if (text === null) continue;
    text.split('\n').forEach((raw, index) => {
      if (invokesOpenspec(stripLineComment(raw)) && !raw.includes(spec)) {
        issues.push(`${relative}:${index + 1} openspec 调用未固定到 ${spec}：${raw.trim()}`);
      }
    });
  }

  // 散文/白名单：裸形态 fail-closed，显式版本必须与共享常量一致。
  // 仅 OpenCode verify-agent 的 permission pattern 允许 @*，以免每次 bump 改权限表。
  for (const relative of OPENSPEC_PROSE_CALL_SITES) {
    const text = read(root, relative, issues);
    if (text === null) continue;
    text.split('\n').forEach((raw, index) => {
      const code = stripLineComment(raw);
      if (bareProseOpenspec(code)) {
        issues.push(`${relative}:${index + 1} openspec 散文调用未固定版本（应为 npx --yes ${spec} <子命令> …）：${raw.trim()}`);
      } else if (proseOpenspecPins(code, raw, relative, spec)) {
        issues.push(`${relative}:${index + 1} openspec 散文调用未固定到共享版本 ${spec}（仅精确权限白名单行可用 @* 通配）：${raw.trim()}`);
      }
    });
  }
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

  for (const relative of ['.agents/workflows/pipe-preflight.sh', '.agents/workflows/pipe-epic-preflight.sh', '.agents/workflows/assert-pipe-workspace.sh', '.agents/workflows/pipe-branch-check.sh']) {
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
  if (epicShell !== null && (!/gh issue view/.test(epicShell) || !/@fission-ai\/openspec@[\d.]+ validate .*--strict/.test(epicShell) || !/epic-preflight\.js active/.test(epicShell) || !/epic_owner=\$\{2/.test(epicShell) || /includeClosedPrs/.test(epicShell))) {
    issues.push('Epic preflight 必须验证显式 owner、精确 GitHub closing PR、Issue 与活动 OpenSpec strict');
  }
  if (read(root, '.agents/tools/pipe-native/progress-template.md', issues) === null) issues.push('缺少 progress 模板');
  checkOpenspecPinning(root, issues);

  return { ok: issues.length === 0, issues, checkedAt: new Date().toISOString() };
}

module.exports = { run };
if (require.main === module) {
  const result = run(process.cwd());
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}
