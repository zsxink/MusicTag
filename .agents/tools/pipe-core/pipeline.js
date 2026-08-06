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
  required: ['severity', 'file', 'issue'],
};

const CR_SCHEMA = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    blockers: { type: 'array', items: FINDING },
    majors: { type: 'array', items: FINDING },
    minors: { type: 'array', items: FINDING },
  },
  required: ['pass', 'blockers', 'majors'],
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
      ? '跑对应域验证：`node --test` 编排核心单测 + `run.js --self-check`（如相关）+ openspec validate，任一失败不得提交。'
      : '跑 openspec validate + 文档一致性审计，任一失败不得提交。';
  return (
    `读取 ${changeDir}/design.md、specs/、tasks.md，按任务实现。遵守 TDD（新逻辑先写失败测试）。` +
    `完成自验证后方可提交：${selfCheck}` +
    `增量提交 git add + commit（feat(${change}): 任务），阶段粒度、崩溃可恢复。` +
    `实现完成后返回 done/summary/filesChanged/tests。`
  );
}

function buildDevDefs(change, domain) {
  const base = { dependsOn: ['architect'], schema: DEV_SCHEMA, retry: { max: 1, intervalMs: 0 } };
  if (domain === 'backend') {
    return [{ ...base, id: 'dev-rust', role: 'rust-backend', prompt: (ctx) => `你是 Rust 开发。${devSpec(change, domain)}\n只负责 src-tauri/ 下 Rust 侧任务。` }];
  }
  if (domain === 'frontend') {
    return [{ ...base, id: 'dev-vue', role: 'vue-frontend', prompt: (ctx) => `你是 Vue 开发。${devSpec(change, domain)}\n只负责 src/ 下前端任务；跨端时先使用已落地的 Rust 契约。` }];
  }
  if (domain === 'both') {
    return [
      { ...base, id: 'dev-rust', role: 'rust-backend', prompt: (ctx) => `你是 Rust 开发。${devSpec(change, domain)}\n只负责 src-tauri/ 下 Rust 侧任务。` },
      { ...base, id: 'dev-vue', role: 'vue-frontend', dependsOn: ['dev-rust'], prompt: (ctx) => `你是 Vue 开发。${devSpec(change, domain)}\n只负责 src/ 下前端任务；跨端时先使用已落地的 Rust 契约。` },
    ];
  }
  // docs / spec / infra：leader 流程维护角色，不派 rust-backend/vue-frontend
  return [{
    ...base,
    id: 'dev',
    role: 'leader',
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
      id: 'preflight',
      role: 'leader',
      schema: PREFLIGHT_SCHEMA,
      dependsOn: [],
      retry: { max: 1, intervalMs: 0 },
      prompt: (ctx) =>
        `只读执行 ${ctx.preflightScript || '.claude/workflows/pipe-preflight.sh'} ${change}；不得以人工判断替代脚本。` +
        `脚本退出码非零时 ready=false，并逐项写入 issues；仅脚本成功且 branch=${change} 时 ready=true。`,
    },
    {
      id: 'architect',
      role: 'architect',
      schema: ARCHITECT_SCHEMA,
      dependsOn: ['preflight'],
      retry: { max: 1, intervalMs: 0 },
      prompt: (ctx) =>
        `你是 MusicTag 架构设计师。为已批准的变更「${change}」细化技术设计。\n` +
        `读取 openspec/changes/${change}/proposal.md、design.md、specs/、tasks.md、docs/V1-PRD.md、docs/design/design.md。\n` +
        `仅在不改变已批准需求的前提下更新 design.md 与 tasks.md：补足技术方案、关键决策、变更域和依赖顺序。\n` +
        `判定变更域：backend/frontend/both/docs/spec/infra（docs/spec/infra 为纯流程/文档/规格变更，不触发业务编译门禁）。返回结构化结果。`,
    },
  ];

  if (domain) {
    const devDefs = buildDevDefs(change, domain);
    const devIds = devDefs.map((d) => d.id);
    defs.push(...devDefs);
    defs.push({
      id: 'tester',
      role: 'tester',
      schema: TESTER_SCHEMA,
      dependsOn: devIds,
      retry: { max: 1, intervalMs: 0 },
      resultOk: (r) => r.smokePassed === true,
      prompt: (ctx) =>
        `你是测试角色。对变更「${change}」做覆盖审计、补齐缺失测试并跑核心链路冒烟。\n` +
        `对照 openspec/changes/${change}/specs/ 的 scenarios；除 happy-path 外，强制审计失败路径与边界（错误分支、空/越界输入、并发/竞态、网络失败与错误码、状态复位）。\n` +
        `任何未覆盖 scenario（含失败路径）都必须列入 missing，且不得声称可进入 CR。\n` +
        `测试或实现存在缺陷时如实返回 smokePassed=false。`,
    });
    defs.push({
      id: 'cr',
      role: 'cr-agent',
      schema: CR_SCHEMA,
      dependsOn: ['tester'],
      maxRounds: 3,
      retry: { max: 1, intervalMs: 0 },
      resultOk: (r) => r.pass === true,
      prompt: (ctx) =>
        `你是 CR（只读，不改代码）。审查变更「${change}」当前分支相对 main 的改动（git diff main...HEAD），\n` +
        `对照 openspec/changes/${change}/specs/、design.md、docs/V1-PRD.md、docs/design/design.md。\n` +
        `所有 blocker/major 必须给全 file + issue + specReference + suggestion 四项，pass=true 仅当无 blocker 且无 major。\n` +
        `除规格一致性/遗漏/缺陷外，追加复盘专项三检（按变更涉及面取舍，不适用标「不适用」）：\n` +
        `①跨模块状态语义：聚合/去重/折叠是否破坏单源换源、身份校验防同名不同歌（FR-8.8a）；\n` +
        `②竞态与串扰：共享计数器/请求序号/全局状态是否跨 kind/面板互相污染、在途结果被无关操作作废或卡死；\n` +
        `③网络与离线判定：网络失败（超时/HTTP 状态/业务错误码）与正常空结果是否区分、离线仅由全源网络失败触发。`,
    });
    defs.push({
      id: 'verify',
      role: 'verify-agent',
      schema: VERIFY_SCHEMA,
      dependsOn: ['cr'],
      retry: { max: 1, intervalMs: 0 },
      resultOk: (r) => r.pass === true,
      prompt: (ctx) => {
        if (NON_CODE_DOMAINS.includes(domain)) {
          return `你是验证(CI)角色。变更「${change}」域为 ${domain}，按自适应编排跳过业务编译（P4）：\n` +
            `按序短路运行：node --test .agents/tools/pipe-core/ → node .agents/tools/pipe-core/run.js --self-check → ` +
            `openspec validate ${change} --strict --no-interactive。任一 fail 即整体 verify_failed，只验证不修复，失败输出如实上报。\n` +
            `全部通过才 pass=true，并逐项返回 steps（step + status + detail）。`;
        }
        return `你是验证(CI)角色。对变更「${change}」运行完整最终验证，统一基线按序短路：\n` +
          `cargo check --manifest-path src-tauri/Cargo.toml → cargo test --manifest-path src-tauri/Cargo.toml → ` +
          `npm run test → npm run build → openspec validate ${change} --strict --no-interactive。\n` +
          `任一 fail 即整体 verify_failed，只验证不修复，失败输出如实上报。\n` +
          `若变更触及搜索取词/单源换源/并发/离线降级路径，追加复盘回归清单并逐项入 steps：\n` +
          `单源换源不被聚合去重破坏、歌词/封面跨 kind 不串扰（无永久搜索中）、离线判定区分全源网络失败 vs 正常空结果；\n` +
          `否则 steps 中注明「不适用」。全部通过才 pass=true，并逐项返回 steps（step + status + detail）。`;
      },
    });
    defs.push({
      id: 'integrate',
      role: 'leader',
      schema: INTEGRATION_SCHEMA,
      dependsOn: ['verify'],
      retry: { max: 1, intervalMs: 0 },
      prompt: (ctx) =>
        `你是流水线 Leader。变更「${change}」已通过验证，现在执行受控集成：\n` +
        `1. 归档：/opsx:archive ${change}（在分支上执行，规格改动随分支提交）\n` +
        `2. 提交 PR：git push -u origin ${change} → gh pr create --base main --head ${change} --title "feat(${change}): <变更摘要>" --body "Closes #<issue>"（Issue 号从 openspec/changes/${change}/proposal.md 的「关联 Issue」段取，若无则省略 Closes）\n` +
        `3. 等 CI required checks 通过 → gh pr merge ${change} --squash\n` +
        `4. git branch -d ${change} 清理分支\n` +
        `全部完成返回 archived=true、prUrl、merged=true、summary；任何一步失败返回 merged=false 并附失败原因。`,
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
  devSpec,
};
