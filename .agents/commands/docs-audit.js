#!/usr/bin/env node
'use strict';
// 确定性文档一致性审计 wrapper（docs/spec 域 Verify 的第一步）：
//   1. 权威文档存在且非空：docs/V1-PRD.md、docs/design/design.md；
//   2. 当前 change 的 openspec/changes/<change>/specs/ 若存在则至少含一篇 .md 规格。
// 输出机器可读 JSON { ok, missing, change }；退出码 0=通过、1=审计失败、2=用法错误。
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const change = process.argv[2];
if (!change || !/^[a-z0-9][a-z0-9-]*$/.test(change)) {
  console.error('用法: node .agents/commands/docs-audit.js <change>');
  process.exit(2);
}
const root = process.cwd();
const missing = [];

for (const doc of ['docs/V1-PRD.md', 'docs/design/design.md']) {
  const file = join(root, doc);
  if (!existsSync(file) || statSync(file).size === 0) missing.push(doc);
}

const specDir = join(root, 'openspec', 'changes', change, 'specs');
if (existsSync(specDir)) {
  const hasSpec = readdirSync(specDir, { recursive: true }).some((f) => String(f).endsWith('.md'));
  if (!hasSpec) missing.push(`openspec/changes/${change}/specs/*.md`);
}

if (missing.length) {
  console.error(`文档一致性审计失败：缺少 ${missing.join(', ')}`);
  process.stdout.write(JSON.stringify({ ok: false, change, missing }));
  process.exit(1);
}
process.stdout.write(JSON.stringify({ ok: true, change, missing: [] }));
process.exit(0);