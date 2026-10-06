'use strict';
// 单一 openspec 版本真值（Issue #147 第 1 条 hardening / design D1）。
//
// 扩展名必须是 .cjs：本文件要同时被两侧加载——
//   - CJS 侧：.agents/tools/pipe-core/{verify,integrate}.js、.agents/tools/pipe-native/self-check.js
//     （最近的 package.json 为 {"type":"commonjs"}）
//   - ESM 侧：.agents/commands/archive-change.js（根 package.json 为 {"type":"module"}）
// 具名导出用静态可分析的 `module.exports.X = ...` 形式，Node 24 的 ESM<-CJS
// 具名导入（cjs-module-lexer）才能取到；已实测 `import { X } from '...cjs'` 可用。
//
// 固定版本与 .github/workflows/ci.yml 的 `npx --yes @fission-ai/openspec@1.5.0` 同源。
// shell 调用点（pipe-preflight.sh / pipe-epic-preflight.sh）无法 require 本文件，
// 按 design D1 显式写字面量，其一致性由 self-check.js 的 fail-closed 检查保证。

const OPENSPEC_VERSION = '1.5.0';
const OPENSPEC_CLI_SPEC = '@fission-ai/openspec@1.5.0';
// npx 前缀：--yes 保证 CI / 无人值守场景下不因「是否安装」交互提示而挂起。
const OPENSPEC_NPX_PREFIX = ['--yes', OPENSPEC_CLI_SPEC];

// `npx --yes @fission-ai/openspec@1.5.0 validate <change> --strict --no-interactive`
function openspecValidateArgs(change, options = {}) {
  const target = options.all ? ['--all'] : [change];
  return [...OPENSPEC_NPX_PREFIX, 'validate', ...target, '--strict', '--no-interactive'];
}

// `npx --yes @fission-ai/openspec@1.5.0 archive <change> --yes`
function openspecArchiveArgs(change) {
  return [...OPENSPEC_NPX_PREFIX, 'archive', change, '--yes'];
}

module.exports.OPENSPEC_VERSION = OPENSPEC_VERSION;
module.exports.OPENSPEC_CLI_SPEC = OPENSPEC_CLI_SPEC;
module.exports.OPENSPEC_NPX_PREFIX = OPENSPEC_NPX_PREFIX;
module.exports.openspecValidateArgs = openspecValidateArgs;
module.exports.openspecArchiveArgs = openspecArchiveArgs;
