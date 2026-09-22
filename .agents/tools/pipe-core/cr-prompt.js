'use strict';

// 动态 CR prompt 构建（任务组 4.1）：不再注入固定「191 个测试」等历史结论，
// 而是从当前 change 的 state 与 git 证据实时生成——specs/design 路径、Tester
// 结构化结果、HEAD、diff stat、提交列表。证据全部来自当前 change，CR 保持只读，
// 且获准对 `git diff main...HEAD` 做定向只读审查（spec「动态证据注入 / 定向真实审查」）。
//
// 设计决策 9 落地：prompt builder 从 state 读取证据，git 证据通过 workspace.git
// （只读命令）现场采集；任何一条 git 命令失败都优雅降级为空占位，不阻塞审查。
// 模块零运行时依赖，供 core.js 注入 state 后调用。

const fs = require('node:fs');
const path = require('node:path');
const workspace = require('./workspace.js');

// 只读 git 证据采集。cwd 缺省用 process.cwd()；mainBranch 缺省 'main'。
// 每条命令失败即返回空串，绝不抛错（CR 证据缺失不应阻断流程）。
// diffStat/commits 有界截断，避免 prompt 过度膨胀（spec「上下文有界」取向）。
const MAX_DIFF_STAT_LINES = 40;
const MAX_COMMIT_LINES = 20;

function capped(lines, max) {
  const arr = lines.split('\n').filter(Boolean);
  if (arr.length <= max) return lines;
  return `${arr.slice(0, max).join('\n')}\n…（共 ${arr.length} 行，已截断）`;
}

function gitEvidence({ cwd, mainBranch } = {}) {
  const root = cwd || process.cwd();
  const base = mainBranch || 'main';
  const read = (args) => {
    try { return workspace.git(root, args).trim(); } catch (_) { return ''; }
  };
  const head = read(['rev-parse', 'HEAD']);
  const shortHead = head && head.length >= 12 ? head.slice(0, 12) : (head || 'no-head');
  // diff --stat 相对 main 的全量改动概览；无 main 分支/无提交时为空。
  const diffStat = read(['--no-pager', 'diff', '--stat', `${base}...HEAD`]);
  const commits = read(['--no-pager', 'log', '--oneline', `${base}..HEAD`]);
  return {
    head,
    shortHead,
    diffStat: diffStat ? capped(diffStat, MAX_DIFF_STAT_LINES) : '（无 diff --stat 输出：缺少 main 基准或当前分支无差异）',
    commits: commits ? capped(commits, MAX_COMMIT_LINES) : '（无提交列表）',
  };
}

// 收集当前 change 的审查证据清单：proposal/design/tasks 单文件 + specs 目录递归展开。
// root 用于解析实际资产根（cwd）；只列真实存在的路径，specs 目录按文件列举。
function evidencePaths(change, root) {
  const base = root || process.cwd();
  const dir = path.join(base, 'openspec', 'changes', change);
  const single = ['proposal.md', 'design.md', 'tasks.md'].map((name) => path.join(dir, name));
  const specsDir = path.join(dir, 'specs');
  let specsFiles = [];
  if (fs.existsSync(specsDir) && fs.statSync(specsDir).isDirectory()) {
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(d, e.name);
      return e.isDirectory() ? walk(p) : (e.name.endsWith('.md') ? [p] : []);
    });
    specsFiles = walk(specsDir).sort();
  }
  // 输出展示相对仓库根的路径，便于 CR 直接引用。
  const rel = (p) => path.relative(base, p);
  return [...single, ...specsFiles]
    .filter((p) => fs.existsSync(p))
    .map(rel);
}

function testerEvidence(state) {
  const node = state && state.nodes && state.nodes.tester;
  const result = node && node.result;
  if (!result) return null;
  const parts = [];
  if (Array.isArray(result.covered) && result.covered.length) parts.push(`covered: ${result.covered.join('、')}`);
  if (Array.isArray(result.missing) && result.missing.length) parts.push(`missing: ${result.missing.join('、')}`);
  parts.push(`smokePassed: ${result.smokePassed === true ? 'true' : 'false'}`);
  if (Array.isArray(result.risks) && result.risks.length) parts.push(`risks: ${result.risks.join('；')}`);
  return parts.join('；');
}

const RETRO_SPECIALS = [
  '跨模块状态语义：聚合/去重/折叠是否破坏上层按源取数/换源契约',
  '竞态与串扰：共享计数器/请求序号/全局状态是否跨 kind、跨面板互相污染',
  '网络与离线判定：网络失败与正常空结果是否被正确区分',
];

// 组装 CR prompt。state 来自 core.js 注入 ctx；cwd/mainBranch 用于 git 证据采集。
// 无 state/无 git 证据时优雅降级，仍保留只读边界、三检与四要素门槛（兼容 cr.prompt({})）。
function buildCrPrompt({ change, state, cwd, mainBranch }) {
  const root = cwd || process.cwd();
  const ev = gitEvidence({ cwd, mainBranch });
  const paths = change ? evidencePaths(change, root) : [];
  const tester = testerEvidence(state);

  const lines = [];
  lines.push(`你是 CR（只读，不改代码）。审查变更「${change || '(unknown)'}」的实现是否符合其规格。`);

  lines.push('');
  lines.push('## 当前变更证据（实时生成，只属于本 change，无历史固定结论）');
  if (paths.length) {
    lines.push(`- 规格/设计：${paths.join('、')}（请对照阅读）`);
  } else if (change) {
    lines.push(`- 规格/设计：openspec/changes/${change}/（目录不存在时按实际变更资产核对）`);
  }
  if (tester) lines.push(`- Tester 结果：${tester}`);
  lines.push(`- HEAD：${ev.shortHead}${ev.head ? `（${ev.head}）` : ''}`);
  lines.push(`- diff stat（${mainBranch || 'main'}...HEAD）：\n${ev.diffStat}`);
  lines.push(`- 提交列表（${mainBranch || 'main'}..HEAD）：\n${ev.commits}`);

  lines.push('');
  lines.push('## 审查边界（只读）');
  lines.push('- 只使用读工具审查（Bash/Read/Glob/Grep），不 Edit/Write 任何代码或 git 对象。');
  lines.push('- 允许定向只读执行 `git diff main...HEAD`（可加文件路径过滤）与读取关键文件；不要无路径全量读取整个 diff，避免上下文爆炸。');
  lines.push('- 大型 infra 变更遵守 ro 边界：先一次 `git diff --stat`，再少量定向读取核心文件，返回结构化 JSON 前不必逐行读完。');

  lines.push('');
  lines.push('## 三项复盘专项（不适用维度显式标注「不适用」）');
  for (const s of RETRO_SPECIALS) lines.push(`- ${s}`);
  lines.push('- 复盘维度按当前变更涉及面取舍，被判定不适用时明确标注「不适用」，避免形式化。');

  lines.push('');
  lines.push('## 结论要素与门槛');
  lines.push('- 问题分 阻断/major/minor 三级。');
  lines.push('- 每个 阻断/major 必须给全四要素：file + issue + specReference + suggestion；缺一项即视为未给出证据，Leader 据此打回补全。');
  lines.push('- `pass=true` 仅当无阻断且无 major（可含 minor）。');
  lines.push('- 按严重度返回结构化 JSON：`{ pass, blockers[], majors[], minors[] }`，每条 finding 含 severity/file/issue/specReference/suggestion。');

  lines.push('');
  lines.push('## 规则');
  lines.push('- 必须对照 specs/design 审查，不只查代码自身 bug。');
  lines.push('- 报告如实：无问题就明确说无阻断、无 major（pass=true）。');
  lines.push('- 阻断/major 问题如实上报，不隐瞒、不弱化；Leader 据此打回修复或挂起。');

  return lines.join('\n');
}

module.exports = { buildCrPrompt, gitEvidence, evidencePaths, testerEvidence, RETRO_SPECIALS };