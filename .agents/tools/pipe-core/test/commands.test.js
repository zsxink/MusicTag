'use strict';
// 集成 wrapper 单测（6.5）：create-pr / wait-ci / merge-pr / archive-change
//   - 机器可读输出：stdout 为纯 JSON，人类可读消息走 stderr。
//   - CLI 兼容：退出码 0=成功、1=gh/openspec 失败、2=用法错误。
//   - 查询复用：create-pr 按 head 复用已有 PR；wait-ci 已全绿复用；merge 已 merged 复用。
// 用 fake gh/openspec 桩（PATH 前缀注入）驱动 wrapper，不触碰真实网络。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execSync } = require('node:child_process');

const CMDS = path.join(__dirname, '..', '..', '..', '..', '.agents', 'commands');

function fakeBinDir(handlers) {
  // handlers: { gh: (stdinArgs) => {stdout, stderr, status}, openspec: ... }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-commands-'));
  for (const name of ['gh', 'openspec']) {
    const h = handlers[name];
    fs.writeFileSync(path.join(dir, name), `#!/usr/bin/env bash
${name} "$@"
`, { mode: 0o755 });
  }
  return dir;
}

// 每次调用重新写桩：闭包无法跨进程。
function writeGhost(dir, scriptBody) {
  fs.writeFileSync(path.join(dir, 'gh'), `#!/usr/bin/env bash
${scriptBody}
`, { mode: 0o755 });
}
function writeOpenspec(dir, scriptBody) {
  fs.writeFileSync(path.join(dir, 'openspec'), `#!/usr/bin/env bash
${scriptBody}
`, { mode: 0o755 });
}

function runWrapper(dir, script, args) {
  const env = { ...process.env, PATH: `${dir}:${process.env.PATH}` };
  return spawnSync(process.execPath, [path.join(CMDS, script), ...args], { encoding: 'utf8', env, timeout: 60_000 });
}

test('archive-change: 成功输出 JSON + exit 0，失败输出 JSON + exit 1', () => {
  const dir = fakeBinDir({});
  writeOpenspec(dir, 'exit 0');
  let r = runWrapper(dir, 'archive-change.js', ['demo']);
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout), { ok: true, change: 'demo', archived: true });

  writeOpenspec(dir, 'echo "openspec boom" >&2; exit 1');
  r = runWrapper(dir, 'archive-change.js', ['demo']);
  assert.equal(r.status, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.match(out.error, /openspec boom/);

  // 用法错误 → exit 2，stdout 为空。
  r = runWrapper(dir, 'archive-change.js', ['../bad/../name']);
  assert.equal(r.status, 2);
  assert.equal(r.stdout, '');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('create-pr: 无 PR 时创建并输出 prUrl/reused=false；存在 PR 时复用', () => {
  const dir = fakeBinDir({});
  // 场景 A：无既有 PR → gh pr list 返回 []，gh pr create 输出 URL。
  writeGhost(dir, `if [ "$1" = "pr" ] && [ "$2" = "list" ]; then
  echo '[]'
  exit 0
fi
if [ "$1" = "pr" ] && [ "$2" = "create" ]; then
  echo 'https://github.com/zsxink/MusicTag/pull/9'
  exit 0
fi
exit 1
`);
  const r = runWrapper(dir, 'create-pr.js', ['feat-demo', 'demo change']);
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout), { ok: true, prUrl: 'https://github.com/zsxink/MusicTag/pull/9', number: 9, reused: false });

  // 场景 B：head 已有 open PR → 不调 create，直接复用。
  writeGhost(dir, `if [ "$1" = "pr" ] && [ "$2" = "list" ]; then
  echo '[{"number":5,"state":"OPEN","url":"https://github.com/zsxink/MusicTag/pull/5","title":"t"}]'
  exit 0
fi
# 不该走到 create
exit 99
`);
  const r2 = runWrapper(dir, 'create-pr.js', ['feat-demo', 'demo change']);
  assert.equal(r2.status, 0);
  assert.deepEqual(JSON.parse(r2.stdout), { ok: true, prUrl: 'https://github.com/zsxink/MusicTag/pull/5', number: 5, reused: true, state: 'OPEN' });

  // 用法错误 → exit 2。
  const u = runWrapper(dir, 'create-pr.js', ['head-only']);
  assert.equal(u.status, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('merge-pr: 已 merged 复用；未 merged 时 squash 合并', () => {
  const dir = fakeBinDir({});
  // 未 merged：pr view 返回 OPEN → merge 调用一次。
  writeGhost(dir, `if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  echo '{"state":"OPEN"}'
  exit 0
fi
if [ "$1" = "pr" ] && [ "$2" = "merge" ]; then
  exit 0
fi
exit 99
`);
  const r = runWrapper(dir, 'merge-pr.js', ['12']);
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout), { ok: true, number: 12, merged: true, reused: false });

  // 已 merged：直接复用，不调 merge。
  writeGhost(dir, `if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  echo '{"state":"MERGED"}'
  exit 0
fi
exit 99
`);
  const r2 = runWrapper(dir, 'merge-pr.js', ['12']);
  assert.equal(r2.status, 0);
  assert.deepEqual(JSON.parse(r2.stdout), { ok: true, number: 12, merged: true, reused: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('wait-ci: required checks 全绿立即通过；有失败则 exit 1', () => {
  const dir = fakeBinDir({});
  // 全绿：一次返回已完成 required checks → 直接通过（复用）。
  writeGhost(dir, `echo '[{"name":"cargo","state":"SUCCESS","link":""}]'
exit 0
`);
  const r = runWrapper(dir, 'wait-ci.js', ['12']);
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.checks.passed, 1);
  assert.equal(out.checks.failed, 0);

  // 有失败 required check → exit 1 + JSON 报告。
  writeGhost(dir, `echo '[{"name":"cargo","state":"FAILURE","link":""}]'
exit 0
`);
  const r2 = runWrapper(dir, 'wait-ci.js', ['12']);
  assert.equal(r2.status, 1);
  const out2 = JSON.parse(r2.stdout);
  assert.equal(out2.ok, false);
  assert.match(out2.error, /cargo/);

  // gh 故障 → exit 1。
  writeGhost(dir, `echo 'gh auth 失败' >&2; exit 1
`);
  const r3 = runWrapper(dir, 'wait-ci.js', ['12']);
  assert.equal(r3.status, 1);
  assert.equal(JSON.parse(r3.stdout).ok, false);
  fs.rmSync(dir, { recursive: true, force: true });
});