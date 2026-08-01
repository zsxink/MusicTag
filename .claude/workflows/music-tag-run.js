export const meta = {
  name: 'music-tag-run',
  description: 'MusicTag 全自动开发流水线：架构设计→开发→CR(三轮打回)→验证→测试',
  phases: [
    { title: '架构设计', detail: 'Architect 产出/细化设计，判定变更域' },
    { title: '开发', detail: 'Rust/Vue 按域串行或并行实现' },
    { title: 'CR', detail: '只读审查，问题打回 Leader 重派' },
    { title: '验证', detail: 'cargo/npm/openspec 全绿判定' },
    { title: '测试', detail: '覆盖审计与冒烟' },
  ],
}

const CHANGE = args?.name
if (!CHANGE) throw new Error('缺少变更名参数 args.name')

const CHANGE_DIR = `openspec/changes/${CHANGE}`

const ARCHITECT_SCHEMA = {
  type: 'object',
  properties: {
    domain: { type: 'string', enum: ['backend', 'frontend', 'both'] },
    designSummary: { type: 'string' },
    keyDecisions: { type: 'array', items: { type: 'string' } },
    taskGroups: { type: 'array', items: { type: 'string' } },
  },
  required: ['domain', 'designSummary'],
}

const DEV_SCHEMA = {
  type: 'object',
  properties: {
    done: { type: 'boolean' },
    summary: { type: 'string' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    tests: { type: 'string' },
  },
  required: ['done', 'summary'],
}

const FINDING = {
  type: 'object',
  properties: {
    severity: { type: 'string', enum: ['blocking', 'major', 'minor'] },
    file: { type: 'string' },
    issue: { type: 'string' },
    specReference: { type: 'string' },
    suggestion: { type: 'string' },
  },
  required: ['severity', 'issue'],
}

const CR_SCHEMA = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    blockers: { type: 'array', items: FINDING },
    majors: { type: 'array', items: FINDING },
    minors: { type: 'array', items: FINDING },
  },
  required: ['pass', 'blockers', 'majors'],
}

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          step: { type: 'string' },
          status: { type: 'string', enum: ['pass', 'fail'] },
          detail: { type: 'string' },
        },
        required: ['step', 'status'],
      },
    },
  },
  required: ['pass'],
}

const TESTER_SCHEMA = {
  type: 'object',
  properties: {
    covered: { type: 'array', items: { type: 'string' } },
    missing: { type: 'array', items: { type: 'string' } },
    smokePassed: { type: 'boolean' },
    risks: { type: 'array', items: { type: 'string' } },
  },
  required: ['smokePassed'],
}

// ---------- ① 架构设计 ----------
phase('架构设计')
log(`架构设计：变更 ${CHANGE}`)
const architect = await agent(
  `你是 MusicTag 架构设计师。为变更「${CHANGE}」产出/细化技术设计。\n` +
    `1. 读取 ${CHANGE_DIR}/proposal.md 与 specs/、docs/V1-PRD.md、docs/design/design.md。\n` +
    `2. 更新 ${CHANGE_DIR}/design.md（技术方案、关键决策、变更域判断、任务分组建议）。\n` +
    `3. 判定变更域：纯后端(backend)/纯前端(frontend)/跨前后端(both)。\n` +
    `返回结构化结果：domain 为变更域，designSummary 简述设计要点，keyDecisions 列关键决策，taskGroups 列任务分组。`,
  { agentType: 'architect', schema: ARCHITECT_SCHEMA, phase: '架构设计', label: 'architect' }
)
if (!architect) return { status: 'failed', stage: 'architecture', error: 'Architect 未返回结果' }
const domain = architect.domain
log(`变更域判定：${domain}。设计要点：${architect.designSummary}`)

// ---------- ② 开发 ----------
phase('开发')
log(`开发阶段：${domain === 'both' ? 'Rust + Vue 并行' : domain === 'backend' ? '仅 Rust' : '仅 Vue'}`)

const devSpec =
  `读取 ${CHANGE_DIR}/design.md、specs/、tasks.md，按任务实现。遵守 TDD（新逻辑先写失败测试）。` +
  `Rust 侧跑 cargo test，前端改完跑 npm run build。增量提交 git add + commit（feat(${CHANGE}): 任务）。` +
  `实现完成后返回 done/summary/filesChanged/tests。`

let devResults
if (domain === 'both') {
  devResults = await parallel([
    () =>
      agent(`你是 Rust 开发（rust-backend）。${devSpec}\n只负责 src-tauri/ 下 Rust 侧任务。`, {
        agentType: 'rust-backend',
        schema: DEV_SCHEMA,
        phase: '开发',
        label: 'rust-dev',
      }),
    () =>
      agent(`你是 Vue 开发（vue-frontend）。${devSpec}\n只负责 src/ 下前端任务。`, {
        agentType: 'vue-frontend',
        schema: DEV_SCHEMA,
        phase: '开发',
        label: 'vue-dev',
      }),
  ])
} else {
  const devAgent = domain === 'backend' ? 'rust-backend' : 'vue-frontend'
  const scope = domain === 'backend' ? 'src-tauri/ 下 Rust 侧' : 'src/ 下前端'
  devResults = [
    await agent(`你是 ${domain === 'backend' ? 'Rust' : 'Vue'} 开发。${devSpec}\n负责 ${scope} 任务。`, {
      agentType: devAgent,
      schema: DEV_SCHEMA,
      phase: '开发',
      label: `${domain}-dev`,
    }),
  ]
}
devResults = devResults.filter(Boolean)
if (!devResults.length) return { status: 'failed', stage: 'dev', error: '开发角色未返回结果' }
log(`开发完成：${devResults.map((r) => r.summary).join(' | ')}`)

// ---------- ③ CR（只读，最多三轮） ----------
phase('CR')
log('CR 只读审查开始')
let crResult = null
let rounds = 0
let crPassed = false

const fixPromptFor = (agentType) =>
  agentType === 'rust-backend'
    ? `你是 Rust 开发。修复以下 CR 问题（只动 src-tauri/ 下代码），修完跑 cargo test：\n`
    : `你是 Vue 开发。修复以下 CR 问题（只动 src/ 下代码），修完跑 npm run build：\n`

while (rounds < 3) {
  rounds++
  log(`CR 第 ${rounds} 轮`)
  crResult = await agent(
    `你是 CR（只读，不改代码）。审查变更「${CHANGE}」当前分支相对 main 的改动（git diff main...HEAD），` +
      `对照 ${CHANGE_DIR}/specs/、design.md、docs/V1-PRD.md、docs/design/design.md。\n` +
      `审查维度：1.规格一致性 2.遗漏 3.缺陷（含与定稿约束冲突）。\n` +
      `返回 pass（是否通过）、blockers/majors/minors（按严重度列出问题，每条含 file、issue、specReference、suggestion）。无阻断无主要问题时 pass=true。`,
    { agentType: 'cr-agent', schema: CR_SCHEMA, phase: 'CR', label: `cr-round-${rounds}` }
  )
  if (!crResult) return { status: 'failed', stage: 'cr', error: `CR 第${rounds}轮未返回` }

  const hasBlocking = crResult.blockers && crResult.blockers.length > 0
  const hasMajor = crResult.majors && crResult.majors.length > 0
  crPassed = crResult.pass === true && !hasBlocking && !hasMajor

  if (crPassed) {
    log(`CR 第 ${rounds} 轮通过`)
    break
  }
  if (rounds >= 3) break

  log(`CR 第 ${rounds} 轮发现问题（blocking ${crResult.blockers.length} / major ${crResult.majors.length}），打回开发修复`)
  const problems = JSON.stringify([...(crResult.blockers || []), ...(crResult.majors || [])])
  const fixAgents = domain === 'both' ? ['rust-backend', 'vue-frontend'] : [domain === 'frontend' ? 'vue-frontend' : 'rust-backend']
  const fixes = await parallel(
    fixAgents.map((a) => () =>
      agent(fixPromptFor(a) + problems, { agentType: a, phase: 'CR', label: `${a}-fix-${rounds}` })
    )
  )
  if (!fixes.filter(Boolean).length) return { status: 'failed', stage: 'cr', error: `修复第${rounds}轮问题失败` }
}

if (!crPassed) {
  log('CR 三轮未通过，挂起')
  return {
    status: 'suspended',
    stage: 'cr',
    rounds,
    crResult,
    reason: 'CR 三轮未通过，挂起等待用户决策',
  }
}

// ---------- ④ 验证 ----------
phase('验证')
log('验证阶段')
const verify = await agent(
  `你是验证(CI)角色。对变更「${CHANGE}」运行完整验证：cargo check、cargo test、npm run build、openspec validate ${CHANGE}。\n` +
    `全部通过则 pass=true，否则 pass=false 并逐项列出 steps（step/status/detail）。只验证，不修复。`,
  { agentType: 'verify-agent', schema: VERIFY_SCHEMA, phase: '验证', label: 'verify' }
)
if (!verify) return { status: 'failed', stage: 'verify', error: 'Verify 未返回' }
if (!verify.pass) {
  log(`验证未通过：${JSON.stringify(verify.steps)}`)
  return { status: 'verify_failed', stage: 'verify', verify, reason: '验证存在失败项' }
}
log('验证通过')

// ---------- ⑤ 测试 ----------
phase('测试')
log('测试阶段')
const tester = await agent(
  `你是测试角色。对变更「${CHANGE}」做测试覆盖审计与冒烟：对照 ${CHANGE_DIR}/specs/ 的 scenarios 检查测试覆盖，补齐缺失测试，跑通核心链路冒烟。\n` +
    `返回 covered（已覆盖场景）、missing（缺失测试场景）、smokePassed（冒烟是否通过）、risks（风险项）。`,
  { agentType: 'tester', schema: TESTER_SCHEMA, phase: '测试', label: 'tester' }
)
if (!tester) return { status: 'failed', stage: 'test', error: 'Tester 未返回' }
if (!tester.smokePassed) {
  log(`冒烟未通过：${JSON.stringify(tester)}`)
  return { status: 'test_failed', stage: 'test', tester, reason: '冒烟验证未通过' }
}
log('测试通过')

log('流水线全部通过，可进入合并与归档')
return {
  status: 'success',
  change: CHANGE,
  domain,
  architect,
  dev: devResults,
  cr: { rounds, result: crResult },
  verify,
  tester,
}
