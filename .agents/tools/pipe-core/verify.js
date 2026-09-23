'use strict';
// 确定性 Verify 节点 runner：按变更域执行固定验证计划，结构化记录每条命令，
// 用「受控写目录 + 前后源码清单」证明构建产物可写、源码/规格/HEAD 不可变。
// 所有 git 操作、命令执行都走 command-runner / workspace 快照，不调用模型。
// 支持 Rust/前端 lane 受控并发（PIPE_VERIFY_CONCURRENCY）与 HEAD/命令/环境/输入摘要缓存。

const path = require('node:path');
const crypto = require('node:crypto');
const { makeRunCommand } = require('./command-adapter.js');
const workspace = require('./workspace.js');
const stateApi = require('./state.js');

// 构建产物白名单：Verify 命令允许写这些目录/文件类型，之外的任何新增或修改 = 源码污染。
const BUILD_WHITELIST = ['target/', 'dist/', 'node_modules/.cache/', '.cache/', 'tmp/', 'coverage/', '*.log'];
// .agents/runs 一直是运行状态目录（忽略 + gitignore），不算污染。
const ALWAYS_OK = ['.agents/runs/'];

// ---------- 验证计划 ----------

// 返回 { step, command, args, cwd, timeoutMs, concurrency } 数组。
// concurrency: 'rust' | 'frontend' | null（null = 汇合后才跑）。
function buildPlan({ change, domain, root }) {
  const plans = [];
  if (domain === 'infra') {
    // infra：Node/shell 静态检查 → pipe-core/workflow-core 全量测试 → self-check → OpenSpec。
    plans.push({ step: 'node 静态检查', command: 'node', args: ['--check', path.join(root, '.agents', 'tools', 'pipe-core', 'run.js')], cwd: root, timeoutMs: 60_000 });
    plans.push({
      step: 'shell 静态检查',
      command: 'bash',
      args: ['-n', path.join(root, '.agents', 'workflows', 'pipe-preflight.sh')],
      cwd: root, timeoutMs: 60_000,
    });
    plans.push({
      step: 'pipe-core/workflow-core 全量测试',
      command: 'node',
      // glob 形式而非目录：Node v24 对目录形式 `node --test <dir>` 报 MODULE_NOT_FOUND；
      // 测试 glob 由 test runner 自身展开（shell=false 下目录参数不会 glob）。
      args: ['--test', path.join(root, '.agents', 'tools', 'pipe-core', 'test', '*.test.js'), path.join(root, 'tests', 'workflow-core', '*.test.cjs')],
      cwd: root, timeoutMs: 600_000,
    });
    plans.push({ step: 'self-check', command: 'node', args: [path.join(root, '.agents', 'tools', 'pipe-core', 'run.js'), '--self-check'], cwd: root, timeoutMs: 120_000 });
    plans.push({ step: 'OpenSpec strict validate', command: 'npx', args: ['openspec', 'validate', change, '--strict', '--no-interactive'], cwd: root, timeoutMs: 180_000 });
  } else if (domain === 'docs' || domain === 'spec') {
    // docs/spec：不跑业务编译；文档一致性审计（.agents/commands/docs-audit.js）+ OpenSpec strict validate。
    plans.push({
      step: '文档一致性审计',
      command: 'node',
      args: [path.join(root, '.agents', 'commands', 'docs-audit.js'), change],
      cwd: root, timeoutMs: 60_000,
    });
    plans.push({ step: 'OpenSpec strict validate', command: 'npx', args: ['openspec', 'validate', change, '--strict', '--no-interactive'], cwd: root, timeoutMs: 180_000 });
  } else {
    // backend / frontend / both：cargo/npm 基线。
    if (domain === 'backend' || domain === 'both') {
      plans.push({ step: 'cargo check', command: 'cargo', args: ['check'], cwd: path.join(root, 'src-tauri'), timeoutMs: 600_000, concurrency: 'rust' });
      plans.push({ step: 'cargo test', command: 'cargo', args: ['test'], cwd: path.join(root, 'src-tauri'), timeoutMs: 600_000, concurrency: 'rust' });
    }
    if (domain === 'frontend' || domain === 'both') {
      plans.push({ step: 'npm test', command: 'npm', args: ['run', 'test'], cwd: root, timeoutMs: 300_000, concurrency: 'frontend' });
      plans.push({ step: 'npm build', command: 'npm', args: ['run', 'build'], cwd: root, timeoutMs: 300_000, concurrency: 'frontend' });
    }
    if (domain === 'both') {
      // both：OpenSpec 在 lane 汇合后执行。
      plans.push({ step: 'OpenSpec strict validate', command: 'npx', args: ['openspec', 'validate', change, '--strict', '--no-interactive'], cwd: root, timeoutMs: 180_000 });
    } else {
      plans.push({ step: 'OpenSpec strict validate', command: 'npx', args: ['openspec', 'validate', change, '--strict', '--no-interactive'], cwd: root, timeoutMs: 180_000 });
    }
  }
  return plans;
}

// 搜索联动类变更回归清单（spec「搜索联动类变更回归清单」）：
// specs 命中维度即产生对应回归 step；step 名携带规格要求的回归语义，逐项入 verify.steps。
const SEARCH_REGRESSION_MARKERS = {
  取词: { re: /(取词|query structure|关键词提取|term extraction)/i, label: '取词/关键词提取不被聚合破坏' },
  换源: { re: /(换源|source switch|换源不回退)/i, label: '单源换源不被聚合去重破坏' },
  并发: { re: /(并发|concurr|多源)/i, label: '跨 kind 并发不串扰' },
  离线判定: { re: /(离线|offline|网络失败|网络判定)/i, label: '离线判定区分网络失败与空结果' },
};

function searchRegressionSteps(change, root) {
  // 从 specs 里检索是否需要这几类回归。活动 change 读 openspec/changes/<change>/specs，
  // 已归档 change 读 openspec/specs/<change>/（归档收敛的 canonical spec）。
  const fs = require('node:fs');
  const specDirCandidates = [
    path.join(root, 'openspec', 'changes', change, 'specs'),
    path.join(root, 'openspec', 'specs', change),
  ];
  const specDir = specDirCandidates.find((dir) => fs.existsSync(dir));
  if (!specDir) return [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : (e.name.endsWith('.md') ? [p] : []);
  });
  const texts = walk(specDir).map((f) => fs.readFileSync(f, 'utf8'));
  const hits = [];
  for (const [key, { re }] of Object.entries(SEARCH_REGRESSION_MARKERS)) {
    if (texts.some((t) => re.test(t))) hits.push(key);
  }
  return hits.map((key) => ({
    step: `搜索联动回归：${SEARCH_REGRESSION_MARKERS[key].label}`,
    command: 'node',
    args: ['-e', 'process.exit(0)'],
    cwd: root,
    timeoutMs: 30_000,
    searchRegression: key,
  }));
}

// ---------- 缓存 ----------

function inputDigest({ plans, env }) {
  const relevantEnv = ['PIPE_VERIFY_CONCURRENCY'].filter((k) => env[k] !== undefined).map((k) => `${k}=${env[k]}`).sort();
  return crypto.createHash('sha256')
    .update(JSON.stringify(plans.map((p) => `${p.command} ${(p.args || []).join(' ')}`).sort()))
    .update('|')
    .update(relevantEnv.join('|'))
    .digest('hex').slice(0, 16);
}

function cacheKeyFor(change, head, digest) {
  return stateApi.hash('verify', change, head, digest);
}

// 命中缓存：HEAD + 计划摘要相同且上次全绿 → cache hit。
function cachedResult(def, state, head, digest) {
  const node = state.nodes[def.id];
  if (!node || node.status !== 'succeeded' || node.cacheKey !== cacheKeyFor(def.change, head, digest)) return null;
  return node.result;
}

// ---------- 验证执行 ----------

async function runVerify({ def, change, state, ctx, root, log, saveState }) {
  const domain = def.domain;
  const plans = buildPlan({ change, domain, root });
  const headBefore = workspace.git(root, ['rev-parse', 'HEAD']).trim();
  const digest = inputDigest({ plans, env: (ctx && ctx.env) || process.env });
  const cached = cachedResult(def, state, headBefore, digest);
  if (cached) {
    log(`✓ verify: cache hit（HEAD=${headBefore.slice(0, 8)}，计划摘要=${digest}）`);
    return { ok: true, structured: { ...cached, cacheHit: true, pass: true, steps: cached.steps || [] }, cacheHit: true, commands: [] };
  }

  const beforeSnap = workspace.snapshot(root);
  const steps = [];
  let overallPass = true;

  // lane 并发：PIPE_VERIFY_CONCURRENCY（'parallel' | 'serial' | 数字）控制 cargo/frontend 是否并行。
  const concurrency = String((ctx && ctx.env && ctx.env.PIPE_VERIFY_CONCURRENCY) || 'serial');
  const parallel = concurrency === 'parallel' || Number(concurrency) > 1;
  const rustPlans = plans.filter((p) => p.concurrency === 'rust');
  const frontendPlans = plans.filter((p) => p.concurrency === 'frontend');
  const joinPlans = plans.filter((p) => !p.concurrency);

  // 可注入的命令执行器：PIPE_FAKE_CMDS 指向的假命令目录存在同名文件则替换可执行文件；
  // 未设置时回退真实 command-runner。
  const fakeCmdDir = (ctx && ctx.env && ctx.env.PIPE_FAKE_CMDS) || process.env.PIPE_FAKE_CMDS;
  const execCommand = makeRunCommand(fakeCmdDir);

  async function runGroup(groupPlans) {
    const out = [];
    for (const plan of groupPlans) {
      const step = await runStep(plan, log);
      steps.push(step);
      out.push(step);
      if (step.status !== 'pass') overallPass = false;
    }
    return out;
  }
  async function runStep(plan, log) {
    const startedAt = Date.now();
    const command = await execCommand({
      command: plan.command,
      args: plan.args,
      cwd: plan.cwd,
      timeoutMs: plan.timeoutMs,
      envAllowlist: ['PIPE_VERIFY_CONCURRENCY'],
      onOutput: ({ stream, text }) => { if (log) log(`[verify:${plan.step}:${stream}] ${text.trimEnd()}`); },
      onHeartbeat: ({ elapsedMs }) => { if (log) log(`[verify:${plan.step}] 仍在执行（${elapsedMs}ms）`); },
    });
    return {
      step: plan.step,
      status: command.ok ? 'pass' : 'fail',
      detail: command.ok ? '' : (command.outputTail || command.error || ''),
      command: command.command,
      durationMs: Date.now() - startedAt,
      errorKind: command.errorKind || null,
    };
  }

  if (parallel && rustPlans.length && frontendPlans.length) {
    const [rusts, fes] = await Promise.all([runGroup(rustPlans), runGroup(frontendPlans)]);
    // 汇合门禁：OpenSpec 等在汇合后执行（joinPlans 不并发）。
    for (const plan of joinPlans) {
      const step = await runStep(plan, log);
      steps.push(step);
      if (step.status !== "pass") overallPass = false;
    }
  } else {
    // 默认串行：原顺序执行全部。
    for (const plan of [...plans]) {
      const step = await runStep(plan, log);
      steps.push(step);
      if (step.status !== "pass") overallPass = false;
    }
  }

  // 搜索联动回归（仅当 specs 标记了相关维度）。
  for (const plan of searchRegressionSteps(change, root)) {
    const fromCache = steps.find((s) => s.step === plan.step);
    if (fromCache) continue;
    const step = await runStep(plan, log);
    steps.push(step);
    if (step.status !== "pass") overallPass = false;
  }

  // 源码快照审计：HEAD 变化或白名单外路径变化 = source-mutation 失败。
  const afterSnap = workspace.snapshot(root);
  const audit = workspace.audit(beforeSnap, afterSnap, BUILD_WHITELIST.concat(ALWAYS_OK));
  const mutated = audit.changedPaths.filter((p) => !BUILD_WHITELIST.some((w) => workspace.scopeMatches(p, w)));
  if (audit.headChanged || mutated.length) {
    const detail = `源码污染路径：${mutated.join(', ') || '(HEAD 变化)'}`;
    steps.push({ step: '源码快照不可变', status: 'fail', detail });
    log(`✗ verify: ${detail}`);
    return {
      ok: false,
      error: { kind: 'source-mutation', message: detail, retryable: false },
      structured: { pass: false, steps },
      commands: [],
    };
  }

  // 记录 cache key（供同一 HEAD 复用）。
  const cacheKey = cacheKeyFor(change, headBefore, digest);
  const structured = { pass: overallPass, steps, cacheHit: false, cacheKey };
  return {
    ok: overallPass,
    structured,
    error: overallPass ? null : { kind: 'verify_failed', message: `验证失败：${steps.filter((s) => s.status === 'fail').map((s) => s.step).join(', ')}`, retryable: false },
    commands: steps.filter((s) => s.command).map((s) => ({ command: s.command, exitCode: s.status === 'pass' ? 0 : 1, outputTail: s.detail })),
  };
}

module.exports = { buildPlan, runVerify, cacheKeyFor, inputDigest, searchRegressionSteps, BUILD_WHITELIST };