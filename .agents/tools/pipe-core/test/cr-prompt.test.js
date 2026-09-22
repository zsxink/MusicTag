'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');
const crPrompt = require('../cr-prompt.js');
const pipeline = require('../pipeline.js');

// 构造一个临时 git 仓库：main 分支 + change 分支带 WIP 提交，模拟当前变更的证据源。
function tmpChangeRepo(change) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-cr-'));
  execSync('git init -q -b main', { cwd: dir });
  execSync('git config user.email t@t && git config user.name t', { cwd: dir });
  fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed');
  // 预置 spec 资产，模拟已批准 change 的 specs/design/tasks。
  fs.mkdirSync(path.join(dir, 'openspec', 'changes', change, 'specs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'openspec', 'changes', change, 'proposal.md'), '# p');
  fs.writeFileSync(path.join(dir, 'openspec', 'changes', change, 'design.md'), '# d');
  fs.writeFileSync(path.join(dir, 'openspec', 'changes', change, 'tasks.md'), '- [ ] t');
  fs.writeFileSync(path.join(dir, 'openspec', 'changes', change, 'specs', 'spec.md'), '## Requirement\n');
  execSync('git add . && git commit -qm "chore: seed"', { cwd: dir });
  execSync(`git checkout -qb ${change}`, { cwd: dir });
  fs.writeFileSync(path.join(dir, 'src.txt'), 'impl');
  fs.writeFileSync(path.join(dir, 'openspec', 'changes', change, 'design.md'), '# d v2');
  execSync('git add . && git commit -qm "feat(demo): implement scoped"', { cwd: dir });
  return dir;
}

const TESTER_RESULT = {
  covered: ['scenario-covers-dynamic-cr', 'scenario-scoped-tests'],
  missing: [],
  smokePassed: true,
  risks: ['diff stat 仅在 main 存在时可用'],
};

function stateWith(change) {
  return {
    change,
    nodes: {
      architect: { status: 'succeeded', result: { domain: 'infra' } },
      tester: { status: 'succeeded', result: TESTER_RESULT },
    },
  };
}

test('4.1: CR prompt 只含当前 change 证据，含 specs 路径 / Tester 结果 / HEAD / diff stat / 提交列表', () => {
  const change = 'demo';
  const repo = tmpChangeRepo(change);
  try {
    const p = crPrompt.buildCrPrompt({ change, state: stateWith(change), cwd: repo, mainBranch: 'main' });
    // 只属于当前 change 的证据
    assert.match(p, /openspec\/changes\/demo\//);
    assert.match(p, /specs\/spec\.md/);
    assert.match(p, /Tester 结果/);
    assert.match(p, /covered: scenario-covers-dynamic-cr/);
    assert.match(p, /smokePassed: true/);
    assert.match(p, /HEAD：/);
    assert.match(p, /diff stat/);
    assert.match(p, /feat\(demo\): implement scoped/); // 提交列表
    // 不包含其他 change 的证据（prompt fixture 只含当前变更证据）
    assert.doesNotMatch(p, /other-change/);
    assert.doesNotMatch(p, /openspec\/changes\/other/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('4.1: 固定「191 个测试」等历史结论被删除', () => {
  const change = 'demo';
  const repo = tmpChangeRepo(change);
  try {
    const p = crPrompt.buildCrPrompt({ change, state: stateWith(change), cwd: repo, mainBranch: 'main' });
    assert.doesNotMatch(p, /191\s*个/);
    assert.doesNotMatch(p, /Tester 已完成/);
    assert.doesNotMatch(p, /前轮 CR 发现的问题已逐项修复/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('4.1: CR 获准定向只读 diff（git diff main...HEAD），边界含只读', () => {
  const change = 'demo';
  const repo = tmpChangeRepo(change);
  try {
    const p = crPrompt.buildCrPrompt({ change, state: stateWith(change), cwd: repo, mainBranch: 'main' });
    assert.match(p, /git diff main\.\.\.HEAD/);
    assert.match(p, /只读/);
    assert.doesNotMatch(p, /不需要读取源码|立即返回/); // 不再是恢复性 sign-off 的固定措辞
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('4.2: 三项复盘专项保留，含不适用标注；四要素门槛保留', () => {
  const p = crPrompt.buildCrPrompt({ change: 'demo', state: stateWith('demo'), cwd: '/tmp', mainBranch: 'main' });
  assert.match(p, /跨模块状态语义/);
  assert.match(p, /竞态与串扰/);
  assert.match(p, /网络与离线判定/);
  assert.match(p, /不适用/);
  assert.match(p, /specReference \+ suggestion/);
  assert.match(p, /pass=true.*仅当无阻断且无 major/);
});

test('4.2: 无 state / 无 cwd 时优雅降级（兼容 cr.prompt({})），仍保留三检与门槛', () => {
  const p = crPrompt.buildCrPrompt({}); // 无 change、无 state、无 cwd
  assert.match(p, /跨模块状态语义/);
  assert.match(p, /pass=true.*仅当无阻断且无 major/);
  assert.match(p, /specReference \+ suggestion/);
  assert.match(p, /只读/);
});

test('4.3: Tester 结果缺失时 prompt 标注 Tester 结果不可用，不注入固定结论', () => {
  const p = crPrompt.buildCrPrompt({ change: 'demo', state: { change: 'demo', nodes: {} }, cwd: '/tmp' });
  // 没有 tester result 时不应出现伪造的 covered/missing
  assert.doesNotMatch(p, /covered:/);
  assert.doesNotMatch(p, /191\s*个/);
});

test('4.1: diff stat / 提交列表有界截断且展示截断提示', () => {
  const change = 'demo';
  const repo = tmpChangeRepo(change);
  try {
    // 预先制造 >40 个新增文件的 diff stat（>40 行），验证截断提示可见。
    for (let i = 0; i < 45; i++) fs.writeFileSync(path.join(repo, `bulk${i}.txt`), `x${i}`);
    execSync('git add . && git commit -qm "feat(demo): bulk files"', { cwd: repo });
    const p = crPrompt.buildCrPrompt({ change, cwd: repo, mainBranch: 'main' });
    assert.ok(p.includes('已截断'), 'diff stat 超过上限应显示截断提示');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});