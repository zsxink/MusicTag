## ADDED Requirements

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
节点失败 SHALL 先路由到 leader 决断节点（按决策 schema `{ action: 'retry'|'reroute'|'escalate'|'abort', node, reason }`），而非直接退出。`retry` 重置目标节点重跑（attempts+1）、`reroute` 重派对应开发角色、`escalate`/`abort` 挂起 run 退出 `suspended`。

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
- **THEN** run.js 退出 `suspended`，状态文件完整落盘，当前驱动它的会话作为主会话收到挂起报告

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
核心 SHALL 通过统一 driver 接口 `runAgent({ role, prompt, schema, cwd, worktreePath, env }) → { ok, structured?, raw?, sessionId?, exitCode? }` 调用模型。Claude 与 Codex SHALL 各实现一个 driver，把「一个 agent 节点」翻译成对应 CLI 子进程命令 + 解析结构化输出。核心与任务定义 SHALL 不绑定任何模型。driver 实现位于 `.agents/tools/pipe-core/drivers/`（claude.js / codex.js），与核心同目录统一管理。

#### Scenario: 模型切换
- **WHEN** 用 `--driver claude` 与 `--driver codex` 分别执行同一变更
- **THEN** 核心调度逻辑一致，仅 driver 层翻译不同；角色文案（roles/ 单源）两边一致
- **AND** 若 codex 本机未配置 OpenAI 认证 → 以「claude driver 全绿 + codex driver 命令构造正确（单测断言）」为验收标准；codex driver 显式报「配置缺失」，不静默降级为其他模型

#### Scenario: 环境自动感知
- **WHEN** 未显式指定 `--driver`
- **THEN** 核心按当前环境自动选择（Claude 环境 → claude driver；Codex 环境 → codex driver；纯终端无法判断 → 要求显式指定）

#### Scenario: driver 失败上报
- **WHEN** 某 driver 因环境/认证缺失无法执行
- **THEN** 该节点失败并显式上报失败原因，不静默降级为其他模型

### Requirement: 角色单源
7 个流水线角色（leader/architect/rust-backend/vue-frontend/cr-agent/verify-agent/tester）的 system prompt SHALL 收敛到 `.agents/tools/pipe-core/roles/` 单一来源；claude driver 与 codex driver 各自翻译成对应 CLI 形态（claude 走 `--append-system-prompt` 注入 `roles/<role>.md` 同一份内容，不用 `--agent` 避免双份文案；codex 把 role content 拼进 exec prompt），不重复维护两份角色文案。

#### Scenario: 单源一致
- **WHEN** 修改某角色描述
- **THEN** 只改 `roles/` 一处，claude/codex 两个 driver 引用同一份，无第二份文案

### Requirement: 流程脚本静态自检（沿用既有门禁）
`run.js` SHALL 提供 `--self-check`：校验角色定义、节点定义、driver 契约完整性。preflight SHALL 保留对流程脚本的静态自检——Node 脚本 `node --check`、shell 脚本 `bash -n`（`pipe-preflight.sh`/`pipe-epic-preflight.sh` 皆然），fail-closed：任一失败即 `ready=false` 阻止写入。

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
