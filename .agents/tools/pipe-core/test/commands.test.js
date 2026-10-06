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
  // handlers: { gh: (stdinArgs) => {stdout, stderr, status}, npx: ... }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-commands-'));
  for (const name of ['gh', 'npx']) {
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
// archive-change.js 经 npx 调固定版本（Issue #147 D1），而 `npx <pkg>` 按包名解析、
// 直接绕过 PATH，所以桩必须叫 npx 才拦得住（原叫 openspec 时永远拦不到）。
function writeOpenspec(dir, scriptBody) {
  fs.writeFileSync(path.join(dir, 'npx'), `#!/usr/bin/env bash
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

// ── wait-ci：瞬时错误有界自愈 + errorKind 可区分（D3 / Issue #147 第 3 条）────
//
// 退避/轮询时长可注入（WAIT_CI_* 环境变量），使测试能在毫秒级跑完重试路径而不必
// 等生产默认的 5 次指数退避（1s→16s，合计 ~31s）。生产默认路径不依赖这些变量：
// 未设置时用真实默认值（有上限的真实退避，见 wait-ci.js 常量）。
const FAST_RETRY_ENV = {
  WAIT_CI_POLL_MS: '1',
  WAIT_CI_RETRY_BASE_MS: '1',
  WAIT_CI_RETRY_MAX_MS: '2',
  WAIT_CI_RETRY_MAX_ATTEMPTS: '5',
};

const EOF_MSG = 'Get "https://api.github.com/repos/o/r/pulls/12/check-runs": EOF';

// 计数型 gh 桩：前 failFirst 次写 stderr 并 exit 1（模拟瞬时网络错误），
// 之后输出 stdoutText 并 exit 0。返回读取调用次数的函数。
function writeCountingGhost(dir, { failFirst, stderrText, stdoutText }) {
  const counter = path.join(dir, 'gh-calls');
  fs.writeFileSync(path.join(dir, 'gh'), `#!/usr/bin/env bash
N=0
if [ -f ${JSON.stringify(counter)} ]; then N=$(cat ${JSON.stringify(counter)}); fi
N=$((N + 1))
echo "$N" > ${JSON.stringify(counter)}
if [ "$N" -le ${Number(failFirst)} ]; then
  echo ${JSON.stringify(stderrText)} >&2
  exit 1
fi
echo ${JSON.stringify(stdoutText)}
exit 0
`, { mode: 0o755 });
  return () => Number(fs.readFileSync(counter, 'utf8').trim());
}

// 常量桩：每次调用都输出同一 stdout 并 exit 0。
function writeConstantGhost(dir, stdoutText) {
  writeGhost(dir, `echo ${JSON.stringify(stdoutText)}\nexit 0\n`);
}

function runWrapperEnv(dir, script, args, extraEnv) {
  const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, ...extraEnv };
  return spawnSync(process.execPath, [path.join(CMDS, script), ...args], { encoding: 'utf8', env, timeout: 60_000 });
}

test('wait-ci: 瞬时错误（前 2 次 EOF）后有界退避重试，自愈并返回真实 checks 事实', () => {
  const dir = fakeBinDir({});
  const calls = writeCountingGhost(dir, {
    failFirst: 2,
    stderrText: EOF_MSG,
    stdoutText: '[{"name":"cargo","state":"SUCCESS","link":""}]',
  });
  const r = runWrapperEnv(dir, 'wait-ci.js', ['12'], FAST_RETRY_ENV);
  assert.equal(r.status, 0, `期望自愈后 exit 0，实际 exit ${r.status}：${r.stdout}${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.deepEqual(out.checks, { total: 1, passed: 1, failed: 0 });
  // 已自愈：不得残留错误分类。
  assert.equal(out.errorKind, null);
  assert.ok(calls() >= 3, `期望至少 3 次 gh 调用（2 次失败 + 1 次成功），实际 ${calls()}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('wait-ci: 持续 EOF 耗尽重试次数 → exit 1 + errorKind=network（有上限，不再无限重试）', () => {
  const dir = fakeBinDir({});
  const calls = writeCountingGhost(dir, {
    failFirst: 999,
    stderrText: EOF_MSG,
    stdoutText: '[{"name":"cargo","state":"SUCCESS","link":""}]',
  });
  const r = runWrapperEnv(dir, 'wait-ci.js', ['12'], FAST_RETRY_ENV);
  assert.equal(r.status, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.equal(out.errorKind, 'network');
  assert.match(out.error, /EOF/);
  // 有上限：首次 + 最多 5 次重试 = 6 次 gh 调用，不得更多。
  assert.equal(calls(), 6, `期望 6 次 gh 调用（1 + 5 次重试），实际 ${calls()}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('wait-ci: errorKind 能区分「取不到远端事实」（network）与「CI 未通过」（checks-failed）', () => {
  const dir = fakeBinDir({});

  // 真实 CI 失败：远端事实表明 required checks 未通过。
  writeConstantGhost(dir, '[{"name":"cargo","state":"FAILURE","link":""}]');
  const failedRun = runWrapperEnv(dir, 'wait-ci.js', ['12'], FAST_RETRY_ENV);
  assert.equal(failedRun.status, 1);
  const failedOut = JSON.parse(failedRun.stdout);
  assert.equal(failedOut.ok, false);
  assert.equal(failedOut.errorKind, 'checks-failed');
  assert.match(failedOut.error, /cargo/);

  // 取不到远端事实：持续 EOF 耗尽重试。
  const calls = writeCountingGhost(dir, {
    failFirst: 999,
    stderrText: EOF_MSG,
    stdoutText: '[{"name":"cargo","state":"SUCCESS","link":""}]',
  });
  const networkRun = runWrapperEnv(dir, 'wait-ci.js', ['12'], FAST_RETRY_ENV);
  assert.equal(networkRun.status, 1);
  const networkOut = JSON.parse(networkRun.stdout);
  assert.equal(networkOut.errorKind, 'network');

  // 两者必须不同，且都不与成功态混淆。
  assert.notEqual(networkOut.errorKind, failedOut.errorKind);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('wait-ci: 认证失败属不可重试 → 立即 exit 1，不做退避重试', () => {
  const dir = fakeBinDir({});
  const calls = writeCountingGhost(dir, {
    failFirst: 999,
    stderrText: 'gh auth 失败 Bad credentials',
    stdoutText: '[{"name":"cargo","state":"SUCCESS","link":""}]',
  });
  const r = runWrapperEnv(dir, 'wait-ci.js', ['12'], FAST_RETRY_ENV);
  assert.equal(r.status, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.equal(out.errorKind, 'auth');
  assert.equal(calls(), 1, `不可重试错误不应重试，实际调用 gh ${calls()} 次`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('wait-ci: 退避不得超出总 timeout 预算（默认 1s 起步退避 vs 300ms 预算）', () => {
  const dir = fakeBinDir({});
  const calls = writeCountingGhost(dir, { failFirst: 999, stderrText: EOF_MSG, stdoutText: '[]' });
  const started = Date.now();
  // 不注入退避：生产默认 RETRY_BASE_MS=1000ms，预算仅 300ms → 退避须被预算截断并及时收口。
  const r = runWrapperEnv(dir, 'wait-ci.js', ['12', '--timeout=300'], {});
  const elapsed = Date.now() - started;
  assert.equal(r.status, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.errorKind, 'network');
  assert.ok(calls() >= 1 && calls() <= 2, `退避不得超出预算：实际调用 gh ${calls()} 次（预算 300ms < 退避 1000ms）`);
  assert.ok(elapsed < 2000, `退避超出 timeout 预算：耗时 ${elapsed}ms（预算 300ms，默认退避 1000ms）`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('wait-ci: 轮询等待不超出剩余预算（定时器等待，不做整段盲等）', () => {
  const dir = fakeBinDir({});
  writeConstantGhost(dir, '[{"name":"cargo","state":"IN_PROGRESS","link":""}]');
  const started = Date.now();
  // 轮询间隔 5000ms 远大于预算 300ms → 必须在预算内收口而非盲等整段。
  const r = runWrapperEnv(dir, 'wait-ci.js', ['12', '--timeout=300'], { WAIT_CI_POLL_MS: '5000' });
  const elapsed = Date.now() - started;
  assert.equal(r.status, 1);
  assert.equal(JSON.parse(r.stdout).errorKind, 'timeout');
  assert.ok(elapsed < 2000, `轮询等待超出预算：耗时 ${elapsed}ms（预算 300ms）`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('wait-ci: 用法错误仍为 exit 2 且 stdout 为空', () => {
  const dir = fakeBinDir({});
  const r = runWrapper(dir, 'wait-ci.js', []);
  assert.equal(r.status, 2);
  assert.equal(r.stdout, '');
  fs.rmSync(dir, { recursive: true, force: true });
});