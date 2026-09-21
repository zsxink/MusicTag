'use strict';
// P6（D11/D12）driver 注册中心：注册 claude/codex/opencode 三端 driver，
// 供 run.js 获取 driver 模块、帮助文本、环境 matcher。核心不再硬编码 DRIVERS 枚举
// 或 if (driverName === ...) 角色注入（D11 约束 1/3）。
//
// 注册表是「中立 manifest」：{ name, modulePath, help, envMatchers }。
// - modulePath：driver 实现文件（惰性 require，driver 未实现时 available=false）。
// - envMatchers：环境探测规则（<driver> 数组 vs 真值标记）。
// - help：driver 的中立帮助文本（不绑定任一宿主斜杠命令）。
//
// 新增 runtime = 往 manifest 加一条 + 实现对应 driver 模块；core/pipeline/state 零改动。

const path = require('node:path');
const { API_VERSION } = require('./contract.js');

// 三端注册表。opencode 模块在 9.7 实现前 available=false（惰性 require 兜底）。
// roleInjection：driver 翻译角色单源文案的宿主形态——
//   'system-prompt-file' — 通过宿主 CLI 的 system-prompt 注入参数引用 roles/<role>.md 文件；
//   'prompt-prefix'      — 把 roles/<role>.md 内容拼进 agent prompt 开头。
// 公共 wrapper 按此能力组装 role（capability 驱动，不按 driver 名字 if 分支——D11 约束 1/3）。
const MANIFEST = [
  {
    name: 'claude',
    apiVersion: API_VERSION,
    modulePath: path.join(__dirname, 'claude.js'),
    roleInjection: 'system-prompt-file',
    help: 'claude       — Claude Code 驱动（claude -p，--append-system-prompt 注入 roles/）',
    envMatchers: {
      // CLAUDECODE 真值（'1'/'true'）→ claude；'0'/空串不误判（复核2 minor）
      truthy: 'CLAUDECODE',
      contains: null,
    },
  },
  {
    name: 'codex',
    apiVersion: API_VERSION,
    modulePath: path.join(__dirname, 'codex.js'),
    roleInjection: 'prompt-prefix',
    help: 'codex       — Codex 驱动（codex exec，读 result 文件 + 核心 schema 二次校验）',
    envMatchers: {
      truthy: null,
      contains: 'AI_AGENT',
    },
  },
  {
    name: 'opencode',
    apiVersion: API_VERSION,
    modulePath: path.join(__dirname, 'opencode.js'),
    roleInjection: 'prompt-prefix',
    help: 'opencode    — OpenCode 驱动（opencode run --format json，解析 NDJSON 事件流）',
    envMatchers: {
      truthy: null,
      contains: 'AI_AGENT',
    },
  },
];

// 显式解析 envMatchers 匹配（单测可直接调用）：
// 返回匹配的 driver 名，无匹配返回 null；歧义（多个 contains 同时命中）要求显式指定。
function detect(env = process.env) {
  const cc = String(env.CLAUDECODE || '').toLowerCase();
  const truthyHits = cc === '1' || cc === 'true' ? ['claude'] : [];
  const containsHits = [];
  for (const entry of MANIFEST) {
    const key = entry.envMatchers.contains;
    if (!key) continue;
    const val = env[key] || '';
    if (entry.name === 'codex' && /codex/i.test(val)) containsHits.push('codex');
    if (entry.name === 'opencode' && /opencode/i.test(val)) containsHits.push('opencode');
    if (entry.name === 'claude' && /claude/i.test(val)) containsHits.push('claude');
  }
  const hits = [...truthyHits, ...containsHits];
  if (hits.length === 1) return hits[0];
  return null; // 无匹配 / 歧义 → 要求显式 --driver（绝不猜错，D5）
}

// registry.get(name)：惰性 require driver 模块；模块缺失 → { available:false, module:null }。
function get(name) {
  const entry = MANIFEST.find((e) => e.name === name);
  if (!entry) return null;
  let mod = null;
  let loadError = null;
  try {
    mod = require(entry.modulePath);
  } catch (e) {
    loadError = String(e && e.message || e);
  }
  return {
    name,
    apiVersion: entry.apiVersion,
    driverVersion: mod && mod.DRIVER_VERSION || null,
    module: mod,
    available: !!mod && typeof mod.runAgent === 'function',
    loadError,
    help: entry.help,
  };
}

function list() {
  return MANIFEST.map((e) => ({ name: e.name, help: e.help, apiVersion: e.apiVersion }));
}

function names() {
  return MANIFEST.map((e) => e.name);
}

// 统一帮助文本（run.js 用法错误时展示；三端可读）。
function helpText() {
  return MANIFEST.map((e) => e.help).join('\n');
}

module.exports = { MANIFEST, detect, get, list, names, helpText };
