export const meta = {
  name: 'music-tag-run',
  description: 'MusicTag 全自动开发流水线：前置校验→架构设计→开发→测试→CR(三轮打回)→验证→集成(归档/PR/合并)',
  phases: [
    { title: '前置校验', detail: '分支、工作区与 OpenSpec artifacts 必须就绪' },
    { title: '架构设计', detail: 'Architect 细化已批准设计，判定变更域' },
    { title: '开发', detail: 'Rust/Vue 按依赖顺序实现' },
    { title: '测试', detail: '覆盖审计、补测试与冒烟' },
    { title: 'CR', detail: '只读审查，问题定向打回开发角色' },
    { title: '验证', detail: 'cargo/npm/openspec 全绿判定' },
    { title: '集成', detail: 'leader 执行归档/PR/等CI/合并/分支清理' },
  ],
}

const CHANGE = args?.name
if (!CHANGE) throw new Error('缺少变更名参数 args.name')

const CHANGE_DIR = `openspec/changes/${CHANGE}`

const PREFLIGHT_SCHEMA = {
  type: 'object',
  properties: {
    ready: { type: 'boolean' },
    branch: { type: 'string' },
    issues: { type: 'array', items: { type: 'string' } },
  },
  required: ['ready', 'branch', 'issues'],
}

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
  required: ['severity', 'file', 'issue'],
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
  required: ['pass', 'steps'],
}

const TESTER_SCHEMA = {
  type: 'object',
  properties: {
    covered: { type: 'array', items: { type: 'string' } },
    missing: { type: 'array', items: { type: 'string' } },
    smokePassed: { type: 'boolean' },
    risks: { type: 'array', items: { type: 'string' } },
  },
  required: ['covered', 'missing', 'smokePassed', 'risks'],
}

// ---------- ① 前置校验（任何写入前 fail-closed） ----------
phase('前置校验')
const preflight = await agent(
  `只读执行 .claude/workflows/pipe-preflight.sh ${CHANGE}；不得以人工判断替代脚本。` +
    `脚本退出码非零时 ready=false，并逐项写入 issues；仅脚本成功且 branch=${CHANGE} 时 ready=true。`,
  { agentType: 'architect', schema: PREFLIGHT_SCHEMA, phase: '前置校验', label: 'preflight' }
)
if (!preflight?.ready || preflight.branch !== CHANGE) {
  return { status: 'failed', stage: 'preflight', preflight, error: '前置校验未通过；禁止开始写入' }
}

// ---------- ② 架构设计 ----------
phase('架构设计')
log(`架构设计：变更 ${CHANGE}`)
const architect = await agent(
  `你是 MusicTag 架构设计师。为已批准的变更「${CHANGE}」细化技术设计。\n` +
    `读取 ${CHANGE_DIR}/proposal.md、design.md、specs/、tasks.md、docs/V1-PRD.md、docs/design/design.md。\n` +
    `仅在不改变已批准需求的前提下更新 design.md 与 tasks.md：补足技术方案、关键决策、变更域和依赖顺序。\n` +
    `判定变更域：backend/frontend/both。返回结构化结果。`,
  { agentType: 'architect', schema: ARCHITECT_SCHEMA, phase: '架构设计', label: 'architect' }
)
if (!architect) return { status: 'failed', stage: 'architecture', error: 'Architect 未返回结果' }
const domain = architect.domain
log(`变更域判定：${domain}。设计要点：${architect.designSummary}`)

// ---------- ③ 开发（同一分支上按依赖顺序，禁止并写） ----------
phase('开发')
const devSpec =
  `读取 ${CHANGE_DIR}/design.md、specs/、tasks.md，按任务实现。遵守 TDD（新逻辑先写失败测试）。` +
  `Rust 侧跑 cargo test --manifest-path src-tauri/Cargo.toml，前端改完跑 npm run build。增量提交 git add + commit（feat(${CHANGE}): 任务）。` +
  `实现完成后返回 done/summary/filesChanged/tests。`

const runDev = (agentType, scope) =>
  agent(`你是 ${agentType === 'rust-backend' ? 'Rust' : 'Vue'} 开发。${devSpec}\n只负责 ${scope}。`, {
    agentType,
    schema: DEV_SCHEMA,
    phase: '开发',
    label: `${agentType}-dev`,
  })

const devResults = []
if (domain === 'backend' || domain === 'both') devResults.push(await runDev('rust-backend', 'src-tauri/ 下 Rust 侧任务'))
if (domain === 'frontend' || domain === 'both') devResults.push(await runDev('vue-frontend', 'src/ 下前端任务；跨端时先使用已落地的 Rust 契约'))
if (!devResults.length || devResults.some((result) => !result?.done)) {
  return { status: 'failed', stage: 'dev', dev: devResults, error: '开发角色未完成任务' }
}
log(`开发完成：${devResults.map((result) => result.summary).join(' | ')}`)

// ---------- ④ 测试（允许补测试，必须在 CR/验证之前） ----------
phase('测试')
const tester = await agent(
  `你是测试角色。对变更「${CHANGE}」做覆盖审计、补齐缺失测试并跑核心链路冒烟。` +
    `对照 ${CHANGE_DIR}/specs/ 的 scenarios；任何未覆盖 scenario 都必须列入 missing，且不得声称可进入 CR。` +
    `测试或实现存在缺陷时如实返回 smokePassed=false。`,
  { agentType: 'tester', schema: TESTER_SCHEMA, phase: '测试', label: 'tester' }
)
if (!tester || !tester.smokePassed || tester.missing.length > 0) {
  return { status: 'test_failed', stage: 'test', tester, reason: '冒烟失败或仍有未覆盖场景' }
}

// ---------- ⑤ CR（只读，最多三轮；按文件所有权定向修复） ----------
phase('CR')
let crResult = null
let rounds = 0
let crPassed = false
const ownerFor = (finding) => {
  // CR 返回的 file 可能是绝对路径（/Users/.../MusicTag/src/...）或仓库相对路径（src/...）。
  // 不依赖 process.cwd()（workflow 脚本无 Node API），改为同时匹配两种形态：
  // 绝对路径按仓库根标记 `/MusicTag/` 切到相对形态后判断归属。
  const f = finding.file
  const seg = f.includes('/MusicTag/') ? f.slice(f.indexOf('/MusicTag/') + '/MusicTag/'.length) : f
  if (seg.startsWith('src-tauri/')) return 'rust-backend'
  if (seg.startsWith('src/')) return 'vue-frontend'
  return 'leader'
}

while (rounds < 3) {
  rounds++
  crResult = await agent(
    `你是 CR（只读，不改代码）。审查变更「${CHANGE}」当前分支相对 main 的改动（git diff main...HEAD），` +
      `对照 ${CHANGE_DIR}/specs/、design.md、docs/V1-PRD.md、docs/design/design.md。` +
      `所有 blocker/major 必须给全 file + issue + specReference + suggestion 四项，pass=true 仅当无 blocker 且无 major。` +
      `除规格一致性/遗漏/缺陷外，追加复盘专项三检（按变更涉及面取舍，不适用标「不适用」）：` +
      `①跨模块状态语义：聚合/去重/折叠是否破坏单源换源、身份校验防同名不同歌（FR-8.8a）；` +
      `②竞态与串扰：共享计数器/请求序号/全局状态是否跨 kind/面板互相污染、在途结果被无关操作作废或卡死；` +
      `③网络与离线判定：网络失败（超时/HTTP 状态/业务错误码）与正常空结果是否区分、离线仅由全源网络失败触发。`,
    { agentType: 'cr-agent', schema: CR_SCHEMA, phase: 'CR', label: `cr-round-${rounds}` }
  )
  if (!crResult) return { status: 'failed', stage: 'cr', error: `CR 第${rounds}轮未返回` }

  const problems = [...crResult.blockers, ...crResult.majors]
  crPassed = crResult.pass === true && problems.length === 0
  if (crPassed) break
  if (rounds >= 3) break

  const routes = new Map()
  for (const problem of problems) {
    const owner = ownerFor(problem)
    routes.set(owner, [...(routes.get(owner) || []), problem])
  }
  for (const [owner, ownerProblems] of routes) {
    const role = owner === 'rust-backend' ? 'Rust 开发' : owner === 'vue-frontend' ? 'Vue 开发' : 'Leader（工作流/规格维护）'
    const scope = owner === 'rust-backend' ? 'src-tauri/ 下代码' : owner === 'vue-frontend' ? 'src/ 下代码' : '配置、CI、OpenSpec artifacts 或工作流文档'
    const fix = await agent(
      `你是 ${role}。只修复 ${scope} 中以下 CR 问题，` +
        `不得修改其他范围；修复后运行受影响测试并返回 done=true：\n${JSON.stringify(ownerProblems)}`,
      { agentType: owner, schema: DEV_SCHEMA, phase: 'CR', label: `${owner}-fix-${rounds}` }
    )
    if (!fix?.done) return { status: 'failed', stage: 'cr', rounds, crResult, error: `${owner} 未完成 CR 修复` }
  }
}

if (!crPassed) {
  return { status: 'suspended', stage: 'cr', rounds, crResult, reason: 'CR 三轮未通过，挂起等待用户决策' }
}

// ---------- ⑥ 最终验证（Tester/CR 任何写入后重新执行） ----------
phase('验证')
const verify = await agent(
  `你是验证(CI)角色。对变更「${CHANGE}」运行完整最终验证：cargo check/test --manifest-path src-tauri/Cargo.toml、npm run build、openspec validate ${CHANGE}。` +
    `只验证，不修复；全部通过才 pass=true，并逐项返回 steps。`,
  { agentType: 'verify-agent', schema: VERIFY_SCHEMA, phase: '验证', label: 'verify' }
)
if (!verify?.pass || verify.steps.some((step) => step.status !== 'pass')) {
  return { status: 'verify_failed', stage: 'verify', verify, reason: '最终验证存在失败项' }
}

// ---------- ⑦ 集成（leader 执行归档/PR/等CI/合并/分支清理） ----------
phase('集成')
const INTEGRATION_SCHEMA = {
  type: 'object',
  properties: {
    archived: { type: 'boolean' },
    prUrl: { type: 'string' },
    merged: { type: 'boolean' },
    summary: { type: 'string' },
  },
  required: ['archived', 'prUrl', 'merged', 'summary'],
}
const integration = await agent(
  `你是流水线 Leader。变更「${CHANGE}」已通过验证，现在执行受控集成（按 pipe skill ⑤–⑦）：
1. 归档：/opsx:archive ${CHANGE}（在分支上执行，规格改动随分支提交）
2. 提交 PR：git push -u origin ${CHANGE} → gh pr create --base main --head ${CHANGE} --title "feat(${CHANGE}): <变更摘要>" --body "Closes #<issue>"（Issue 号从 openspec/changes/${CHANGE}/proposal.md 的「关联 Issue」段取，若无则省略 Closes）
3. 等 CI required checks 通过 → gh pr merge ${CHANGE} --squash
4. git branch -d ${CHANGE} 清理分支
全部完成返回 archived=true、prUrl、merged=true、summary；任何一步失败返回 merged=false 并附失败原因。`,
  { agentType: 'leader', schema: INTEGRATION_SCHEMA, phase: '集成', label: 'integrate' }
)
if (!integration?.merged) {
  return { status: 'integration_failed', stage: 'integrate', integration, reason: '集成（归档/PR/合并）未完成' }
}

return { status: 'success', change: CHANGE, domain, architect, dev: devResults, tester, cr: { rounds, result: crResult }, verify, integration }
