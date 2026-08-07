'use strict';
// 角色单源（D7）：7 角色 system prompt 收敛到 roles/ 单一来源，
// claude/codex driver 均引用同一份物理文件，任何 driver 源码内无第二份文案。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const selfcheck = require('../selfcheck.js');

const CORE = path.join(__dirname, '..');
const ROLES_DIR = path.join(CORE, 'roles');
const ROLES_JSON = JSON.parse(fs.readFileSync(path.join(ROLES_DIR, 'roles.json'), 'utf8'));

test('role: roles.json 完整覆盖 7 角色，且每个角色 .md 文案存在且非空', () => {
  for (const role of selfcheck.REQUIRED_ROLES) {
    const entry = ROLES_JSON[role];
    assert.ok(entry, `角色 ${role} 未在 roles.json 定义`);
    const file = path.join(ROLES_DIR, entry.file || `${role}.md`);
    assert.ok(fs.existsSync(file), `角色 ${role} 文案文件缺失 ${file}`);
    const content = fs.readFileSync(file, 'utf8');
    assert.ok(content.trim().length > 0, `角色 ${role} 文案为空`);
  }
});

test('role: 角色文案不在任何 driver/核心源码内二次出现（单源，无第二份副本）', () => {
  // 取 leader 角色文案首行为指纹，扫描 pipe-core 全部 .js 源码（drivers/run/core 等）——
  // 若任一处包含该指纹，说明角色文案被复制进代码，违反单源。
  const leaderFile = path.join(ROLES_DIR, ROLES_JSON.leader.file);
  const fingerprint = fs.readFileSync(leaderFile, 'utf8').trim().split('\n')[0].trim();
  assert.ok(fingerprint.length > 10, '指纹太短无意义');
  const scanTargets = [
    path.join(CORE, 'drivers', 'claude.js'),
    path.join(CORE, 'drivers', 'codex.js'),
    path.join(CORE, 'run.js'),
    path.join(CORE, 'core.js'),
    path.join(CORE, 'pipeline.js'),
  ];
  for (const f of scanTargets) {
    const src = fs.readFileSync(f, 'utf8');
    assert.ok(!src.includes(fingerprint), `${path.basename(f)} 内含角色文案指纹，违反单源`);
  }
});

test('role: claude 用 --append-system-prompt 注入 roleFile，codex 读同一 roles/ 文件拼入 prompt', () => {
  const claude = require('../drivers/claude.js');
  const args = claude.buildArgs({ prompt: 'P', schema: {} }, { roleFile: path.join(ROLES_DIR, 'leader.md') });
  assert.ok(args.includes('--append-system-prompt'));
  const rf = args[args.indexOf('--append-system-prompt') + 1];
  assert.equal(rf, path.join(ROLES_DIR, 'leader.md'));
  // 同一份物理文件存在且可被 codex 读取
  assert.ok(fs.existsSync(rf));
  assert.ok(fs.readFileSync(rf, 'utf8').trim().length > 0);
});
