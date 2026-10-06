'use strict';
// openspec 版本固定（Issue #147 第 1 条 hardening / design D1）。
//
// 守护两件事：
//   1. 共享常量 .agents/tools/pipe-native/openspec-version.cjs 的导出形态正确，
//      且 CJS 侧与 ESM 侧都能真的从它取到值（.cjs 扩展名不是随意选的）。
//   2. 所有 openspec 调用点都固定到常量声明的版本；被移除时自检确实 fail-closed。
//
// 红测一律在 os.tmpdir() 的副本上进行，绝不修改仓库文件。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const CONST = path.join(ROOT, '.agents', 'tools', 'pipe-native', 'openspec-version.cjs');
const SELF_CHECK = path.join(ROOT, '.agents', 'tools', 'pipe-native', 'self-check.js');

const version = require(CONST);

// ── 常量本身 ────────────────────────────────────────────────────────────────

test('openspec-version: 固定版本与 CI 基准一致，导出形态可被两侧取到', () => {
  assert.equal(version.OPENSPEC_VERSION, '1.5.0');
  assert.equal(version.OPENSPEC_CLI_SPEC, '@fission-ai/openspec@1.5.0');
  assert.deepEqual(version.OPENSPEC_NPX_PREFIX, ['--yes', '@fission-ai/openspec@1.5.0']);
  assert.deepEqual(version.openspecValidateArgs('demo'), [
    '--yes', '@fission-ai/openspec@1.5.0', 'validate', 'demo', '--strict', '--no-interactive',
  ]);
  assert.deepEqual(version.openspecArchiveArgs('demo'), [
    '--yes', '@fission-ai/openspec@1.5.0', 'archive', 'demo', '--yes',
  ]);
});

test('openspec-version: .cjs 扩展名是硬要求——根 package.json 是 module，两侧加载方式不同', () => {
  assert.match(
    fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'),
    /"type"\s*:\s*"module"/,
    '根 package.json 变回 commonjs 时本测试的 ESM 侧前提需重新评估',
  );
  // CJS 侧：最近的 package.json 为 commonjs，require 可用。
  assert.equal(require(path.join(ROOT, '.agents', 'tools', 'pipe-core', 'package.json')).type, 'commonjs');
  assert.equal(require(path.join(ROOT, '.agents', 'tools', 'pipe-native', 'package.json')).type, 'commonjs');
});

test('openspec-version: ESM 侧具名导入 .cjs 真的可用（archive-change.js 依赖它）', () => {
  // archive-change.js 是 ESM（根 type:module），用具名导入读 .cjs。
  // 若 Node 的 cjs-module-lexer 认不出静态 module.exports.X = … 形式，
  // 该 import 会静默变成 undefined —— 故此处按真实加载路径验证。
  const script = `
    import { openspecArchiveArgs, OPENSPEC_CLI_SPEC } from ${JSON.stringify(CONST)};
    const got = openspecArchiveArgs('demo');
    if (OPENSPEC_CLI_SPEC !== '@fission-ai/openspec@1.5.0') { console.error('BAD_SPEC'); process.exit(3); }
    if (!Array.isArray(got) || got[1] !== '@fission-ai/openspec@1.5.0') { console.error('BAD_ARGS', JSON.stringify(got)); process.exit(4); }
    console.log(JSON.stringify(got));
  `;
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'openspec-esm-')), 'probe.mjs');
  fs.writeFileSync(file, script);
  const r = spawnSync(process.execPath, [file], { encoding: 'utf8' });
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
  assert.equal(r.status, 0, `ESM 具名导入 .cjs 失败：${r.stderr}`);
  assert.deepEqual(JSON.parse(r.stdout), ['--yes', '@fission-ai/openspec@1.5.0', 'archive', 'demo', '--yes']);
});

// ── 调用点固定 ──────────────────────────────────────────────────────────────

const DERIVED = [
  '.agents/commands/archive-change.js',
  '.agents/tools/pipe-core/verify.js',
  '.agents/tools/pipe-core/integrate.js',
];
const LITERAL = [
  '.agents/workflows/pipe-preflight.sh',
  '.agents/workflows/pipe-epic-preflight.sh',
  '.github/workflows/ci.yml',
];
// 散文指令面与权限白名单（与 self-check.js 的 OPENSPEC_PROSE_CALL_SITES 对应）。
// 全量复制用于「原样无 issue」与红测；若 self-check 新增散文文件而此处漏列，
// 末尾的「仓库自身自检当前为 ok」用例仍会兜底发现漂移。
const PROSE = [
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

test('openspec-version: 每个调用点都固定到 1.5.0，无裸 openspec / 裸 npx openspec', () => {
  for (const relative of [...DERIVED, ...LITERAL]) {
    const text = fs.readFileSync(path.join(ROOT, relative), 'utf8');
    for (const [index, raw] of text.split('\n').entries()) {
      const code = raw.split('//')[0];
      if (!/\bnpx\b[^;'"]*\bopenspec\b/.test(code) && !/['"`]openspec['"`]\s*,\s*\[?\s*['"`](?:archive|validate|list|view)\b/.test(code)) continue;
      assert.ok(
        raw.includes('@fission-ai/openspec@1.5.0') || code.includes('openspecValidateArgs') || code.includes('openspecArchiveArgs'),
        `${relative}:${index + 1} openspec 调用未固定版本：${raw.trim()}`,
      );
    }
  }
});

test('openspec-version: shell 与 CI 字面量与共享常量同源（design D1 的显式代价）', () => {
  for (const relative of LITERAL) {
    const text = fs.readFileSync(path.join(ROOT, relative), 'utf8');
    assert.match(text, /@fission-ai\/openspec@1\.5\.0/, `${relative} 缺少固定版本字面量`);
  }
});

// ── 红测：自检在版本固定被移除时确实 fail-closed ────────────────────────────
//
// 关键约束：红测只改 /tmp 副本，绝不动仓库文件（否则 CI 上会出现真实的漂移）。

// 把 self-check 会读的调用点文件复制到一个临时 root。
// self-check 对缺失文件也会报 issue，这里只关心版本固定相关的 issue，
// 因此不需要复制全部被检查文件。
function tmpCopy(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openspec-pin-'));
  for (const relative of files) {
    const dest = path.join(dir, relative);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(ROOT, relative), dest);
  }
  return dir;
}

// 直接 require self-check 并只筛版本固定相关的 issue（避免依赖整仓齐全）。
// 三类文案都算版本固定 issue：调用点未固定 / 取不到真值 / 常量未声明。
function pinIssues(dir) {
  delete require.cache[require.resolve(SELF_CHECK)];
  const run = require(SELF_CHECK).run;
  const result = run(dir);
  return result.issues.filter((issue) => /未固定|固定版本|OPENSPEC_CLI_SPEC/.test(issue));
}

const SELF_CHECK_DEPS = ['.agents/tools/pipe-native/progress.js', '.agents/tools/pipe-native/openspec-version.cjs'];
const ALL_PIN_FILES = [...SELF_CHECK_DEPS, ...DERIVED, ...LITERAL, ...PROSE];

test('openspec-version 红测: 副本原样时版本固定检查无 issue（先证明不是被噪声掩盖）', () => {
  const dir = tmpCopy(ALL_PIN_FILES);
  try {
    assert.deepEqual(pinIssues(dir), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('openspec-version 红测: 版本固定被移除时自检报出文件与行号（fail-closed）', () => {
  const cases = [
    {
      name: 'archive-change 退回裸 PATH openspec',
      file: '.agents/commands/archive-change.js',
      mutate: (s) => s.replace(
        /spawnSync\('npx', openspecArchiveArgs\(change\)/,
        "spawnSync('openspec', ['archive', change, '--yes']",
      ),
    },
    {
      name: 'verify.js 退回不带版本的 npx openspec',
      file: '.agents/tools/pipe-core/verify.js',
      mutate: (s) => s.split('openspecValidateArgs(change)').join("['openspec', 'validate', change, '--strict', '--no-interactive']"),
    },
    {
      name: 'integrate.js 退回不带版本的 npx openspec',
      file: '.agents/tools/pipe-core/integrate.js',
      mutate: (s) => s.replace(
        "command: 'npx', args: openspecArchiveArgs(change)",
        "command: 'npx', args: ['openspec', 'archive', change, '--yes']",
      ),
    },
    {
      name: 'pipe-preflight.sh 退回 npx openspec',
      file: '.agents/workflows/pipe-preflight.sh',
      mutate: (s) => s.replace('npx --yes @fission-ai/openspec@1.5.0 validate', 'npx openspec validate'),
    },
    {
      name: 'epic-preflight.sh 退回 npx openspec',
      file: '.agents/workflows/pipe-epic-preflight.sh',
      mutate: (s) => s.replace('npx --yes @fission-ai/openspec@1.5.0 validate', 'npx openspec validate'),
    },
    {
      name: 'CI 基准漂移到别的版本',
      file: '.github/workflows/ci.yml',
      mutate: (s) => s.replace('@fission-ai/openspec@1.5.0', '@fission-ai/openspec@1.13.2'),
    },
    {
      name: 'WORKFLOW.md 散文退回裸 npx openspec',
      file: '.agents/skills/pipe/WORKFLOW.md',
      mutate: (s) => s.replace('npx --yes @fission-ai/openspec@1.5.0 validate <change>', 'npx openspec validate <change>'),
    },
    {
      name: 'AGENTS.md 散文退回裸 npx openspec',
      file: 'AGENTS.md',
      mutate: (s) => s.replace('npx --yes @fission-ai/openspec@1.5.0 validate <change>', 'npx openspec validate <change>'),
    },
    {
      name: 'verify-agent 权限白名单退回 npx openspec',
      file: '.opencode/agents/verify-agent.md',
      mutate: (s) => s.replace('"npx --yes @fission-ai/openspec@* validate *"', '"npx openspec validate *"'),
    },
  ];

  for (const { name, file, mutate } of cases) {
    const dir = tmpCopy(ALL_PIN_FILES);
    try {
      const target = path.join(dir, file);
      const before = fs.readFileSync(target, 'utf8');
      const after = mutate(before);
      assert.notEqual(after, before, `红测前提失效：${file} 未匹配到待篡改的调用点（源码已变？更新本用例）`);
      fs.writeFileSync(target, after);

      const issues = pinIssues(dir);
      assert.ok(issues.length > 0, `版本固定被移除却未 fail-closed：${name}`);
      // 必须报出具体文件，且带行号，便于定位。
      assert.ok(
        issues.some((issue) => issue.startsWith(file + ':')),
        `${name}：issue 未指出目标文件与行号，实际=${JSON.stringify(issues)}`,
      );
      assert.match(issues.join('\n'), /:\d+ /, `${name}：issue 缺少行号`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('openspec-version 红测: 常量模块本身被删除时也 fail-closed（无法取到真值即拒绝）', () => {
  const dir = tmpCopy(ALL_PIN_FILES);
  try {
    fs.rmSync(path.join(dir, '.agents', 'tools', 'pipe-native', 'openspec-version.cjs'));
    const issues = pinIssues(dir);
    assert.ok(issues.length > 0, '常量缺失却未 fail-closed');
    // 取不到真值时必须拒绝，且要说清是「取不到真值」而非「检查通过」。
    assert.match(issues.join('\n'), /版本常量/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('openspec-version 红测: 目录路径（openspec/changes、openspec/specs）不被误判为 CLI 调用', () => {
  const dir = tmpCopy(ALL_PIN_FILES);
  try {
    fs.writeFileSync(
      path.join(dir, '.agents', 'tools', 'pipe-core', 'probe-paths.js'),
      "const a = path.join(root, 'openspec', 'changes', change, 'specs');\n",
    );
    assert.deepEqual(pinIssues(dir), [], '规格目录路径被误判为未固定版本');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('openspec-version 红测: 注释里提到旧命令形态不误报（避免自检噪声）', () => {
  const dir = tmpCopy(ALL_PIN_FILES);
  try {
    fs.writeFileSync(
      path.join(dir, '.agents', 'tools', 'pipe-core', 'probe-comment.js'),
      "// 旧写法是 npx openspec validate，请勿恢复。\nconst command = 'npx';\n",
    );
    assert.deepEqual(pinIssues(dir), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('openspec-version: 仓库自身自检当前为 ok（红测之外的常态断言）', () => {
  const r = spawnSync(process.execPath, [SELF_CHECK], { encoding: 'utf8', cwd: ROOT });
  assert.equal(r.status, 0, `self-check 未通过：${r.stdout}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.deepEqual(out.issues, []);
});
