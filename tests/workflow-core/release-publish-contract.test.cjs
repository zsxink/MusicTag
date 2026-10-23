'use strict';

// Structural contract for the release auto-publish chain (Issue #175, change
// release-auto-publish). Assertions run against the raw committed YAML — the
// pre-expansion text GitHub Actions consumes — plus README.md. Plain text and
// regex only: no YAML library, no third-party dependency, no network, and gh
// is never executed. End-to-end behavior (a real v* tag → auto publish → tap
// sync) can only be observed on a real release and is tracked as a rollout
// check, not here.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '../..');
const read = (...parts) => fs.readFileSync(path.join(REPO, ...parts), 'utf8').replaceAll('\r\n', '\n');

const releaseYml = read('.github', 'workflows', 'release.yml');
const homebrewYml = read('.github', 'workflows', 'homebrew.yml');
const ciYml = read('.github', 'workflows', 'ci.yml');
const readme = read('README.md');

// Extract the whole block of a 2-space-indented key (a `jobs:` entry): the
// heading line plus every following line that is blank or indented deeper,
// stopping before the next line at the heading's indent. Comments above the
// heading are excluded; comments inside the block are kept.
function blockOf(text, heading) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => heading.test(line));
  assert.ok(start !== -1, `block not found: ${heading}`);
  const baseIndent = lines[start].match(/^ */)[0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '') continue;
    if (lines[i].match(/^ */)[0].length <= baseIndent) { end = i; break; }
  }
  return lines.slice(start, end).join('\n');
}

// Needles must appear in haystack in this order (non-adjacent is fine).
function assertOrder(haystack, needles, label) {
  let previous = -1;
  for (const needle of needles) {
    const index = haystack.indexOf(needle);
    assert.ok(index > previous, `${label}: ${JSON.stringify(needle)} missing or out of order`);
    previous = index;
  }
}

const publishReleaseJob = () => blockOf(releaseYml, /^ {2}publish-release:\s*$/);
const publishTauriJob = () => blockOf(releaseYml, /^ {2}publish-tauri:\s*$/);

// Spec scenarios: 全部平台成功后自动发布 / 任一平台失败不发布（design D1）。
test('release publish contract: publish-release job exists with needs, timeout, and default success semantics', () => {
  const job = publishReleaseJob();
  assert.match(job, /^ {4}needs: publish-tauri[ \t]*$/m);
  assert.match(job, /^ {4}runs-on: ubuntu-latest[ \t]*$/m);
  assert.match(job, /^ {4}timeout-minutes: 10[ \t]*$/m);
  // 无 matrix（design D1）。默认 success 语义被钉住：job 级 if / always() /
  // failure() 会让“任一 matrix 条目失败也执行”，破坏「任一平台失败不发布」。
  assert.doesNotMatch(job, /^ {4}(if|strategy):/m);
  assert.doesNotMatch(job, /always\(\)|failure\(\)/);
});

// Canonical scenario: workflow 权限与配置正确（design D1）。
test('release publish contract: write permissions stay scoped to publish-release, top level stays read', () => {
  const job = publishReleaseJob();
  assert.match(job, /^ {4}permissions:[ \t]*$/m);
  assert.match(job, /^ {6}contents: write(?: +#.*)?[ \t]*$/m);
  assert.match(job, /^ {6}actions: write(?: +#.*)?[ \t]*$/m);
  // publish-tauri 保持仅 contents: write，不得借用 actions: write。
  const publishTauri = publishTauriJob();
  assert.match(publishTauri, /^ {4}permissions:[ \t]*$/m);
  assert.match(publishTauri, /^ {6}contents: write[ \t]*$/m);
  assert.doesNotMatch(publishTauri, /^ {6}actions: write[ \t]*$/m);
  // 两个 workflow 的顶层都保持 contents: read。
  assert.match(releaseYml, /^permissions:\n {2}contents: read(?: +#.*)?[ \t]*$/m);
  assert.match(homebrewYml, /^permissions:\n {2}contents: read(?: +#.*)?[ \t]*$/m);
});

// MODIFIED scenario: Release 草稿自动转正 —— 前半段（草稿先行承载资产）不得回退
// 为直接发布（design D5 拒绝 releaseDraft: false 的依据）。
test('release publish contract: publish-tauri keeps draft-first and the four matrix legs', () => {
  const job = publishTauriJob();
  assert.match(job, /^ {4}if: \$\{\{ startsWith\(github\.ref, 'refs\/tags\/v'\) \}\}[ \t]*$/m);
  assert.match(job, /^ {6}fail-fast: false[ \t]*$/m);
  assert.match(job, /^ {10}tagName: v__VERSION__[ \t]*$/m);
  assert.match(job, /^ {10}releaseDraft: true[ \t]*$/m);
  assert.match(job, /^ {10}prerelease: false[ \t]*$/m);
  const platforms = [...job.matchAll(/^ {10}- platform: (\S+)[ \t]*$/gm)].map((match) => match[1]);
  assert.deepEqual(platforms, ['windows-latest', 'macos-latest', 'macos-latest', 'ubuntu-22.04']);
  const args = [...job.matchAll(/^ {12}args: (.+)[ \t]*$/gm)].map((match) => match[1]);
  assert.deepEqual(args, ["''", "'--target aarch64-apple-darwin'", "'--target x86_64-apple-darwin'", "''"]);
});

// Spec scenarios: 全部平台成功后自动发布 / 重跑幂等（design D2）。
test('release publish contract: the publish step gates on isDraft, publishes with --draft=false, and retries three times', () => {
  const job = publishReleaseJob();
  // tag 只经 env 注入，run 块内一律 "$RELEASE_TAG" 引用（防注入，design D1）。
  assert.match(job, /^ {6}RELEASE_TAG: \$\{\{ github\.ref_name \}\}[ \t]*$/m);
  // 重试形态与 scripts/homebrew-publish.sh 相同：3 次，2s/4s 退避。
  assert.match(job, /^ {12}for attempt in 1 2 3; do[ \t]*$/m);
  assert.match(job, /sleep "\$\(\(attempt \* 2\)\)"/);
  // 幂等闸：先 view --json isDraft，已非草稿则 no-op 退出 0；转正只走 --draft=false。
  assert.match(job, /retry gh release view "\$RELEASE_TAG" --json isDraft,tagName,isPrerelease/);
  assert.match(job, /jq -r '\.isDraft'/);
  assert.match(job, /already published; nothing to do\./);
  assert.match(job, /retry gh release edit "\$RELEASE_TAG" --draft=false/);
  // 最小变更：不传 --latest、不改 title/body/prerelease，也不碰 tauri-action 配置。
  assert.doesNotMatch(job, /--latest/);
  assert.doesNotMatch(job, /--draft=true/);
  assert.doesNotMatch(job, /releaseDraft/);
  // 重试耗尽的失败闭合：error 注解 + 退出码 1，Release 保留草稿态（人工兜底）。
  assert.match(job, /::error::Cannot read release metadata for \$RELEASE_TAG after 3 attempts; draft preserved\./);
  assert.match(job, /::error::Cannot publish \$RELEASE_TAG after 3 attempts; draft preserved\./);
  assertOrder(job, [
    'retry gh release view "$RELEASE_TAG" --json isDraft,tagName,isPrerelease',
    "jq -r '.isDraft'",
    'already published; nothing to do.',
    'exit 0',
    'retry gh release edit "$RELEASE_TAG" --draft=false',
  ], 'publish step order');
});

// Spec scenario: 自动发布触发 tap 同步（design D3，含 GITHUB_TOKEN 事件抑制注记）。
test('release publish contract: publish-release dispatches homebrew.yml with the tag after publishing', () => {
  const job = publishReleaseJob();
  assert.match(job, /gh workflow run homebrew\.yml -f tag="\$RELEASE_TAG"/);
  // dispatch 必须在转正成功之后：GITHUB_TOKEN 作出的 release: published 事件不会
  // 触发下游 workflow，显式 workflow_dispatch 是唯一联动通道。
  assertOrder(job, ['retry gh release edit "$RELEASE_TAG" --draft=false', 'gh workflow run homebrew.yml'], 'tap dispatch order');
  // 省略 --ref：gh 默认派发到仓库默认分支，与 homebrew.yml 的信任模型一致（design D3）。
  assert.doesNotMatch(job, /gh workflow run homebrew\.yml[^\n]*--ref/);
  // 不等待 tap 同步结果：tap 失败有自己的可见失败与既有重试路径。
  assert.doesNotMatch(job, /gh run (?:watch|list)/);
});

// Spec scenario: 自动发布触发 tap 同步 —— 其零改动前提：homebrew.yml 触发器接口
// （release: types: [published] + workflow_dispatch inputs.tag）保持原样。
test('release publish contract: homebrew.yml trigger interface stays intact for the dispatch contract', () => {
  assert.match(homebrewYml, /^ {2}release:[ \t]*$/m);
  assert.match(homebrewYml, /^ {4}types: \[published\][ \t]*$/m);
  const dispatch = blockOf(homebrewYml, /^ {2}workflow_dispatch:\s*$/);
  assert.match(dispatch, /^ {4}inputs:[ \t]*$/m);
  const inputs = [...dispatch.matchAll(/^ {6}([A-Za-z][\w-]*):\s*$/gm)].map((match) => match[1]);
  assert.ok(inputs.includes('tag'), `workflow_dispatch inputs must still declare tag: ${inputs.join(', ')}`);
  assert.match(dispatch, /^ {6}tag:[ \t]*$/m);
  assert.match(dispatch, /^ {8}required: true[ \t]*$/m);
  assert.match(dispatch, /^ {8}type: string[ \t]*$/m);
  // release.yml 派发的 -f 参数名必须命中 homebrew.yml 声明的输入，且只派发 tag。
  const payload = /gh workflow run homebrew\.yml((?: -f [\w-]+="[^"]*")+)/.exec(releaseYml);
  assert.ok(payload, 'release.yml must dispatch homebrew.yml with -f inputs');
  const names = [...payload[1].matchAll(/ -f ([\w-]+)=/g)].map((match) => match[1]);
  assert.deepEqual(names, ['tag']);
});

// Task 2.1 / design D4：常规路径自动化，人工动作降级为失败兜底说明。
test('release publish contract: README documents auto-publish as the regular path and keeps manual fallback', () => {
  const headingAt = readme.indexOf('### 维护者：Homebrew 发布');
  assert.ok(headingAt !== -1, 'README 维护者一节缺失');
  const rest = readme.slice(headingAt);
  const nextHeadingAt = rest.indexOf('\n## ');
  const section = nextHeadingAt === -1 ? rest : rest.slice(0, nextHeadingAt);
  // 常规路径：自动转正 + 自动触发 tap 同步，无需人工操作。
  assert.match(section, /release 工作流自动把该 draft 转为已发布/);
  assert.match(section, /自动触发 tap 同步/);
  assert.match(section, /常规路径无需任何人工操作/);
  // 失败兜底：自动发布不执行/自身失败时 draft 保留，可重跑或手动 publish。
  assert.match(section, /失败兜底/);
  assert.match(section, /Release 保留 draft/);
  assert.match(section, /手动 publish 该 draft/);
  // tap 同步失败路径与既有手动 dispatch 重试指引保留。
  assert.match(section, /已发布的 Release 和 DMG 不受影响/);
  assert.match(section, /手动运行 \*\*Homebrew Tap\*\* 工作流/);
  // 旧的「人工 publish 是常规路径」措辞不得回归；手动 publish 只能出现在失败兜底之后。
  assert.doesNotMatch(section, /确认两个 macOS DMG 已上传后/);
  assert.ok(section.indexOf('失败兜底') < section.indexOf('手动 publish'), '手动 publish 必须位于失败兜底说明内');
  // Secret 权限边界与资产命名保留（design D4）。
  assert.match(section, /HOMEBREW_TAP_TOKEN/);
  assert.match(section, /Contents: read and write/);
  assert.match(section, /MusicTag_<版本>_aarch64\.dmg/);
  assert.match(section, /MusicTag_<版本>_x64\.dmg/);
});

// Design 验证节：新测试落在 tests/workflow-core/ 由既有 glob 自动收集，无需改
// workflow 即进 CI（「与 ci.yml 门禁一致」）。第三处门禁（verify.js infra 计划）
// 与 CI 的同集一致性由 ci-suite-contract.test.js 钉住，这里不重复。
test('release publish contract: ci.yml and release.yml collect tests/workflow-core with an identical suite command', () => {
  const suiteLine = (text, name) => {
    const lines = text.split('\n').filter((line) => line.includes('node --test') && line.includes('tests/workflow-core/*.test.cjs'));
    assert.equal(lines.length, 1, `${name} must have exactly one pipe native suites step`);
    return lines[0].trim();
  };
  const ci = suiteLine(ciYml, 'ci.yml');
  const release = suiteLine(releaseYml, 'release.yml');
  assert.equal(ci, release, 'ci.yml 与 release.yml 的套件命令必须逐字一致');
  assert.match(ci, /'tests\/workflow-core\/\*\.test\.cjs'/);
  // 本文件必须落在该 glob 的收集范围内。
  assert.equal(path.dirname(__filename), path.join(REPO, 'tests', 'workflow-core'));
  assert.match(path.basename(__filename), /\.test\.cjs$/);
});

// 补充（task 3.2）：bash -n 无法直接校验 YAML 内嵌脚本，这里提取 run: | 块标量
// （按块标量缩进剥去前导 10 列）写入临时文件后交给 bash -n 做纯语法解析，不执行。
test('release publish contract: the publish-release run block parses as bash', () => {
  const lines = publishReleaseJob().split('\n');
  const runAt = lines.findIndex((line) => /^ {8}run: \|[ \t]*$/.test(line));
  assert.ok(runAt !== -1, 'publish-release run: | block not found');
  const scriptLines = [];
  for (let i = runAt + 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '') { scriptLines.push(''); continue; }
    if (lines[i].match(/^ */)[0].length <= 8) break;
    scriptLines.push(lines[i].slice(10));
  }
  const script = scriptLines.join('\n');
  assert.equal(scriptLines[0], 'set -euo pipefail', 'run block must fail closed from the first line');
  assert.match(script, /gh workflow run homebrew\.yml -f tag="\$RELEASE_TAG"/);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-publish-run-'));
  try {
    const file = path.join(root, 'publish-release-run.sh');
    fs.writeFileSync(file, script);
    const result = spawnSync('bash', ['-n', file], { encoding: 'utf8' });
    assert.equal(result.status, 0, `bash -n rejected the run block:\n${result.stderr}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
