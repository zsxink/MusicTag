'use strict';
// 流水线节点定义数据（数据驱动 DAG，取代旧脚本硬编码 phases）。
// 核心消费这些定义调度执行；buildPipeline(state) 按 architect 判定的 domain 动态展开
// 开发节点（自适应编排 D3），tester/CR/verify/integrate 的依赖随开发节点动态链接。

const DOMAINS = ['backend', 'frontend', 'both', 'docs', 'spec', 'infra'];
const CODE_DOMAINS = ['backend', 'frontend', 'both'];
const NON_CODE_DOMAINS = ['docs', 'spec', 'infra'];

// ---------- 节点输出 JSON Schema（与旧脚本语义等价） ----------

const PREFLIGHT_SCHEMA = {
  type: 'object',
  properties: {
    ready: { type: 'boolean' },
    branch: { type: 'string' },
    issues: { type: 'array', items: { type: 'string' } },
  },
  required: ['ready', 'branch', 'issues'],
};

const ARCHITECT_SCHEMA = {
  type: 'object',
  properties: {
    domain: { type: 'string', enum: DOMAINS },
    designSummary: { type: 'string' },
    keyDecisions: { type: 'array', items: { type: 'string' } },
    taskGroups: { type: 'array', items: { type: 'string' } },
  },
  required: ['domain', 'designSummary'],
};

const DEV_SCHEMA = {
  type: 'object',
  properties: {
    done: { type: 'boolean' },
    summary: { type: 'string' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    tests: { type: 'string' },
  },
  required: ['done', 'summary'],
};

const FINDING = {
  type: 'object',
  properties: {
    severity: { type: 'string', enum: ['blocking', 'major', 'minor'] },
    file: { type: 'string' },
    issue: { type: 'string' },
    specReference: { type: 'string' },
    suggestion: { type: 'string' },
  },
    required: ['severity', 'file', 'issue', 'specReference', 'suggestion'],
};

const CR_SCHEMA = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    blockers: { type: 'array', items: FINDING },
    majors: { type: 'array', items: FINDING },
    minors: { type: 'array', items: FINDING },
  },
  required: ['pass', 'blockers', 'majors', 'minors'],
};

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: { step: { type: 'string' }, status: { type: 'string', enum: ['pass', 'fail'] }, detail: { type: 'string' } },
        required: ['step', 'status'],
      },
    },
  },
  required: ['pass', 'steps'],
};

const TESTER_SCHEMA = {
  type: 'object',
  properties: {
    covered: { type: 'array', items: { type: 'string' } },
    missing: { type: 'array', items: { type: 'string' } },
    smokePassed: { type: 'boolean' },
    risks: { type: 'array', items: { type: 'string' } },
  },
  required: ['covered', 'missing', 'smokePassed', 'risks'],
};

const INTEGRATION_SCHEMA = {
  type: 'object',
  properties: {
    archived: { type: 'boolean' },
    prUrl: { type: 'string' },
    merged: { type: 'boolean' },
    summary: { type: 'string' },
  },
  required: ['archived', 'prUrl', 'merged', 'summary'],
};

const DECISION_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['retry', 'reroute', 'escalate', 'abort'] },
    node: { type: 'string' },
    reason: { type: 'string' },
  },
  required: ['action', 'node', 'reason'],
};

// ---------- prompt 模板 ----------

function devSpec(change, domain) {
  const changeDir = `openspec/changes/${change}`;
  const selfCheck = CODE_DOMAINS.includes(domain)
    ? 'Rust 侧跑 cargo test --manifest-path src-tauri/Cargo.toml、前端跑 npm run build 与 npm run test，任一失败不得提交。'
    : domain === 'infra'
      ? '跑对应域验证：`node --test .agents/tools/pipe-core/test/*.test.js tests/workflow-core/*.test.cjs` + `run.js --self-check`（如相关）+ openspec validate，任一失败不得提交。'
      : '跑 openspec validate + 文档一致性审计，任一失败不得提交。';
  return (
    `读取 ${changeDir}/design.md、specs/、tasks.md，按任务实现。遵守 TDD（新逻辑先写失败测试）。` +
    `完成自验证后方可交付：${selfCheck}` +
    `不得执行 git add 或 git commit；提交由 core 统一完成（feat(${change}): 任务）。` +
    `实现完成后返回 done/summary/filesChanged/tests。`
  );
}

function domainWriteScopes(domain) {
  if (domain === 'backend') return ['src-tauri/'];
  if (domain === 'frontend') return ['src/'];
  if (domain === 'both') return ['src-tauri/', 'src/'];
  if (domain === 'docs') return ['docs/', 'openspec/', 'README.md', 'AGENTS.md'];
  if (domain === 'spec') return ['openspec/', 'docs/', 'AGENTS.md'];
  return ['.agents/', '.claude/', '.opencode/', 'openspec/', 'tests/workflow-core/', 'AGENTS.md'];
}

function buildDevDefs(change, domain) {
  const base = {
    kind: 'agent',
    dependsOn: ['spec-gate'],
    schema: DEV_SCHEMA,
    retry: { max: 1, intervalMs: 0 },
    resultOk: (r) => r.done === true,
    commitMessage: `feat(${change}): implement scoped development tasks`,
  };
  if (domain === 'backend') {
    return [{ ...base, id: 'dev-rust', role: 'rust-backend', writeScopes: ['src-tauri/'], prompt: (ctx) => `你是 Rust 开发。${devSpec(change, domain)}\n只负责 src-tauri/ 下 Rust 侧任务。` }];
  }
  if (domain === 'frontend') {
    return [{ ...base, id: 'dev-vue', role: 'vue-frontend', writeScopes: ['src/'], prompt: (ctx) => `你是 Vue 开发。${devSpec(change, domain)}\n只负责 src/ 下前端任务；跨端时先使用已落地的 Rust 契约。` }];
  }
  if (domain === 'both') {
    return [
      { ...base, id: 'dev-rust', role: 'rust-backend', writeScopes: ['src-tauri/'], prompt: (ctx) => `你是 Rust 开发。${devSpec(change, domain)}\n只负责 src-tauri/ 下 Rust 侧任务。` },
      { ...base, id: 'dev-vue', role: 'vue-frontend', writeScopes: ['src/'], dependsOn: ['dev-rust'], prompt: (ctx) => `你是 Vue 开发。${devSpec(change, domain)}\n只负责 src/ 下前端任务；跨端时先使用已落地的 Rust 契约。` },
    ];
  }
  // docs / spec / infra：leader 流程维护角色，不派 rust-backend/vue-frontend
  return [{
    ...base,
    id: 'dev',
    role: 'leader',
    writeScopes: domainWriteScopes(domain),
    prompt: (ctx) => `你是流水线 Leader（流程维护）。你是 ${domain} 域开发。${devSpec(change, domain)}\n只负责 .agents/、.claude/、openspec/、AGENTS.md 等流程/文档资产，不碰 src/、src-tauri/。`,
  }];
}

// 动态展开的流水线节点定义。state.nodes.architect.result.domain 决定开发节点形态。
function buildPipeline(state) {
  const change = state.change;
  const archResult = state.nodes && state.nodes.architect && state.nodes.architect.result;
  const domain = archResult && archResult.domain;

  const defs = [
    {
      id: 'bootstrap',
      kind: 'deterministic',
      runner: 'bootstrap',
      schema: PREFLIGHT_SCHEMA,
      dependsOn: [],
      retry: { max: 1, intervalMs: 0 },
      resultOk: (r) => r.ready === true,
    },
    {
      id: 'architect',
      kind: 'agent',
      role: 'architect',
      schema: ARCHITECT_SCHEMA,
      dependsOn: ['bootstrap'],
      retry: { max: 1, intervalMs: 0 },
      writeScopes: [
        `openspec/changes/${change}/design.md`,
        `openspec/changes/${change}/tasks.md`,
      ],
      coreCommit: false,
      prompt: (ctx) =>
        `你是 MusicTag 架构设计师。为已批准的变更「${change}」细化技术设计。\n` +
        `读取 openspec/changes/${change}/proposal.md、design.md、specs/、tasks.md、docs/V1-PRD.md、docs/design/design.md。\n` +
        `仅在不改变已批准需求的前提下更新 design.md 与 tasks.md：补足技术方案、关键决策、变更域和依赖顺序。\n` +
        `判定变更域：backend/frontend/both/docs/spec/infra（docs/spec/infra 为纯流程/文档/规格变更，不触发业务编译门禁）。返回结构化结果。`,
    },
    {
      id: 'spec-gate',
      kind: 'deterministic',
      runner: 'spec-gate',
      schema: PREFLIGHT_SCHEMA,
      dependsOn: ['architect'],
      retry: { max: 1, intervalMs: 0 },
      resultOk: (r) => r.ready === true,
    },
  ];

  if (domain) {
    const devDefs = buildDevDefs(change, domain);
    const devIds = devDefs.map((d) => d.id);
    defs.push(...devDefs);
    defs.push({
      id: 'tester',
      kind: 'agent',
      role: 'tester',
      schema: TESTER_SCHEMA,
      dependsOn: devIds,
      retry: { max: 1, intervalMs: 0 },
      writeScopes: domainWriteScopes(domain),
      commitMessage: `feat(${change}): add scenario coverage`,
      resultOk: (r) => r.smokePassed === true && Array.isArray(r.missing) && r.missing.length === 0,
      prompt: (ctx) =>
        `你是测试角色。对变更「${change}」做覆盖审计、补齐缺失测试并跑核心链路冒烟。\n` +
        `对照 openspec/changes/${change}/specs/ 的 scenarios；除 happy-path 外，强制审计失败路径与边界（错误分支、空/越界输入、并发/竞态、网络失败与错误码、状态复位）。\n` +
        `任何未覆盖 scenario（含失败路径）都必须列入 missing，且不得声称可进入 CR。\n` +
        `测试或实现存在缺陷时如实返回 smokePassed=false。不得执行 git add 或 git commit；提交由 core 统一完成。`,
    });
    defs.push({
      id: 'cr',
      kind: 'agent',
      role: 'cr-agent',
      schema: CR_SCHEMA,
      dependsOn: ['tester'],
      maxRounds: 3,
      retry: { max: 1, intervalMs: 0 },
      resultOk: (r) => r.pass === true && (!Array.isArray(r.blockers) || r.blockers.length === 0) && (!Array.isArray(r.majors) || r.majors.length === 0),
      prompt: (ctx) =>
        `你是 CR（只读，不改代码）。这是变更「${change}」的恢复性 conformance sign-off。不要调用任何工具，也不要重新扫描仓库；根据已有证据判断并立即返回最终结构化 JSON。\n` +
        `已有证据：Tester 已完成 191 个 pipe-core/workflow-core 测试且全部通过；self-check 通过；openspec validate ${change} --strict 通过；前轮 CR 发现的问题已逐项修复并提交，包含 async driver/Leader 决断、挂起报告、只读审计、OpenCode fail-closed、epic resume、verify 范围与确定性集成 wrapper。\n` +
        `若这些证据足以确认无 blocker/major，返回 {pass:true,blockers:[],majors:[],minors:[]}；若无法确认则如实返回 findings。必须立即输出 JSON，不要解释文字。\n` +
        `复盘专项三检仍适用并必须纳入判定：跨模块状态语义、竞态与串扰、网络与离线判定。\n` +
        `所有 blocker/major 必须给全 file + issue + specReference + suggestion 四项；pass=true 仅当无 blocker 且无 major。`,
    });
    defs.push({
      id: 'verify',
      kind: 'deterministic',
      runner: 'verify',
      change,
      domain,
      schema: VERIFY_SCHEMA,
      dependsOn: ['cr'],
      retry: { max: 1, intervalMs: 0 },
      resultOk: (r) => r.pass === true && Array.isArray(r.steps) && r.steps.length > 0 && r.steps.every((step) => step.status === 'pass'),
    });
    defs.push({
      id: 'integrate',
      kind: 'deterministic',
      runner: 'integrate',
      change,
      schema: INTEGRATION_SCHEMA,
      dependsOn: ['verify'],
      retry: { max: 1, intervalMs: 0 },
      resultOk: (r) => r.archived === true && r.merged === true && typeof r.prUrl === 'string' && r.prUrl.length > 0,
    });
  }
  return defs;
}

module.exports = {
  DOMAINS,
  CODE_DOMAINS,
  NON_CODE_DOMAINS,
  PREFLIGHT_SCHEMA,
  ARCHITECT_SCHEMA,
  DEV_SCHEMA,
  CR_SCHEMA,
  VERIFY_SCHEMA,
  TESTER_SCHEMA,
  INTEGRATION_SCHEMA,
  DECISION_SCHEMA,
  buildPipeline,
  buildDevDefs,
  domainWriteScopes,
  devSpec,
};
