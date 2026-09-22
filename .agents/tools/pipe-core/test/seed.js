'use strict';
// 测试种子助手：为临时仓库写入中立 workflow 桩脚本（pipe-preflight.sh / pipe-epic-preflight.sh），
// 让 CLI / epic / conformance 测试中的确定性 bootstrap/spec-gate runner 能找到可执行脚本。
// 旧测试假设临时仓库天然含 .agents/workflows（git init 后并不存在）——确定性 runner 用 command-runner
// 执行真实脚本，临时仓库必须自备桩。桩保留 CLI 参数面（<change> [stage]）与 stage 分发，但不执行
// 真实仓库检查（分支/工作区/Issue/OpenSpec），这些在真实仓库的 production 路径由真实脚本保证。
const fs = require('node:fs');
const path = require('node:path');

// 用字符串拼接（而非模板字面量）避免 shell 参数展平 ${1:?} 被 JS 当作插值。
const PREFLIGHT_STUB = [
  '#!/usr/bin/env bash',
  'set -euo pipefail',
  '# 测试桩：确定性 bootstrap/spec-gate 的临时仓库替代脚本。',
  '# 只校验参数面与 stage 分发；真实分支/工作区/Issue/OpenSpec 检查在 production 路径。',
  'change_name=${1:?}',
  'stage=${2:-all}',
  'case "$stage" in',
  '  bootstrap|spec-gate|all) exit 0 ;;',
  '  *) echo "未知 preflight stage: $stage" >&2; exit 2 ;;',
  'esac',
].join('\n');

const EPIC_PREFLIGHT_STUB = [
  '#!/usr/bin/env bash',
  'set -euo pipefail',
  '# 测试桩：epic preflight 的临时仓库替代脚本。只校验 Epic 定义存在。',
  'epic_name=${1:?}',
  'test -f "openspec/epics/${epic_name}/epic.json"',
  'exit 0',
].join('\n');

// 在 <repo>/.agents/workflows/ 下写入桩脚本并保持可执行位。
function seedWorkflows(repo) {
  const destDir = path.join(repo, '.agents', 'workflows');
  fs.mkdirSync(destDir, { recursive: true });
  const files = {
    'pipe-preflight.sh': PREFLIGHT_STUB,
    'pipe-epic-preflight.sh': EPIC_PREFLIGHT_STUB,
  };
  for (const [name, source] of Object.entries(files)) {
    const file = path.join(destDir, name);
    fs.writeFileSync(file, source);
    fs.chmodSync(file, 0o755);
  }
  return destDir;
}

module.exports = { seedWorkflows, PREFLIGHT_STUB, EPIC_PREFLIGHT_STUB };