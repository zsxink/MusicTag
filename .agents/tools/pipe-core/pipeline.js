'use strict';
// 流水线节点定义数据（数据驱动 DAG，取代旧脚本硬编码 phases）。
// 核心消费这些定义调度执行；buildPipeline(state) 按 architect 判定的 domain 动态展开
// 开发节点（自适应编排 D3），tester/CR/verify/integrate 的依赖随开发节点动态链接。

const crPrompt = require('./cr-prompt.js');

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
  // 4.3 分层测试去重：Dev 只跑受影响模块的相关测试 + 必要类型检查，不重复
  // Verify 会在最终 HEAD 上执行的完整本地基线（cargo/npm 全量归 Verify）。
  const selfCheck = CODE_DOMAINS.includes(domain)
    ? '只跑受影响模块/文件的相关测试（Rust 侧 `cargo test --manifest-path src-tauri/Cargo.toml` 定位到改动模块、前端 `npm run test` 定位到相关 case）与必要类型检查（`cargo check` / `npm run build`），不重复 Verify 的完整本地基线；任一失败不得提交。'
    : domain === 'infra'
      ? '跑对应域 scoped 验证：受影响测试文件的 `node --test`（如 cr-prompt 相关则含 cr-prompt.test.js）+ `run.js --self-check`（如相关）+ openspec validate，不重复 Verify 的完整本地基线；任一失败不得提交。'
      : '跑 openspec validate + 文档一致性审计（受影响文档的静态自检），不重复 Verify 的完整本地基线；任一失败不得提交。';
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
  // docs / spec / infra：leader 流程维护角色，不派 rust-backend/vue-frontend。
  // infra 变更（改动编排设施自身）工作量大，单节点长会话在 agent driver 下不可靠，
  // 拆成串行子节点：dev（任务组 4 动态 CR）→ dev-metrics（任务组 7 可观测）→ dev-docs（任务组 8 文档）。
  // docs/spec 仍保持一个 dev 节点（工作量小，单会话即可）。
  if (domain === 'infra') {
    const leaderScope = (scope) => ['.agents/tools/pipe-core/', '.agents/tools/pipe-core/test/', 'tests/workflow-core/', ...scope];
    return [
      {
        ...base,
        id: 'dev',
        role: 'leader',
        writeScopes: leaderScope(['.claude/']),
        prompt: (ctx) => `你是流水线 Leader（流程维护）。你是 infra 域开发，只负责「任务组 4：动态 CR 与测试分层」——` +
          `用当前 change 的 specs/design、Tester 结果、HEAD、diff stat 生成 CR prompt，删除固定「191 个测试」等历史结论；` +
          `${devSpec(change, domain)}\n只碰 .agents/、.claude/、tests/workflow-core/ 下资产，不碰 src/、src-tauri/。`,
      },
      {
        ...base,
        id: 'dev-metrics',
        role: 'leader',
        dependsOn: ['dev'],
        writeScopes: leaderScope([]),
        prompt: (ctx) => `你是流水线 Leader（流程维护）。你是 infra 域开发，只负责「任务组 7：可观测性与端到端验收」——` +
          `汇总 node/attempt/driver/model/command/commit/cache/CI/人工介入事件，输出总耗时、分类耗时、最慢三阶段及 PR/CI/merge 次数，建立 metrics 与 checkpoint 中断 resume 证据；` +
          `${devSpec(change, domain)}\n只碰 .agents/、tests/workflow-core/ 下资产，不碰 src/、src-tauri/。`,
      },
      {
        ...base,
        id: 'dev-docs',
        role: 'leader',
        dependsOn: ['dev-metrics'],
        writeScopes: ['.claude/', '.opencode/', 'AGENTS.md', 'docs/'],
        prompt: (ctx) => `你是流水线 Leader（流程维护）。你是 infra 域开发，只负责「任务组 8：全量验证与文档同步」——` +
          `更新 pipe skill、AGENTS 入口、角色说明和 workflow 注释以匹配新 DAG/权限/恢复语义，运行静态检查与全量门禁并核对 specs 验收标准证据；` +
          `${devSpec(change, domain)}\n只碰 .claude/、AGENTS.md、docs/ 下文档资产，不碰 src/、src-tauri/、核心代码。`,
      },
    ];
  }
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
        `以 scenario 清单驱动（4.3）：逐条对照 openspec/changes/${change}/specs/ 的 scenarios，每个 scenario 标注对应测试（covered 中写「scenario → 测试文件/用例」）；除 happy-path 外，强制审计失败路径与边界（错误分支、空/越界输入、并发/竞态、网络失败与错误码、状态复位）。\n` +
        `任何未覆盖 scenario（含失败路径）都必须列入 missing，且不得声称可进入 CR。\n` +
        `自验证只跑新增/受影响测试与核心链路冒烟，不重复 Verify 的完整本地基线。\n` +
        `测试或实现存在缺陷时如实返回 smokePassed=false。不得执行 git add 或 git commit；提交由 core 统一完成（core 审计 scoped 路径）。`,
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
      // 动态证据注入（4.1）：prompt 由当前 change 的 specs/design、Tester 结果、
      // HEAD、diff stat 和提交列表实时生成（cr-prompt.js），删除固定「191 个测试」
      // 等历史结论。ctx.state 由 core.js 在构造 task 时注入。
      prompt: (ctx) => crPrompt.buildCrPrompt({
        change,
        state: ctx && ctx.state,
        cwd: ctx && ctx.cwd,
        mainBranch: ctx && ctx.mainBranch,
      }),
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
