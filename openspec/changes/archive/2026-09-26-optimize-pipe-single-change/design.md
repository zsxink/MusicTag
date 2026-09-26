## Context

当前 pipe-core 把所有阶段建模为 `driver.runAgent()` 节点；`pipeline.js` 中的 preflight、verify、integrate 虽只执行固定命令，仍通过 Leader/Verify Agent 间接完成。`core.js` 负责通用 DAG、schema 校验和决断链，`state.js` 使用 schema v2 只保存节点最终状态，四个集成 wrapper 各自执行单步副作用但缺少跨步骤 checkpoint。现有角色还要求 Dev/Tester 自行提交，CR prompt 注入固定的历史测试数量。

该变更必须在不破坏三类 driver、Epic worktree 隔离、旧 state resume 和现有质量门的前提下重构正在运行自己的编排器。实现采用兼容演进：先补纯模块和测试，再切换 DAG，最后删除旧 Agent 节点路径。规格见 `specs/workflow-core/spec.md`。

## Goals / Non-Goals

**Goals:**

- 让 deterministic 与 agent 两种节点共享同一 DAG 状态机、事件历史、错误分类和 resume 语义。
- 将命令、提交和 GitHub 副作用集中到可测试、可恢复的 core 模块。
- 允许验证产生构建文件，同时证明源码、规格与 HEAD 未变。
- 为每次 attempt、命令和集成 checkpoint 提供持久化证据与运行摘要。
- 保持旧 state、三端 driver、Epic worktree 和既有 wrapper 的兼容性。

**Non-Goals:**

- 不改变 MusicTag 产品代码、V1 行为或 Tauri command。
- 不取消 Tester、CR、OpenSpec、完整本地验证或 GitHub required checks。
- 不构建通用 CI 平台；runner 只服务当前 pipe-core 的确定性步骤。
- 不自动解决真正的 Git 冲突、需求歧义或产品决策。

## Change Domain and Validation Scope

- **Domain: `infra`**。
- 变更仅涉及 `.agents/tools/pipe-core/`、`.agents/commands/`、`.agents/workflows/`、角色提示词、流程测试与本 change 的 OpenSpec artifact；不修改 `src-tauri/`、`src/`、MusicTag 产品行为或 Tauri command 契约。
- 因此本变更不触发 cargo/npm 业务编译门禁。最终验证固定执行 Node/shell 静态检查、pipe-core 与 workflow-core 全量测试、`run.js --self-check` 和本 change 的 OpenSpec strict validate。
- `backend`、`frontend`、`both` 的验证计划仍需由新 Verify runner 支持并通过 fake fixture 验证，但那是编排器能力测试，不会把本变更判成业务代码域。

## Technical Design

### 模块边界

| 层 | 文件/目录 | 职责 | 不负责 |
|---|---|---|---|
| CLI 与装配 | `.agents/tools/pipe-core/run.js`、`pipeline.js` | 解析参数，构造节点定义，选择 driver，装配 runner/adapters | 不执行节点业务，不直接编排 GitHub 副作用 |
| DAG 状态机 | `core.js`、`dag.js`、`schema.js`、`decision.js` | 拓扑推进、executor 选择、schema 校验、dirty 传播、重试/挂起决断 | 不硬编码节点顺序，不直接拼 shell 命令 |
| 确定性执行基础 | 新增 `command-runner.js`、错误分类与工作区快照模块 | 异步命令、heartbeat、取消/超时、脱敏证据、HEAD/路径差异审计 | 不理解具体 driver 或产品代码 |
| 持久化 | `state.js` | state v3 迁移、attempt 追加、checkpoint、summary、原子写盘、落地事实复核 | 不执行外部副作用 |
| 确定性节点 | bootstrap/spec-gate runner、新增 `verify.js`、`integrate.js` | 固定检查、按域验证、集成 checkpoint 推进 | 不调用模型，不自由改变步骤顺序 |
| Agent 适配 | `drivers/`、`capability.js`、`roles/` | 三端 driver 契约、最小权限、动态 prompt 与结构化结果 | 不提交、不执行 verify/integrate |
| 中立命令 | `.agents/workflows/`、`.agents/commands/` | 可单测的 bootstrap/spec-gate 与 archive/PR/CI/merge 原子操作 | 不维护跨步骤状态机 |
| 测试 | `.agents/tools/pipe-core/test/`、`tests/workflow-core/` | 单元、契约、旧 state fixture、临时 git 仓库与 fake Git/GitHub 端到端验收 | 不依赖真实网络完成核心回归 |

所有新模块继续使用 CommonJS 与 Node 内建模块，保持 pipe-core 零运行时依赖。Git、OpenSpec、GitHub 操作均以 `command + argv` 或注入 adapter 表达，生产 adapter 调真实命令，测试 adapter 记录调用并返回确定性事实。

### 节点数据流与写入边界

```text
CLI/change/driver
  → bootstrap：基础事实与启动许可
  → architect：design/tasks + domain=infra
  → spec-gate：strict spec/preflight 证据
  → dev：实现差异 + scoped test 证据 → core 审计并提交
  → tester：scenario 覆盖 + 测试差异 → core 审计并提交
  → cr：当前 specs/design/tester/diff/SHA → 只读结论
  → verify：同一 HEAD 的按域命令证据 + 不可变性快照
  → integrate：逐 checkpoint 的本地/远端事实
  → state v3：attempt history + summary + 最终状态
```

| 阶段 | 允许写入 | 成功输出/下游依赖 |
|---|---|---|
| bootstrap | 仅运行状态/事件 | 分支、工作区、Issue、proposal/spec、driver/self-check 事实；architect 依赖 |
| architect | 当前 change 的 `design.md`、`tasks.md` 及运行状态 | domain 与设计产物；spec-gate 依赖 |
| spec-gate | 仅运行状态/事件 | 完整 preflight 与 OpenSpec strict 证据；所有开发节点依赖 |
| dev/tester/fix | 节点声明的 `writeScopes`；`.git` 仅 core 可写 | scoped tests、审计结果、core 生成的 commit SHA；后续节点依赖该 SHA |
| cr | 只读源码、规格、state 与 diff | 结构化 findings/pass；不得改变 HEAD 或工作区 |
| verify | `target/`、`dist/`、显式 cache/tmp 与运行状态 | 同一 HEAD 的完整验证 steps、cache 证据、前后快照 |
| integrate | 归档规格、git/远端状态、运行 checkpoint | archive commit、唯一 PR、required CI、merge 与远端核验事实 |

工作区快照以“节点启动前已有差异”为基线，只审计该节点新增/改变的路径；这样不会把 Architect 已批准的 design/tasks 写入误归属给 Dev。任何 Agent 改 HEAD、CR 写文件、或节点产生白名单外差异都 fail-closed，且 core 不自动清理用户文件。

### Requirement 覆盖

| Spec requirement | 设计支撑 | 任务 |
|---|---|---|
| 模型无关编排核心 | 决策 1–2，单状态机 + 双 executor | 2.1–2.3 |
| 节点状态机与断点续跑 | 决策 4，state v3 与落地事实校验 | 1.2、2.1、7.3 |
| 决断链 | 决策 5，确定性分类优先 | 1.3、4.2 |
| 中立工作流与确定性命令 | 模块边界、决策 2–3、8 | 1.1、2.2–2.3、5.2、6.1–6.5 |
| 统一验证基线 | 决策 7、10 | 4.3、5.1–5.3、8.2–8.3 |
| CR 复盘专项维度 | 决策 9 | 4.1–4.2 |
| 异步确定性命令执行器 | 决策 3 | 1.1 |
| Verify 构建可写且源码不可变 | 决策 7 | 5.1–5.3 |
| 幂等集成 checkpoint 状态机 | 决策 8 | 6.1–6.5、7.3 |
| Core 统一提交与文件范围审计 | 决策 6 | 3.1–3.3 |
| 分层测试去重 | 决策 7、10 | 4.3、5.2–5.3 |
| 逐 attempt 可观测性与运行摘要 | 决策 3–5、10 | 1.1–1.3、7.1、7.4 |
| 单变更无人值守验收 | 完整 DAG 与端到端 fixture | 7.2–7.4、8.2–8.3 |

### 实现依赖顺序

默认在当前单一 worktree 串行实施，任务组硬依赖为 `1 → 2 → 3 → 4 → 5 → 6 → 7 → 8`。不得因模块看似独立而让多个写入 Agent 并行修改同一 worktree；只有外层显式建立隔离 worktree 时才可并行。运行时的 Rust/前端 Verify lane 并行属于被实现能力，与本变更开发并行无关。

## Decisions

### 1. 节点定义增加 `kind`，执行适配保持单一状态机

`pipeline.js` 的节点显式声明 `kind: 'deterministic' | 'agent'`。Agent 节点保留 role/prompt/schema；确定性节点提供 runner 标识和结构化结果 schema。`core.js` 的 `runNode` 只选择 executor，成功、失败、缓存、dirty、决断和事件写入仍走同一套状态机。

选择这一方式而不是为确定性流程另写第二个 orchestrator，可避免两套 resume/错误处理语义。为兼容现有测试和外部自定义 defs，缺省 `kind` 暂按 `agent` 解释；self-check 要求内置节点全部显式声明。

### 2. DAG 分为 bootstrap、spec-gate 和集成前后的明确边界

内置顺序为：

```text
bootstrap(det) → architect(agent) → spec-gate(det)
→ dev(agent) → tester(agent) → cr(agent)
→ verify(det) → integrate(det/checkpoints)
```

bootstrap 只校验分支、工作区允许状态、Issue、已批准 proposal/spec、driver contract 与基础 self-check；architect 可完善 design/tasks；spec-gate 随后执行完整 preflight 与 OpenSpec strict 校验。开发节点依赖 spec-gate，不再直接依赖 architect。

相比在 bootstrap 前由外层会话制造占位 design/tasks，此结构消除了循环依赖；兼容期间现有 `.agents/workflows/pipe-preflight.sh` 拆成可复用的 bootstrap/spec-gate 检查或增加阶段参数，旧无参数调用保持原有完整检查。

### 3. 命令 runner 使用 `spawn` 事件流，不用同步 shell

新增 `command-runner.js`，以 `child_process.spawn(command, args, {cwd, env, shell:false})` 执行预定义命令。runner 逐块转发 stdout/stderr，保留有界尾部摘要，每 30 秒发 heartbeat，支持 AbortSignal/timeout，并在终止时清理进程组。命令定义使用 argv 数组，禁止拼接用户输入的 shell 字符串。

结构化结果包含命令显示值、cwd、开始/结束时间、durationMs、exitCode、signal、errorKind 与脱敏摘要。环境变量只透传白名单；名称匹配 token/key/secret/password 的值在事件和摘要中替换为 `[REDACTED]`。

选择 spawn 而不是 `execSync` 可避免阻塞心跳、输出缓冲上限和不可取消问题；不引入第三方依赖以保持 core 零运行时依赖。

### 4. state v3 使用 append-only attempts，checkpoint 单独可寻址

state schema 升级为 v3。每个节点保留兼容字段 `status/result/error/attempts/commitSha`，并新增 `history[]`；每个 attempt 记录 round、序号、executor、driver/model、时间、错误、decision、commands、commit 与 cache 信息。run 级增加 `summary` 和 `humanInterventions`。integrate 节点结果中包含 `checkpoints` 映射，每个 checkpoint 有状态、证据、时间和远端标识。

所有状态仍通过临时文件 rename 原子写入。v1/v2 加载时迁移到 v3：已有累计 attempts 保留，最终状态合成为 legacy history 事件，未知字段保留。事件量按摘要和输出上限控制；不额外引入数据库。

### 5. 确定性错误分类优先，Leader 只处理未知技术问题

新增统一 `classifyError`：driver 和 command runner 的标准 kind 映射为 permanent、transient、state-machine 或 unknown。auth/config/schema/permission 永不自动重试；timeout/network/protocol 受节点累计预算限制；branch-behind/no-checks-yet/already-merged 交 integrate checkpoint 自身处理；unknown 才进入 Leader 决断。

retry 预算以 state 中累计 attempt 数为准，resume 不重置。CLI 新增 `--force-retry <node>`，只对指定节点清除预算阻断但不删除历史。这样保留可审计性，也避免通过删除 state 隐式绕开上限。

### 6. Core 以快照差异执行文件所有权审计并统一提交

Agent 节点前记录 HEAD、tracked/untracked/ignored 的 porcelain 基线，节点后计算相对该基线的新增差异。pipeline 为 dev/tester/fix 节点声明 `writeScopes` 与确定性 commit message。Agent prompt 明确禁止 git 写入；core 检查 HEAD 未变、变更路径均落在 scopes、节点结果与测试证据合格后，只对本节点新增且获授权的路径使用 argv 形式执行 `git add -- <paths>` 和 `git commit`，不得顺带提交节点启动前已有差异。

如果 Agent 自行改变 HEAD 或修改越权文件，节点失败且不提交；CR 使用严格只读快照，architect 只允许当前 change 的 `design.md`/`tasks.md`，其写入由后续归档提交收敛而不得混入 Dev/Tester 提交。选择 core 提交而不是扩大 driver 的 `.git` 权限，可以让所有 runtime 行为一致，并让 commit SHA 成为可靠落地证据。

### 7. Verify 用“受控写目录 + 前后源码清单”实现不可变性

Verify 开始时记录 HEAD、tracked 文件状态和非白名单 untracked 清单。构建目录白名单来自命令定义（如 `target/`、`dist/`、已知 cache/tmp），命令使用 workspace-write 环境运行。结束后再次快照；HEAD 改变或白名单外状态变化即 `source-mutation` 失败。

infra 域依次运行 Node/shell 静态检查、pipe-core/workflow-core 测试、self-check 和 OpenSpec；业务代码域按 specs 中基线执行。domain=both 时 cargo lane 与 npm lane 可由 `PIPE_VERIFY_CONCURRENCY` 控制并行，默认保守串行；OpenSpec 在 lane 汇合后执行。验证缓存键包含 HEAD、命令 argv、相关环境和输入文件摘要。

### 8. Integrate 是单个确定性节点内的显式 checkpoint 状态机

新增 `integrate.js`，固定步骤为 archive、commit、sync-main、push、get-or-create-pr、wait-required-ci、merge、verify-remote、cleanup-local。每步先查询事实再决定执行，并在成功后立即保存 checkpoint：

- archive 查询活动/归档目录；commit 验证归档和 canonical spec 已进入提交。
- sync-main 在 push/CI 前 fetch 并检测/合并主线；冲突挂起。
- get-or-create-pr 按 head branch 查询 open/merged PR，已有即复用。
- wait-required-ci 只等待 required checks；已通过即复用。
- merge/verify-remote 以 GitHub PR 状态为权威；已 merged 直接成功。
- cleanup-local 是 best-effort，失败记 warning，不改变远端成功事实。

现有 archive/create-pr/wait-ci/merge-pr wrapper 继续作为底层命令入口，但要支持机器可读输出和查询复用；不能满足幂等性的逻辑上移到 integrate 模块。PR 创建前断言活动 change 目录消失且分支 diff 同时包含归档和 canonical spec 更新。

### 9. CR prompt 由运行时证据生成，角色只读约束保留

CR 节点 prompt builder 从当前 state 读取 proposal/spec/design 路径、Tester 结构化结果、HEAD、diff stat 和提交列表，不再嵌入固定测试数量。CR 获准只读执行 `git diff main...HEAD` 和打开关键文件；driver 沙箱及前后快照继续双重保证只读。三项复盘专项作为模板固定维度，但需基于当前变更判断适用性。

### 10. 测试分层和端到端 fixture

Dev 的自验证命令由变更域和受影响文件推导，只运行相关测试；Tester 负责 scenario 映射和新增/相关测试；Verify 才运行全量本地基线。新增 deterministic fake command/GitHub adapters，使 checkpoint、重试、branch-behind、already-merged、cleanup warning 和源码污染可在无网络测试中覆盖。

端到端 fixture 使用临时 git 仓库、fake driver 和 fake GitHub wrapper 模拟 domain=both 全链路，断言 deterministic 节点零 driver 调用、一个 PR/CI/merge、任意 checkpoint resume 幂等及完整汇总。35%/15 分钟目标通过基准事件或可控时钟记录，真实 GitHub CI 时长单独统计。

## Risks / Trade-offs

- [重构 core 同时依赖旧 core 启动，可能自举失败] → 先以兼容模块和测试落地，切换 DAG 前保持旧入口可运行；每阶段提交由 core 或主流程可恢复。
- [state v3 迁移错误会阻断历史 resume] → 保留 v1/v2 fixtures、未知字段和原文件备份式原子写入；迁移失败时 fail-closed 且不覆盖旧文件。
- [Git 文件范围审计可能误判生成文件] → 白名单必须窄且由测试覆盖；任何不确定路径默认视为污染并报告，不自动清理用户文件。
- [sync-main 可能引入冲突或额外 CI] → 在 PR/CI 前执行一次并落 checkpoint；冲突挂起交用户，不做自动冲突解决。
- [并行验证争抢本机资源] → 默认并发度 1，通过环境配置显式提升并记录在 cache key 和摘要中。
- [GitHub 测试依赖外部状态] → 核心状态机通过 fake adapter 全覆盖，真实 wrapper 只做最小 smoke；远端 API 失败分类为瞬态并受累计预算约束。

## Migration Plan

1. 先添加 command runner、错误分类、state v3 与兼容迁移测试，尚不改变现有 DAG。
2. 扩展 core/schema/self-check，加入双 executor、bootstrap/spec-gate 与新 DAG，但用兼容开关/fixture 保持旧入口可验证。
3. 加入工作区审计、core commit、动态 CR 与分层测试，收紧 Agent 权限和 prompt。
4. 添加 verify、integrate 模块及 fake adapters，按固定依赖顺序接入 DAG；用单元/fixture 覆盖副作用边界。
5. 更新 wrappers、skill/AGENTS/roles/workflow 注释，运行 pipe-core/workflow-core 全量回归与本变更 OpenSpec strict 校验。
6. 通过端到端 fixture 和真实分支集成验证后归档、创建唯一 PR 并合并。

回滚时可回退切换 DAG 的提交，v3 state 仍保留兼容字段；旧代码若无法读取 v3，使用迁移前分支和保存的 v2 fixture 恢复，不删除运行历史。
