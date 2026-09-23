## MODIFIED Requirements

### Requirement: 模型无关编排核心
`.agents/tools/pipe-core/` SHALL 是模型无关的编排核心（纯 Node、零运行时依赖），消费节点定义、依赖与持久化状态并按 DAG 拓扑执行。节点 SHALL 显式声明为确定性 core 节点或 Agent 节点：bootstrap、spec-gate、verify、integrate 由 core 直接执行，architect、dev、tester、CR 及确需判断的决断节点才经 driver 调用模型。核心不得识别具体模型；技能、工具与运行态统一收敛到 `.agents/`。

#### Scenario: 确定性节点不调用模型
- **WHEN** 单变更 DAG 执行 bootstrap、spec-gate、verify 或 integrate
- **THEN** core 直接执行其确定性 runner，并且 driver 调用记录中不存在这些节点

#### Scenario: 核心不认识模型
- **WHEN** architect、dev、tester 或 CR 通过 claude、codex、opencode 任一 driver 执行
- **THEN** 核心使用同一调度和 schema 校验逻辑，差异仅位于 driver 层

#### Scenario: 节点定义驱动
- **WHEN** 节点定义包含 id、kind、依赖、runner 或 role、schema、retry 与 maxRounds
- **THEN** 核心按定义调度，不在执行器中硬编码节点顺序

### Requirement: 节点状态机与断点续跑（P1）
核心 SHALL 为每个节点维护 `pending → ready → running → succeeded | failed | suspended` 状态，并将版本化状态原子写入以仓库根锚定的 `.agents/runs/<change>/state.json`。状态 SHALL 保留逐 attempt 历史而非覆盖前次结果；resume SHALL 校验已成功节点的落地事实与输入指纹，只重跑失败、未完成或已被依赖污染的节点。旧 schema SHALL 可确定性迁移且不得丢失累计 attempts。

#### Scenario: 中断后续跑
- **WHEN** 工作流在任意 Agent 节点、确定性命令或 integrate checkpoint 后中断
- **THEN** `--resume` 从首个未完成步骤继续，不重复已通过且事实仍有效的步骤

#### Scenario: 失败节点缓存失效
- **WHEN** 某节点失败或其依赖输入发生变化
- **THEN** 该节点及其下游标记 dirty，未受污染的成功节点继续复用

#### Scenario: 落地校验
- **WHEN** state 记录节点 succeeded 但其 commit、归档结果、PR 或远端状态与实际不符
- **THEN** core 以本地或远端事实修正状态并从对应步骤恢复，不信任自报完成

#### Scenario: 旧状态迁移
- **WHEN** resume 加载旧 schema 的 state.json
- **THEN** core 保留原节点状态与累计 attempts 完成迁移，迁移结果原子落盘

### Requirement: 决断链（P2）
节点失败 SHALL 先由确定性错误分类器判定 error kind 与可恢复性。`auth/config/schema/permission` 等永久错误 SHALL 立即失败或挂起；`timeout/network/protocol` 等瞬态错误 SHALL 仅在累计预算内按退避策略重试；`branch-behind/no-checks-yet/already-merged` SHALL 由 integrate 状态机处理。只有无法分类且确需技术判断时才调用 leader 决断节点。所有 retry 预算 SHALL 跨 `--resume` 累计生效，超过预算只有显式 `--force-retry <node>` 才可继续。

#### Scenario: 永久错误 fail-fast
- **WHEN** 节点返回认证、配置、schema 或权限错误
- **THEN** core 不调用 Agent 猜测或重复执行该节点，并持久化可操作的失败或挂起原因

#### Scenario: 瞬态错误预算内重试
- **WHEN** 节点发生网络、超时或协议类瞬态错误且累计 attempts 未超过配置预算
- **THEN** core 按退避策略自动重试并记录每次 attempt

#### Scenario: 跨 resume 达到上限
- **WHEN** 节点累计 attempts 已达到预算后再次 `--resume`
- **THEN** core 拒绝隐式重试并提示使用显式 `--force-retry <node>` 或由用户决策

#### Scenario: 未分类问题进入决断
- **WHEN** 错误无法由规则分类且需要技术判断
- **THEN** leader 仅可返回 retry、reroute、escalate 或 abort，并将理由写入 attempt 事件

#### Scenario: 自动归类
- **WHEN** CR 或 Verify 失败且规则表或 leader 判定为可自动恢复的技术问题
- **THEN** core 在累计预算内执行 retry 或按文件所有权 reroute，不中断工作流

#### Scenario: 上报用户
- **WHEN** 问题涉及产品方向、需求歧义、CR 三轮不过或累计预算耗尽
- **THEN** core 写入挂起报告并退出 suspended，等待主会话中的用户决策

### Requirement: 中立工作流与确定性命令（P6）
核心 SHALL 只依赖 `.agents/workflows/` 与 `.agents/commands/` 下的中立模块，不依赖宿主 UI 命令。bootstrap、spec-gate、verify 与 integrate SHALL 由 core 直接调用可测试的确定性实现；driver 不得接管这些步骤或决定命令顺序。

#### Scenario: bootstrap 与 spec-gate 分离
- **WHEN** 新 change 启动
- **THEN** bootstrap 只检查分支、工作区、Issue、proposal/specs、driver 与基础 self-check，architect 完成 design/tasks 后 spec-gate 再执行完整 OpenSpec/preflight 校验

#### Scenario: preflight 路径中立
- **WHEN** 任一 driver 启动 change
- **THEN** core 只调用 `.agents/workflows/` 中的中立 bootstrap/spec-gate 实现，不读取宿主专属 workflow 实现

#### Scenario: verify 由 core 执行
- **WHEN** CR 通过并进入最终验证
- **THEN** core 命令 runner 按域执行验证并结构化记录每条命令，过程中不启动 verify Agent

#### Scenario: integrate 由 core 执行
- **WHEN** verify 通过并进入集成
- **THEN** core 按持久化 checkpoint 调用归档、提交、同步、PR、CI、合并与远端核验命令，不启动 Leader Agent 编排副作用

#### Scenario: 归档命令可执行
- **WHEN** integrate 执行 archive checkpoint
- **THEN** core 调用确定性的 OpenSpec CLI 或 `.agents/commands/archive-change.js`，不要求 runtime 理解宿主斜杠命令

#### Scenario: 集成命令确定性
- **WHEN** integrate 创建 PR、等待 CI 或合并
- **THEN** core 调用中立命令模块并按 checkpoint 固定顺序推进，不在 prompt 中自由编排 GitHub 副作用

#### Scenario: 三端入口同核
- **WHEN** 从 Claude、Codex 或 OpenCode 启动相同 change
- **THEN** 三个入口执行同一 core 与确定性 runner，仅 Agent 节点的 driver 不同

### Requirement: 统一验证基线（继承 workflow-optimize 既有门禁）
最终验证 SHALL 是同一 commit 上唯一一次本地完整基线。代码域按适用范围执行 cargo check、cargo test、npm test、npm build 与 OpenSpec strict validate；docs/spec/infra 域执行对应文档审计或脚本静态自检、pipe-core/workflow-core 全量测试与 OpenSpec validate。Rust 与前端 lane MAY 在资源允许时并行，但 OpenSpec 和汇总门禁 SHALL 在 lane 汇合后执行。任一步失败均为 verify_failed，Verify 只验证不修复。

#### Scenario: 代码域全基线
- **WHEN** domain 为 backend、frontend 或 both
- **THEN** core 在同一 HEAD 上执行适用的 cargo/npm/OpenSpec 基线且每项仅有一条最终验证记录

#### Scenario: 文档域跳编译
- **WHEN** domain 为 docs 或 spec
- **THEN** core 跳过 cargo/npm 业务编译，执行文档一致性审计和 OpenSpec strict validate

#### Scenario: infra 域完整基线
- **WHEN** domain 为 infra
- **THEN** core 执行 Node/shell 静态检查、pipe-core 与 workflow-core 全量测试、self-check 和 OpenSpec strict validate，不运行无关业务编译

#### Scenario: 并行 lane 汇合
- **WHEN** domain=both 且启用并行验证
- **THEN** Rust 与前端 lane 受配置并发度约束，二者全部成功后才运行汇总门禁

#### Scenario: 搜索联动类变更回归清单
- **WHEN** 变更涉及取词、换源、并发或离线判定
- **THEN** verify.steps 仍逐项记录单源换源、跨 kind 串扰与离线判定回归结果，缺失必选项即失败

### Requirement: CR 复盘专项维度（继承 workflow-optimize 既有门禁）
CR SHALL 仅使用当前 change 的真实 specs、design、Tester 结果、diff stat、commit SHA 与定向 `git diff main...HEAD` 作为证据，不得注入其他 change 的测试数量或固定结论。CR 保持源码只读，并检查一致性、遗漏、缺陷以及 Issue #46/#47 复盘专项三检；阻断或 major 问题必须包含 file、issue、specReference、suggestion，只有无阻断且无 major 时 `pass=true`。

#### Scenario: 动态证据注入
- **WHEN** CR 启动
- **THEN** prompt 中的 specs、diff、Tester 证据与 SHA 全部来自当前 change，且不出现硬编码的其他变更测试结论

#### Scenario: 定向真实审查
- **WHEN** CR 需要验证实现是否满足规格
- **THEN** CR 可只读打开当前 diff 与关键文件，并基于实际内容给出结论

#### Scenario: 复盘维度保留
- **WHEN** 变更涉及跨模块状态、竞态或网络语义
- **THEN** CR 分别审查跨模块状态语义、竞态串扰、网络与离线判定；不适用时显式标注不适用

## ADDED Requirements

### Requirement: 异步确定性命令执行器
核心 SHALL 提供统一异步命令执行器，支持 cwd、环境白名单、实时 stdout/stderr 转发、30–60 秒 heartbeat、超时、取消、退出码与错误分类。每次命令 SHALL 记录 command、startedAt、endedAt、durationMs、exitCode 与有界输出摘要，且不得把凭据写入状态或日志。

#### Scenario: 长命令持续可见
- **WHEN** 验证或 CI 等待超过 heartbeat 间隔
- **THEN** 运行日志定期输出仍在执行的节点、命令与已耗时，不被误判为卡死

#### Scenario: 超时终止
- **WHEN** 命令超过配置 timeout
- **THEN** runner 终止进程树、分类为 timeout，并持久化退出证据以供预算判断

#### Scenario: 敏感信息保护
- **WHEN** 命令环境或输出包含已知凭据字段
- **THEN** 状态与摘要中保存脱敏值，不落盘原始 secret

### Requirement: Verify 构建可写且源码不可变
Verify SHALL 允许工具写入 target、dist、缓存和临时目录，同时通过验证前后的 HEAD 与 git 状态快照保证源码、规格和提交不变。白名单外任何新增或修改均 SHALL 使验证失败并列出污染路径。

#### Scenario: 正常构建产物
- **WHEN** cargo、Vite 或测试框架只写白名单构建目录
- **THEN** Verify 正常完成且不因 read-only 沙箱误报权限失败

#### Scenario: 源码被修改
- **WHEN** 验证命令修改源码、规格、tracked fixture 或 HEAD
- **THEN** Verify 失败并报告精确路径与前后快照差异

### Requirement: 幂等集成 checkpoint 状态机
Integrate SHALL 按 `archive → commit → sync-main → push → get-or-create-pr → wait-required-ci → merge → verify-remote → cleanup-local` 执行，每一步成功立即持久化 checkpoint。archive 及其提交 MUST 在 PR 创建前完成；PR diff MUST 同时包含实现、归档规格与 canonical spec 更新，且活动 change 目录不得残留。远端事实 SHALL 是 PR 与 merge 状态的权威来源。

#### Scenario: 同一 change 不重复创建 PR
- **WHEN** head branch 已存在 open 或 merged PR
- **THEN** integrate 复用该 PR，不再创建第二个 PR

#### Scenario: 归档先于 PR
- **WHEN** 准备创建 PR
- **THEN** archive 与归档提交 checkpoint 已成功，PR diff 包含实现和完整规格更新

#### Scenario: 分支落后 main
- **WHEN** 创建 PR 或等待 CI 前发现 head branch 落后 main
- **THEN** sync-main checkpoint 在 push/CI 前完成，冲突时明确挂起而非重复创建 PR

#### Scenario: 任意 checkpoint 恢复
- **WHEN** 在 archive、PR 已创建、CI 已通过或 merge 后中断并 resume
- **THEN** integrate 从下一未完成 checkpoint 继续，不重复已完成副作用

#### Scenario: 远端已合并但本地清理失败
- **WHEN** GitHub 显示 PR 已 merged 而 cleanup-local 失败
- **THEN** run 仍以集成成功结束并记录 warning，不回滚或重试远端 merge

### Requirement: Core 统一提交与文件范围审计
Dev 与 Tester SHALL 只修改其获授权文件并运行 scoped tests，不直接写 `.git`。core SHALL 在节点成功后核对允许范围、工作区差异和测试证据，再以确定性消息统一暂存并提交；越权修改 SHALL 拒绝提交并路由修复。

#### Scenario: 开发节点正常提交
- **WHEN** Dev 完成允许范围内的修改且 scoped tests 通过
- **THEN** core 创建且仅创建该节点对应提交，提交 SHA 写入 state

#### Scenario: Agent 无 git 写权限
- **WHEN** driver 无法写 `.git/index.lock`
- **THEN** Dev/Tester 仍可完成工作，因为 git 提交由 core 执行

#### Scenario: 越权文件修改
- **WHEN** Agent 修改了节点允许范围外的文件
- **THEN** core 不提交任何变更，记录路径并按所有权路由修复

### Requirement: 分层测试去重
Dev SHALL 运行受影响模块或测试文件及必要类型检查；Tester SHALL 审计 scenario 覆盖、补测试并运行新增或相关测试；Verify SHALL 在最终 HEAD 上运行唯一一次本地全量基线；CI SHALL 保留 required checks。相同 HEAD 上的成功验证结果 SHALL 允许按命令、环境和输入指纹复用，输入变化后必须失效。

#### Scenario: 开发阶段 scoped tests
- **WHEN** 一个 Dev 节点只修改 pipe-core 的局部模块
- **THEN** 该节点运行相关测试和必要静态检查，不重复完整 cargo/npm 基线

#### Scenario: 最终 HEAD 变化导致缓存失效
- **WHEN** Tester 或返修产生新 commit
- **THEN** 旧 HEAD 的 Verify 缓存失效，新 HEAD 必须执行完整基线

#### Scenario: 同一 HEAD 避免重复验证
- **WHEN** resume 时 HEAD、命令、环境与输入指纹均未变化且已有成功证据
- **THEN** core 复用该验证记录并标记 cache hit，不再次执行相同完整基线

### Requirement: 逐 attempt 可观测性与运行摘要
每次运行 SHALL 在版本化 state 或 `.agents/runs/<change>/events.jsonl` 中追加不可覆盖的 attempt 事件，至少包含 node、round、attempt、driver/model（适用时）、startedAt、endedAt、durationMs、errorKind、exitCode、decision、command durations、commit SHA、cache hit、CI queue/run duration 与人工介入计数。结束时 SHALL 输出总耗时、模型耗时、命令耗时、CI 等待、重试浪费、最慢三个阶段、PR/CI/merge 次数。

#### Scenario: 失败后成功仍可追溯
- **WHEN** 某节点首次失败、第二次成功
- **THEN** 两次 attempt 均保留各自时间、错误和结果，最终状态不覆盖失败历史

#### Scenario: 运行结束生成摘要
- **WHEN** run 成功、失败或挂起
- **THEN** core 输出并落盘结构化摘要，能够区分模型、命令、CI 等待和重试耗时

#### Scenario: 同等级变更效率目标
- **WHEN** 使用与 Issue #121 同等级的 domain=both fixture 执行端到端验收
- **THEN** 在质量门不降低的前提下，总耗时相对样本降低至少 35%，代码完成后的本地流程开销不含 GitHub CI 控制在 15 分钟内

### Requirement: 单变更无人值守验收
在 proposal/spec 获批后，一个与 Issue #121 同等级的 domain=both fixture SHALL 无需主会话修权限、代提交、同步分支或补归档即可完成；非瞬态情况下 bootstrap/spec-gate、verify、integrate 各只执行一次，同一 change 只产生一个 PR、一轮 required CI 和一次远端 merge。

#### Scenario: 端到端闭环
- **WHEN** 已批准的 domain=both fixture 从干净分支启动
- **THEN** 流程自动完成架构、开发、测试、CR、验证、归档、PR、required CI 与合并，且 PR 同时包含实现和规格归档

#### Scenario: 副作用唯一
- **WHEN** 端到端流程无瞬态网络故障
- **THEN** 记录显示一个 PR、一轮 required CI、一次远端 merge，bootstrap/spec-gate、verify、integrate 各一轮成功执行
