# workflow-core Specification

## Purpose
TBD - created by archiving change workflow-core. Update Purpose after archive.

## Requirements

### Requirement: 模型无关编排核心
`.agents/tools/pipe-core/` SHALL 是模型无关的编排核心（纯 node、零运行时依赖）：消费「节点定义 + 依赖 + 状态」数据，按 DAG 拓扑执行节点，每个节点经 driver 调模型执行、校验 schema、写回节点级状态文件。核心不识别任何具体模型。技能/工具/运行态统一收敛到 `.agents/`（跨框架共享资产根），Claude 侧通过 symlink + 薄壳引用，不写两套、不维护两套。

#### Scenario: 核心不认识模型
- **WHEN** 执行一个包含 claude 与 codex 节点的 DAG
- **THEN** 核心对两类节点走同一调度逻辑，差异仅在 driver 层，核心无模型专属分支

#### Scenario: 节点定义驱动
- **WHEN** 节点定义为 `{ id, role, prompt, schema, dependsOn[], retry{max,interval}, maxRounds }`
- **THEN** 核心按该定义调度执行，不硬编码节点顺序

### Requirement: 节点状态机与断点续跑（P1）
核心 SHALL 为每个节点维护状态机 `pending → ready → running → succeeded | failed | suspended`，并将节点级状态落盘到 `.agents/runs/<change>/state.json`（每节点完成原子写盘；路径以**仓库根**锚定 `path.resolve(repoRoot, '.agents/runs/<change>/state.json')`，worktree 并行场景同写主仓库状态目录，不受子进程 `--cwd` 影响；仓库根判定 SHALL 优先读环境变量 `PIPE_CORE_REPO_ROOT`——主编排器派生 worktree 子进程时注入主仓库绝对路径，缺省回退 `git rev-parse --show-toplevel`）；状态文件 SHALL 含 `schemaVersion` 字段，演进期格式兼容迁移。续跑 SHALL 加载状态文件、计算就绪集（依赖满足且未成功且非 in-flight）、只重跑失败节点，已通过节点直接复用结果。

#### Scenario: 失败节点缓存失效
- **WHEN** 某节点失败
- **THEN** 该节点及所有依赖它的节点标记 dirty，续跑时强制真实重跑；已通过且未被污染的节点复用结果

#### Scenario: 落地校验
- **WHEN** 续跑加载状态文件
- **THEN** 对每个记录为 succeeded 的节点验证其记录的工作 commit SHA 仍存在（工作真落地），不信任节点自报 done

#### Scenario: 中断后续跑
- **WHEN** 工作流在某节点中途中断
- **THEN** 再次触发带 resume 的同一变更 → 从失败/中断节点续跑，不重跑已通过节点

### Requirement: 决断链（P2）
节点失败 SHALL 先通过 `runAgent` 调用 leader 决断节点（按 `DECISION_SCHEMA` 校验 `{ action: 'retry'|'reroute'|'escalate'|'abort', node, reason }`），而非直接调用静态规则或直接退出。`retry` 重置目标节点重跑（attempts+1）、`reroute` 重派对应开发角色、`escalate`/`abort` 挂起 run 退出 `suspended`。

#### Scenario: 自动归类
- **WHEN** CR/verify 失败且 leader 判定为可自动重试的技术问题
- **THEN** 决策 `retry`/`reroute` → 核心重跑对应节点，不中断工作流

#### Scenario: 上报用户
- **WHEN** leader 判定涉及产品方向/需求歧义/CR 三轮不过
- **THEN** 决策 `escalate`/`abort` → 写挂起报告（节点、失败原因、候选方案）、退出 `suspended`，交主会话决策

### Requirement: 涉及用户决策回主会话（总原则）
涉及用户（人）的决策 SHALL 一律回主会话解决：核心遇到需人拍板的情形（CR 三轮不过、验证反复不过、需求歧义、方向变化）写挂起报告、退出 `suspended`；主会话即「当前驱动 run.js 的会话」（Claude 或 Codex 皆可）；用户决策后再次触发带 resume 的同一变更即可续跑。核心与各角色 SHALL 不自动拍板、不自我扩张需求。

#### Scenario: 挂起回主会话
- **WHEN** 流水线遇到需用户决策的情形
- **THEN** run.js 退出 `suspended`，状态文件完整落盘，并在 `.agents/runs/<change>/suspension-report.json` 写入节点、失败原因、decision、problems 与 candidates，当前驱动它的会话作为主会话收到报告路径

#### Scenario: 用户决策后续跑
- **WHEN** 用户在主会话决策后再次触发带 resume 的同一变更
- **THEN** 核心读状态文件，从挂起节点续跑，不重跑已通过节点

#### Scenario: 不自我扩张
- **WHEN** 执行中角色遇到 PRD 之外的需求
- **THEN** 角色不自动实施，上报 leader 决断节点 → 需人确认则挂起回主会话

### Requirement: 自适应编排（P4）
Architect 判定的变更域 SHALL 扩展为 `['backend','frontend','both','docs','spec','infra']`。核心按 domain 自适应编排：`docs`/`spec` 跳过 Rust/Vue 开发与编译验证，只跑文档同步 + openspec validate + 轻量 CR；`infra` 跳过业务编译，跑脚本静态自检（`node --check`/`--self-check`）+ openspec validate + 轻量 CR；`backend`/`frontend`/`both` 走既有开发与统一验证基线。

#### Scenario: 文档变更不触发编译
- **WHEN** 变更域为 `docs`/`spec`
- **THEN** 核心不派 Rust-Dev/Vue-Dev、不跑 cargo/npm 编译验证；只跑文档同步 + openspec validate + 轻量 CR（审文档一致性）

#### Scenario: infra 变更静态自检
- **WHEN** 变更域为 `infra`
- **THEN** 核心跑 `node --check` + `--self-check`（校验角色/节点定义）+ openspec validate + 轻量 CR，不跑业务编译

#### Scenario: 代码变更走既有基线
- **WHEN** 变更域为 `backend`/`frontend`/`both`
- **THEN** 核心按既有逻辑派开发角色（both 为 Rust→Vue 串行）并跑统一验证基线

### Requirement: 子变更并行（P3）
`/pipe:epic` SHALL 按 `epic.json` 的 `dependsOn` DAG 拓扑推进：每批推进无依赖就绪的子项，并行上限 ≤3。每个并行子项 SHALL 在独立 git worktree + 独立分支内跑完整 pipe 子流程，合并回 main 按依赖拓扑保证前置先合并。epic 并行状态（worktree 路径、批次、合并顺序）SHALL 写入 `.agents/runs/<epic>/epic-state.json`（版本控制外的运行态）；`.agents/runs/` 与 `.worktrees/` SHALL 加入 `.gitignore`。

#### Scenario: 就绪集并行
- **WHEN** 一批子项无依赖且未完成
- **THEN** 最多 3 个并行推进，各在独立 worktree + 分支

#### Scenario: 依赖保证顺序
- **WHEN** 子项 B `dependsOn` A
- **THEN** A 合回 main 后才合并 B，B 不在 A 之前合并

#### Scenario: worktree 隔离
- **WHEN** 两个并行子项各自写入
- **THEN** 各自在独立 worktree（独立分支），互不污染对方工作区

### Requirement: 跨模型 driver（P5）
核心 SHALL 通过统一 driver 接口 `runAgent(task, ctx) → DriverResult | Promise<DriverResult>` 调用 Agent runtime。Claude、Codex 与 OpenCode SHALL 各实现一个 driver，把「一个 agent 节点」翻译成对应 CLI 子进程命令 + 解析结构化输出。核心与任务定义 SHALL 不绑定任何模型或 Agent 产品。driver 实现位于 `.agents/tools/pipe-core/drivers/`，并通过 registry 注册；新增 driver 不得修改 core/pipeline/state。

#### Scenario: 模型切换
- **WHEN** 用 `--driver claude`、`--driver codex` 与 `--driver opencode` 分别执行同一变更
- **THEN** 核心调度逻辑一致，仅 driver 层翻译不同；角色文案（roles/ 单源）三端一致
- **AND** 某 runtime 未安装或未认证时，driver 显式返回配置/认证错误，不静默降级为其他 runtime；fake conformance test 仍为 CI 必跑

#### Scenario: 环境自动感知
- **WHEN** 未显式指定 `--driver`
- **THEN** registry 按当前环境自动选择（Claude 环境 → claude；Codex 环境 → codex；OpenCode 环境 → opencode；纯终端或多重匹配无法判断 → 要求显式指定）

#### Scenario: driver 失败上报
- **WHEN** 某 driver 因环境/认证缺失无法执行
- **THEN** 该节点失败并显式上报失败原因，不静默降级为其他模型

### Requirement: 角色单源
7 个流水线角色（leader/architect/rust-backend/vue-frontend/cr-agent/verify-agent/tester）的 system prompt SHALL 收敛到 `.agents/tools/pipe-core/roles/` 单一来源；公共 wrapper SHALL 组装 role prompt，各 driver 只翻译成对应 CLI 形态，不重复维护角色文案。角色权限 SHALL 使用产品无关 capability，不得在公共角色定义中把 Claude/Codex/OpenCode 工具名作为协议。

#### Scenario: 单源一致
- **WHEN** 修改某角色描述
- **THEN** 只改 `roles/` 一处，claude/codex/opencode 三个 driver 引用同一份，无第二份文案

### Requirement: Agent Runtime Adapter 契约（P6）
driver contract SHALL 版本化并统一输入、结果、错误分类、超时、终止和 capability 声明。所有 driver SHALL 返回标准 `DriverResult`；`runAgent(task, ctx)` SHALL 允许返回 `DriverResult` 或 `Promise<DriverResult>`，核心必须 await 两者；核心 SHALL 不解析宿主 stdout/event，也不得包含按 driverName 分支的角色注入逻辑。

#### Scenario: 新增 runtime 不改核心
- **WHEN** 新增一个满足 contract 的 driver
- **THEN** 仅注册 driver 和入口薄壳即可执行现有 pipeline，`core.js`、`pipeline.js`、`state.js` 无需修改

#### Scenario: 标准错误分类
- **WHEN** runtime 出现二进制缺失、认证失败、超时、协议错误或 schema 错误
- **THEN** driver 分别返回 `spawn/auth/timeout/protocol/schema` 标准错误，核心按统一决断链处理

#### Scenario: contract 版本不兼容
- **WHEN** driver `apiVersion` 与核心要求不兼容
- **THEN** preflight fail-closed，在任何写入节点前退出

### Requirement: OpenCode driver（P6）
OpenCode driver SHALL 使用官方非交互 CLI 执行节点，支持 cwd、model、agent 和 JSON 事件输出；SHALL 从 NDJSON 中提取最终 assistant 输出并由核心二次 schema 校验。它 SHALL 与 Claude/Codex 共享相同 role、state、DAG、decision 和 resume 语义。

#### Scenario: OpenCode 成功执行
- **WHEN** `opencode run --format json --dir <worktree>` 返回合法事件流和符合 schema 的最终 JSON envelope
- **THEN** driver 返回 `ok=true` 与 `structured`，核心按普通成功节点推进

#### Scenario: OpenCode 协议损坏
- **WHEN** 事件流无最终 assistant 消息、JSON 行损坏或最终内容不符合 schema
- **THEN** driver 返回 `protocol` 或 `schema` 错误，不把日志/中间消息误当结果

#### Scenario: OpenCode worktree 隔离
- **WHEN** epic 在三个独立 worktree 并发执行 OpenCode 子进程
- **THEN** 每个进程的 `--dir` 与节点 `cwd` 都指向对应 worktree，写入不得落到主工作区

#### Scenario: OpenCode 只读能力不足
- **WHEN** OpenCode 无法可靠施加 `read-only` 沙箱/工具策略
- **THEN** driver 在启动子进程前返回 `config` 错误，不以 prompt 或环境变量自我声明权限满足

### Requirement: 产品无关 capability（P6）
角色 SHALL 通过 `shell/read_files/write_files/search_files/git_read/git_write/network` 等 capability 表达最小权限；每个 driver SHALL 显式声明并映射宿主能力。无法满足所需能力或无法保持 read-only 约束时 SHALL fail-closed 或记录经批准的权限降级，不得静默提权。

#### Scenario: 只读 CR
- **WHEN** `cr-agent` 在任一 runtime 执行
- **THEN** driver 应用 read-only 沙箱和只读 capability；节点完成后若检测到工作区写入则节点失败

#### Scenario: 能力不足
- **WHEN** runtime 不支持角色所需的 `write_files` 或 `git_write`
- **THEN** 节点在启动前返回 `config` 错误，不以 prompt 自我声明代替权限保障

### Requirement: 中立工作流与确定性命令（P6）
核心 SHALL 只依赖 `.agents/workflows/` 与 `.agents/commands/` 下的中立可执行脚本，pipeline 节点 SHALL 不依赖 `/opsx:*`、`/pipe` 等宿主 UI 命令。Claude/OpenCode 的斜杠命令及 Codex 的 AGENTS 入口 SHALL 仅作为薄壳。

#### Scenario: preflight 路径中立
- **WHEN** 任一 driver 执行 preflight
- **THEN** 调用 `.agents/workflows/pipe-preflight.sh`，核心不读取 `.claude/workflows/` 中的实现

#### Scenario: 归档命令可执行
- **WHEN** integrate 节点归档变更
- **THEN** 调用确定性的 OpenSpec CLI 或 `.agents/commands/archive-change.js`，不要求 runtime 理解 `/opsx:archive`

#### Scenario: 集成命令确定性
- **WHEN** integrate 节点创建 PR、等待 CI 或合并
- **THEN** 依次调用 `.agents/commands/create-pr.js`、`wait-ci.js`、`merge-pr.js`，不在 prompt 中直接编排 `gh pr create`/`gh pr merge`/手动删除分支

#### Scenario: 三端入口同核
- **WHEN** 用户分别从 Claude Code、Codex、OpenCode 入口启动同一变更
- **THEN** 三个入口最终都执行同一 `run.js`，仅 `--driver` 值不同，退出码与状态文件语义一致

### Requirement: driver 一致性测试（P6）
每个 driver SHALL 通过共享 conformance suite，覆盖 cwd、role/schema 注入、结构化输出、错误分类、权限映射、超时终止、挂起/resume 和 epic worktree 隔离。fake runtime 测试 SHALL 为 CI 必跑；真实 CLI smoke SHALL 在二进制与认证存在时执行，否则明确 skip 并记录原因。

#### Scenario: 共享契约回归
- **WHEN** 修改 contract、角色能力或任一 driver
- **THEN** claude/codex/opencode 的共享 conformance suite 全部运行，防止只修一个 runtime

#### Scenario: infra 共享测试回归
- **WHEN** 变更域为 `infra`
- **THEN** verify SHALL 同时运行 `.agents/tools/pipe-core/test/*.test.js` 与 `tests/workflow-core/*.test.cjs`，并在 `steps` 中记录该合并命令

#### Scenario: 不可用 runtime 不伪绿
- **WHEN** 本机缺失某 CLI 或认证
- **THEN** 真实 smoke 明确标记 skip/不可用，不能以其他 driver 成功替代该 runtime 的验收

### Requirement: 流程脚本静态自检（沿用既有门禁）
`run.js` SHALL 提供 `--self-check`：校验角色定义、节点定义、全部已注册 driver 的 contract/capability 完整性。preflight SHALL 保留对 `.agents/workflows/` 流程脚本的静态自检——Node 脚本 `node --check`、shell 脚本 `bash -n`（`pipe-preflight.sh`/`pipe-epic-preflight.sh` 皆然），fail-closed：任一失败即 `ready=false` 阻止写入。

#### Scenario: 自检 fail-closed
- **WHEN** 角色/节点定义有缺失或不一致
- **THEN** `--self-check` 非零退出，preflight `ready=false`，不进入任何写入阶段

### Requirement: 命令与入口改造
`/pipe`、`/pipe:epic`、`/pipe:init`、`/pipe:epic:status` 命令 SHALL 改为薄壳转发 `node .agents/tools/pipe-core/run.js`（claude 侧默认 `--driver claude`）；pipe skill 物理唯一存放于 `.agents/skills/pipe/`（Codex 原生自动扫描 `.agents/skills/` 至 repo root），`.claude/skills/pipe` SHALL 为指向 `../../.agents/skills/pipe` 的 symlink（Claude 对 skills symlink 官方支持，git 存 symlink），两框架读到同一份；`.claude/workflows/pipe-preflight.sh`/`pipe-epic-preflight.sh` SHALL 同步新核心调用与语义；仓库根 `AGENTS.md` SHALL 初始化（项目约定 + pipe 入口触发方式，供 Codex 会话识别入口）；`.claude/CLAUDE.md` SHALL 移除对已删除 Workflow 脚本的引用、指向新核心；旧 Workflow 工具脚本 `.claude/workflows/music-tag-run.js`（纯顺序执行、无断点续跑、无决断链、domain 仅三值）SHALL 被删除、其流水线逻辑由核心的节点定义数据取代，删除前留档在归档 commit 可回溯。

#### Scenario: 入口薄壳
- **WHEN** 用户在 claude 输入 `/pipe <change>`
- **THEN** 命令转发 `node .agents/tools/pipe-core/run.js <change> --driver claude`，呈现核心输出

#### Scenario: codex 识别入口
- **WHEN** 用户在 codex 会话说「跑 pipe <change>」
- **THEN** 由根 `AGENTS.md` 项目约定识别入口，执行 `node .agents/tools/pipe-core/run.js <change> --driver codex`

#### Scenario: skill 双框架共享
- **WHEN** Claude 与 Codex 分别加载项目级 pipe skill
- **THEN** 两端都读到 `.agents/skills/pipe/SKILL.md` 同一份物理内容（Claude 经 `.claude/skills/pipe` symlink，Codex 经原生 `.agents/skills/` 扫描），无第二份副本

### Requirement: 统一验证基线（继承 workflow-optimize 既有门禁）
最终验证 SHALL 统一执行 `cargo check` → `cargo test` → `npm run test` → `npm run build` → `openspec validate <change> --strict --no-interactive`（代码域变更）；`docs`/`spec`/`infra` 域按自适应编排跳过 cargo/npm，改跑文档一致性审计或脚本静态自检 + openspec validate。任一失败即 `verify_failed`，只验证不修复。涉及搜索联动（取词/换源/并发/离线判定）的变更 SHALL 追加复盘回归清单（单源换源不被聚合去重破坏、跨 kind 不串扰、离线判定区分网络失败与空结果）并逐项入 `verify.steps`，缺失必选项即 `verify_failed`。（继承标注：该门禁源自已归档变更 `workflow-optimize`（2026-08-04），主规格 `openspec/specs/` 无对应 capability；本变更将其作为 `workflow-core` 规格基线继承，不挂主规格锚点，归档同样只归档 change 本体——与项目「流程类变更无主规格同步」惯例一致。）

#### Scenario: 代码域全基线
- **WHEN** 变更域为 `backend`/`frontend`/`both`
- **THEN** 依次执行五步，逐项返回 pass/fail，任一 fail 则 `verify_failed`

#### Scenario: 文档域跳编译
- **WHEN** 变更域为 `docs`/`spec`/`infra`
- **THEN** 跳过 cargo/npm，跑 openspec validate（infra 另跑脚本自检），不误报编译失败

#### Scenario: 搜索联动类变更回归清单
- **WHEN** 变更涉及搜索联动逻辑
- **THEN** 最终验证在五步基线之外逐项执行复盘回归清单（单源换源/跨 kind 串扰/离线判定），`verify.steps` 逐项可见，缺失必选项即 `verify_failed`

### Requirement: CR 复盘专项维度（继承 workflow-optimize 既有门禁）
CR 审查 SHALL 在一致性/遗漏/缺陷之外，保留复盘专项三检（跨模块状态语义 / 竞态与串扰 / 网络与离线判定）；阻断/major 每项含 file + issue + specReference + suggestion；`pass=true` 仅当无阻断且无 major。该门禁在新核心（leader 决断节点 + CR 节点）中原样保留。（继承标注：同「统一验证基线」——继承自已归档变更 `workflow-optimize`，作为 `workflow-core` 规格基线，不挂主规格锚点。）

#### Scenario: 复盘维度保留
- **WHEN** 新核心跑 CR 节点
- **THEN** CR prompt 与角色定义仍含复盘三检与问题分级证据要求，与既有 `workflow-optimize` 规格一致
