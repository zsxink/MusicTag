'use strict';
// CI / release / 本地验证计划的套件清单一致性（Issue #147 第 4 条 / design D4）。
//
// 缺陷背景：pipe 有三套原生测试套件，但 `node --test` 在两个 workflow 里出现 0 次，
// 且 verify.js 的 infra 计划漏了 pipe-native 那一组——三处各跑各的，单侧覆盖无法被发现。
// 本测试把「三处必须跑同一份清单」变成断言，防止再次单侧遗漏。
//
// 刻意不放在 tests/workflow-core/：那属于另一变更组的文件。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');

// 三组套件。glob 形式而非目录：Node 24 对 `node --test <dir>` 报 MODULE_NOT_FOUND。
const SUITES = [
  '.agents/tools/pipe-core/test/*.test.js',
  'tests/workflow-core/*.test.cjs',
  '.agents/tools/pipe-native/test/*.test.js',
];

const SELF_CHECK = '.agents/tools/pipe-native/self-check.js';

// 从一行文本里抽出它提到的套件（按 SUITES 逐个匹配，避免正则误配相似路径）。
function suitesIn(text) {
  return SUITES.filter((suite) => text.includes(suite));
}

test('ci-suite-contract: 三组套件目录都真实存在且非空（清单本身没写错）', () => {
  for (const suite of SUITES) {
    // 去掉 glob 尾部，得到目录。
    const dir = suite.replace(/\/[^/]*\*[^/]*$/, '');
    const abs = path.join(ROOT, dir);
    assert.ok(fs.existsSync(abs), `套件目录不存在：${dir}`);
    const files = fs.readdirSync(abs).filter((name) => /test\.(js|cjs)$/.test(name));
    assert.ok(files.length > 0, `套件目录为空：${dir}`);
  }
});

test('ci-suite-contract: ci.yml 跑全部三组套件 + self-check', () => {
  const text = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.deepEqual(suitesIn(text), SUITES, 'ci.yml 的套件清单与预期不一致');
  assert.ok(text.includes(SELF_CHECK), 'ci.yml 缺少 self-check');
});

test('ci-suite-contract: release.yml test job 跑全部三组套件 + self-check', () => {
  const text = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
  assert.deepEqual(suitesIn(text), SUITES, 'release.yml 的套件清单与预期不一致');
  assert.ok(text.includes(SELF_CHECK), 'release.yml 缺少 self-check');
  // 必须在 publish-tauri 之前跑：发布不得绕过测试门禁。
  // 锚定 job 键 `  publish-tauri:`（行首缩进），避免命中顶部注释里的同名词。
  const publishJob = /^ {2}publish-tauri:/m.exec(text);
  assert.ok(publishJob, 'release.yml 未找到 publish-tauri job');
  const selfCheckAt = /^ {6}- name: Run pipe self-check$/m.exec(text);
  assert.ok(selfCheckAt, 'release.yml 未找到 self-check 步骤');
  assert.ok(selfCheckAt.index < publishJob.index, 'self-check 必须早于 publish-tauri job');
});

test('ci-suite-contract: verify.js 的 infra 计划与两处 workflow 同清单', () => {
  const { buildPlan } = require('../verify.js');
  const plan = buildPlan({ change: 'demo', domain: 'infra', root: ROOT });
  const testStep = plan.find((step) => step.args && step.args.includes('--test'));
  assert.ok(testStep, 'verify.js infra 计划缺少 node --test 步骤');
  assert.deepEqual(suitesIn(testStep.args.join(' ')), SUITES, 'verify.js 套件清单与 CI 不一致');

  // self-check 步骤必须真的执行 pipe-native/self-check.js。
  // 旧写法指向 pipe-core/run.js --self-check，那是退役 shim，按 run.test.js 的
  // 退役边界断言恒非零退出——留着等于没有门禁。
  const selfCheckStep = plan.find((step) => step.step === 'self-check');
  assert.ok(selfCheckStep, 'verify.js infra 计划缺少 self-check 步骤');
  assert.deepEqual(selfCheckStep.args, [path.join(ROOT, '.agents', 'tools', 'pipe-native', 'self-check.js')]);
});

test('ci-suite-contract: 三处套件集合彼此完全一致（防单侧覆盖）', () => {
  const ci = suitesIn(fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8'));
  const release = suitesIn(fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8'));
  const { buildPlan } = require('../verify.js');
  const plan = buildPlan({ change: 'demo', domain: 'infra', root: ROOT });
  const verify = suitesIn(plan.find((s) => s.args && s.args.includes('--test')).args.join(' '));

  assert.deepEqual(ci, release, 'ci.yml 与 release.yml 套件集合不一致');
  assert.deepEqual(ci, verify, 'ci.yml 与 verify.js 套件集合不一致');
  assert.equal(ci.length, SUITES.length, `套件组数应为 ${SUITES.length}，实际 ${ci.length}`);
});

test('ci-suite-contract: 两个 workflow 的 pipe 套件步骤无条件执行，不被 hashFiles 门静默跳过', () => {
  // 门禁若被 hashFiles 包住，未来某次 checkout 变化就会让门禁悄悄消失——
  // 这正是缺陷 4「无人执行」的成因形态，故显式断言无条件。
  for (const name of ['ci.yml', 'release.yml']) {
    const lines = fs.readFileSync(path.join(ROOT, '.github', 'workflows', name), 'utf8').split('\n');
    for (const [index, line] of lines.entries()) {
      if (!/run: node --test/.test(line)) continue;
      // 步骤的 name/run/if 在前一行附近；取前 3 行找 if:。
      const window = lines.slice(Math.max(0, index - 3), index).join('\n');
      assert.ok(
        !/^\s*if:\s/m.test(window),
        `${name}:${index + 1} pipe 套件步骤被 if: 条件门控，门禁可能静默失效`,
      );
    }
  }
});

test('ci-suite-contract: pipe 套件步骤排在 npm ci 之前（零依赖、失败更快）', () => {
  for (const name of ['ci.yml', 'release.yml']) {
    const text = fs.readFileSync(path.join(ROOT, '.github', 'workflows', name), 'utf8');
    const suiteAt = text.indexOf('run: node --test');
    const npmCiAt = text.indexOf('run: npm ci');
    assert.ok(suiteAt > 0, `${name} 未找到 pipe 套件步骤`);
    assert.ok(npmCiAt > 0, `${name} 未找到 npm ci 步骤`);
    assert.ok(suiteAt < npmCiAt, `${name}: pipe 套件应排在 npm ci 之前`);
  }
});
