#!/usr/bin/env node
'use strict';

// 三端真实 CLI smoke harness。默认只探测版本，避免无认证时把 conformance
// 伪装成通过；设置 PIPE_REAL_SMOKE=1 才允许调用最小只读/临时 worktree hook。
const { spawnSync } = require('node:child_process');

const RUNTIMES = [
  { name: 'claude', bin: 'claude' },
  { name: 'codex', bin: 'codex' },
  { name: 'opencode', bin: 'opencode' },
];

function probe(runtime) {
  const result = spawnSync(runtime.bin, ['--version'], { encoding: 'utf8', timeout: 5000 });
  if (result.error) return { name: runtime.name, status: 'skip', reason: `${runtime.bin} 不可用：${result.error.message}` };
  if (result.status !== 0) return { name: runtime.name, status: 'skip', reason: `${runtime.bin} 版本探测失败：${result.stderr || result.status}` };
  if (process.env.PIPE_REAL_SMOKE !== '1') {
    return { name: runtime.name, status: 'skip', version: (result.stdout || '').trim(), reason: '仅完成版本探测；需 PIPE_REAL_SMOKE=1 才执行真实最小节点' };
  }
  // 真实执行由 CI/人工提供临时 worktree 与认证后接入；不允许静默换用其他 driver。
  return { name: runtime.name, status: 'skip', version: (result.stdout || '').trim(), reason: '真实 smoke hook 未配置临时 worktree/认证，明确跳过' };
}

function main() {
  const results = RUNTIMES.map(probe);
  process.stdout.write(`${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`);
  process.exit(results.some((result) => result.status === 'fail') ? 1 : 0);
}

if (require.main === module) main();
module.exports = { RUNTIMES, probe };
