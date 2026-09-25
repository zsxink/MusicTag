## MODIFIED Requirements

### Requirement: 模型无关编排核心
pipe SHALL 由当前与用户对话的主会话 Agent 担任 Leader，按共享阶段依赖推进变更。主 Agent SHALL 使用宿主原生子 Agent 能力派发 Architect、Dev、Tester、CR 等角色任务；正式入口 SHALL NOT 通过 Node、`codex exec`、`claude -p` 或 OpenCode CLI 启动 Agent 或完整子流水线。普通 git/cargo/npm/openspec/gh 命令由主 Agent 的命令工具直接执行。

#### Scenario: 主会话保持调度权
- **WHEN** 用户从任一受支持宿主启动 pipe
- **THEN** 当前主会话 Agent 读取共享 skill、执行阶段推进，并在本会话中派发原生子 Agent，任务结果返回主会话决策

#### Scenario: 无原生能力
- **WHEN** 当前宿主不能派发所需原生子 Agent 或不能保障角色最小权限
- **THEN** 主 Agent 在写入阶段前明确停止并说明缺失能力，不回退至旧 CLI driver

#### Scenario: 核心不认识模型
- **WHEN** 用户从 Codex、Claude Code 或 OpenCode 启动相同变更
- **THEN** 主 Agent 按同一阶段协议使用当前宿主的原生子 Agent 能力，不选择跨模型 CLI driver。

#### Scenario: 节点定义驱动
- **WHEN** 共享流程定义了阶段依赖、角色、重试和验收
- **THEN** 主 Agent 按共享流程中明示的依赖、角色和门禁推进，并记录每次派发。

### Requirement: 节点状态机与断点续跑（P1）
主 Agent SHALL 维护 `pending → running → succeeded | failed | suspended` 的阶段状态。`openspec/changes/<change>/tasks.md` SHALL 记录经核对的任务完成情况；主仓 `.agents/runs/<change>/progress.md` SHALL 记录版本、change、Issue、branch、worktree、阶段、任务所有权、attempt/CR 轮次、验证 HEAD、子 Agent 标识、决策、集成 checkpoint 和下一步，且由主 Agent 独占写入。linked worktree 中的 CLI SHALL 将运行状态写到共享主仓，不能将其放入会随 cleanup 删除的 worktree。恢复 SHALL 以 Markdown 与仓库和远端事实共同判定，只复用证据有效的已完成阶段。

#### Scenario: 上下文压缩或新会话恢复
- **WHEN** 主会话上下文中断后重新触发同一 change
- **THEN** 主 Agent 读取 tasks.md/progress.md，核对 branch、worktree、Git HEAD/diff/提交、产物和远端 PR 状态，从首个未完成且依赖满足的阶段继续

#### Scenario: 标记与事实不一致
- **WHEN** Markdown 标记某阶段成功但提交不存在、输入已变或验证 HEAD 不再适用
- **THEN** 主 Agent 标记该阶段及受影响下游待重做，不能依靠勾选框宣布成功

#### Scenario: 中断的原生子 Agent
- **WHEN** progress.md 记录子 Agent 正在写入而恢复时无法确认其仍活跃
- **THEN** 主 Agent 将任务标为中断待核查，检查遗留差异及所有权后再续派，不能与可能仍在工作的 Agent 并行写同一范围

#### Scenario: 失败节点缓存失效
- **WHEN** 一个已执行阶段失败或其输入发生变化
- **THEN** 失败阶段及受其影响的下游阶段标为待重做，未受影响且证据仍有效的阶段可复用。

#### Scenario: 落地校验
- **WHEN** 恢复时 Markdown 声称阶段已经成功
- **THEN** 主 Agent 核对提交、HEAD、文件和远端证据，缺失时撤销成功判断。

#### Scenario: 中断后续跑
- **WHEN** 主会话在某阶段中途退出后再次启动同一 change
- **THEN** 主 Agent 从首个未完成且依赖满足的阶段恢复，不重复有证据的已完成工作。

#### Scenario: 挂起后接管已释放的锁
- **WHEN** 主 Agent 将阶段设为 suspended 并释放运行锁，后续会话确认旧主会话和所有写入子 Agent 均已结束
- **THEN** 新主 Agent 使用旧 owner、显式无活动写入者确认和核查依据，在原子接管事务中认领新锁并记录决定；未挂起的无锁记录不能以此方式接管。

#### Scenario: 接管事务中断后恢复
- **WHEN** 接管 journal 属于已确认退出的主会话 A，后续会话 B 核实 A 和写入子 Agent 均不再活动
- **THEN** B 使用 takeover-recover 命令核对 journal 与 lock/progress 的部分提交状态后恢复或完成接管，并记录 journal ID 和核查依据；未知/不匹配状态 fail-closed，不要求手工删除 journal。

#### Scenario: 初始化锁写入中断后恢复
- **WHEN** 初始化会话在原子创建完整 lock 后、首次 progress.md 写入前中断
- **THEN** 新会话必须提供匹配的 previous-owner、无活动写入者确认和非空核查依据，通过排他恢复 claim 隔离旧 lock 后重新初始化；无核查依据或 progress 已存在时拒绝恢复。

#### Scenario: 无核查依据拒绝接管
- **WHEN** 调用 takeover 或 takeover-recover 时缺少非空 evidence
- **THEN** 命令 fail-closed，不更改 lock、progress 或 takeover journal。

#### Scenario: worktree 清理后继续记录
- **WHEN** 集成流程删除实现用的 linked worktree
- **THEN** 主 Agent 仍能在共享主仓读取运行进度，并写入 `cleanup-local` checkpoint 和最终阶段状态。

#### Scenario: merge 后完成态恢复
- **WHEN** PR 已合并、verify-remote 和 cleanup-local 事实均已核实，但会话在 integrate 最终标记前中断，或后续再次恢复
- **THEN** 主 Agent 以 main 分支、merge 后 HEAD 和 worktree 已删除作为生命周期事实，确认验证 HEAD 仍可从 main 到达后保留原验证/集成证据，只补完 integrate 或报告完成，不要求伪造已删除 worktree 的旧事实。

### Requirement: 决断链（P2）
子 Agent SHALL 用 `DONE`、`NEEDS_PARENT_DECISION` 或 `FAILED` 返回状态。主 Agent SHALL 对失败做有界的 retry/reroute/escalate/abort 决断，记录原因和次数；可以回答已批准范围内的技术疑问，但不得跳过 CR、Verify 或扩大规格。

#### Scenario: 子 Agent 请求主 Agent 判断
- **WHEN** 子 Agent 返回问题、规格依据、建议、备选影响和阻塞状态
- **THEN** 主 Agent 依据已批准规格及用户授权给出答复并记录，再续派原子 Agent 或剩余任务

#### Scenario: 有界 CR 修复
- **WHEN** CR 指出 blocker/major 或验证失败
- **THEN** 主 Agent 按文件所有权派发有界修复、重跑受影响检查并重新审查；轮次与判断被记录，不能直接放行

#### Scenario: 自动归类
- **WHEN** CR 或 Verify 返回可修复的技术失败
- **THEN** 主 Agent 依据失败证据选择有界 retry 或 reroute，记录决定和轮次。

#### Scenario: 上报用户
- **WHEN** 故障涉及产品方向、需求歧义或有界修复预算耗尽
- **THEN** 主 Agent 记录挂起原因与方案并向用户升级，收到答复后继续。

### Requirement: 涉及用户决策回主会话（总原则）
主 Agent SHALL 自行处理有明确规格或授权依据的流程内决定；产品行为变化、范围扩大、规格冲突、不可判断或超过有界修复预算时 SHALL 向用户呈现问题和可选方案，收到答复后更新权威规格并恢复。Agent 间消息 SHALL NOT 视为宿主文件/命令/网络权限提示的批准。

#### Scenario: 主 Agent 可以代答
- **WHEN** 子 Agent 提问属于已批准规格内的技术选择
- **THEN** 主 Agent 记录依据和决定并继续，而不要求用户重复确认

#### Scenario: 需要用户拍板
- **WHEN** 子 Agent 问题涉及规格冲突或产品范围变化，或主 Agent 无法可靠判断
- **THEN** 主 Agent 记录挂起原因与选项、向用户提问；收到答复并同步规格后从受影响阶段继续

#### Scenario: 宿主权限独立
- **WHEN** 子 Agent 的工具调用触发宿主权限请求
- **THEN** 该请求仍由宿主权限机制处理，主 Agent 的流程答复不得绕过宿主权限

#### Scenario: 挂起回主会话
- **WHEN** 子 Agent 提交主 Agent 也无法在已批准范围内解决的问题
- **THEN** 主 Agent 将问题、证据、备选方案写入 progress.md，并在当前会话向用户说明。

#### Scenario: 用户决策后续跑
- **WHEN** 用户在主会话回答挂起问题
- **THEN** 主 Agent 将用户答复同步到权威规格和进度，核对事实后恢复受影响阶段。

#### Scenario: 不自我扩张
- **WHEN** 角色发现 PRD/OpenSpec 之外的潜在需求
- **THEN** 主 Agent 阻止超出已批准规格的实现，并向用户请求范围决定。

### Requirement: 自适应编排（P4）
Architect SHALL 判定 `backend/frontend/both/docs/spec/infra` 域，由主 Agent 按域选择原生子 Agent 和验证计划。`both` 的同一 worktree 写入 SHALL 按 Rust→Vue 顺序；docs/spec/infra 跳过无关业务编译，但保留适用的规格、脚本和审查门禁。

#### Scenario: 代码域
- **WHEN** Architect 判定 `both`
- **THEN** 主 Agent 先派 Rust 开发并核对提交，再派 Vue 开发，随后进入 Tester、CR 和完整验证

#### Scenario: 非代码域
- **WHEN** Architect 判定 docs/spec/infra
- **THEN** 主 Agent 派对应流程/文档角色，运行适用的文档或脚本检查、OpenSpec 校验和 CR，不运行无关 cargo/npm 编译

#### Scenario: 文档变更不触发编译
- **WHEN** Architect 将变更判定为 docs 或 spec
- **THEN** 主 Agent 派文档或规格任务并运行适用检查及轻量 CR。

#### Scenario: infra 变更静态自检
- **WHEN** Architect 将变更判定为 infra
- **THEN** 主 Agent 运行脚本语法、自检、OpenSpec strict validate 和 CR，跳过无关业务编译。

#### Scenario: 代码变更走既有基线
- **WHEN** Architect 将变更判定为 backend、frontend 或 both
- **THEN** 主 Agent 按域派发开发和测试角色，执行统一验证基线。

### Requirement: 子变更并行（P3）
Epic SHALL 由主 Agent 读取 `epic.json` 的 dependsOn DAG，按就绪集在独立 worktree/分支中调度原生子 Agent，并行子变更上限为 3 且不得超过宿主可用 Agent 配额。Epic 与每个子变更 SHALL 有独立 Markdown 进度；已合并项恢复时不得重跑，依赖前置合并后才推进后继合并。

#### Scenario: 就绪项并行
- **WHEN** 多个子变更无依赖且各自有独立 worktree
- **THEN** 主 Agent 最多同时推进三个子变更，不启动 `node run.js` 子进程

#### Scenario: 依赖与恢复
- **WHEN** 子变更 B 依赖 A 且 A 尚未合并
- **THEN** B 不在 A 前合并；恢复时核对 A 的远端合并事实后再决定 B 是否就绪

#### Scenario: 就绪集并行
- **WHEN** Epic 中存在多个无依赖且未完成的子变更
- **THEN** 主 Agent 在独立 worktree 中最多同时推进三个无依赖子项。

#### Scenario: 依赖保证顺序
- **WHEN** 子变更 B 的 dependsOn 包含 A
- **THEN** 主 Agent 核对前置项远端已合并，才解锁后继合并。

#### Scenario: worktree 隔离
- **WHEN** Epic 同时运行两个写入子变更
- **THEN** 每个子项在独立分支与 worktree 中写入，主 Agent 核对路径和污染。

#### Scenario: Epic 恢复以 Markdown 和当前远端为准
- **WHEN** 子项已在主仓 epic-progress.md 记录 done + remoteMerged，但 epic.json 仍标 pending，且归档目录中已无 active change
- **THEN** preflight 仅在 GitHub 当前 Issue 时间线证实关联 PR merged 时跳过该项；其余活动项必须有完整 proposal/design/tasks/specs、可读取的 Issue 并通过 OpenSpec strict validate。

#### Scenario: Epic 基线缺失或漂移
- **WHEN** epic-init 缺少 worktree/sourceRevision，或恢复 facts 的 branch/worktree/sourceRevision 与记录不匹配
- **THEN** 初始化或恢复失败，并阻止 epic-ready 返回可调度子项，直到主 Agent 重新核对并修复基线。

### Requirement: 角色单源
Leader、Architect、开发、Tester、CR 和验证角色 SHALL 由 `.agents/` 下的公共规则描述；宿主专用角色文件 SHALL 只提供注册、权限和公共规则引用，不维护相互矛盾的第二份流程。当前主 Agent SHALL 执行 Leader 规则，不启动 Leader 子 Agent。

#### Scenario: 公共角色更新
- **WHEN** 变更 CR 或 Dev 的公共规则
- **THEN** Codex、Claude Code 和 OpenCode 原生入口读取同一规则，静态检查能识别旧 CLI 指令或角色文案漂移

#### Scenario: 单源一致
- **WHEN** 公共角色规则发生变化
- **THEN** 宿主薄壳仅引用 .agents/ 公共角色规则，三端读取同一份内容。

### Requirement: 产品无关 capability（P6）
角色 SHALL 声明读、写、命令、网络和 Git 能力的最小需求；主 Agent SHALL 映射并核对宿主原生子 Agent 的权限。写入角色只获分配的文件范围，CR 只读；不能满足只读或最低权限时 SHALL 隔离并审计，仍不能保证则在执行前停止。子 Agent SHALL NOT 修改 git index/HEAD 或执行提交、push、PR 与合并。

#### Scenario: 越权写入
- **WHEN** 子 Agent 修改了分配范围外的文件或 git index/HEAD
- **THEN** 主 Agent 不提交该结果、记录污染并处理后再继续

#### Scenario: CR 只读
- **WHEN** CR 子 Agent 返回审查结论
- **THEN** 主 Agent 核对审查前后工作区快照；任何源码或规格写入均使本轮审查失败

#### Scenario: 只读 CR
- **WHEN** CR 子 Agent 执行审查
- **THEN** 主 Agent 按宿主能力设置只读约束并比较审查前后快照，写入即失败。

#### Scenario: 能力不足
- **WHEN** 宿主缺少角色所需能力或无法可靠施加只读限制
- **THEN** 主 Agent 在派发前停止并报告缺少的能力，不依赖 prompt 声称权限满足。

### Requirement: 中立工作流与确定性命令（P6）
共享 pipe skill SHALL 定义跨宿主一致的阶段、证据和 checkpoint；每阶段成功证据 SHALL 符合阶段所需类型，阶段不得越过未成功的前置阶段。Verify 成功 SHALL 记录本次验证 HEAD、源码与规格快照指纹、预期命令清单和逐命令退出码；Integrate 开始及每个 checkpoint 前 SHALL 确认源码指纹仍与 Verify 一致，并在类型化 checkpoint 证据中保留该指纹；仅 OpenSpec 归档导致规格指纹变化时可沿用 Verify。恢复时重新核对。主 Agent SHALL 直接调用中立 shell 命令或纯校验工具完成 bootstrap、spec-gate、Verify 和 Integrate；正式运行路径不得使用通过 Node `child_process` 包装 git/gh/openspec 的旧命令脚本。归档先于 PR，每个外部副作用前先检查本地或远端事实，完成后立即记录 checkpoint；每个集成 checkpoint 的类型化证据 SHALL 在恢复时与当前本地或远端事实匹配。

#### Scenario: 集成幂等
- **WHEN** 恢复时已有该分支 PR 或远端已合并
- **THEN** 主 Agent 复用 GitHub 事实，继续下一 checkpoint，不重复创建 PR、等待新一轮 CI 或再次合并

#### Scenario: 归档与 PR 顺序
- **WHEN** 主 Agent 准备创建 PR
- **THEN** 先核对活动 change 已归档且归档规格与实现同在分支 diff 中，缺一则停止

#### Scenario: preflight 路径中立
- **WHEN** 任一宿主执行 bootstrap 或 spec-gate
- **THEN** 三个宿主入口均直接调用 .agents/workflows/ 的确定性脚本。

#### Scenario: 归档命令可执行
- **WHEN** 主 Agent 开始 integrate 的 archive checkpoint
- **THEN** 主 Agent 执行确定性归档命令并核对活动 change 和 canonical spec。

#### Scenario: 集成命令确定性
- **WHEN** 主 Agent 推进 PR、CI 与合并 checkpoint
- **THEN** 主 Agent 按 checkpoint 顺序直接执行 git/gh 命令并核对远端结果。

#### Scenario: 集成证据失效
- **WHEN** progress 记录 CI、PR 或合并 checkpoint 成功，但恢复时 GitHub/本地事实缺少必要字段或与记录不匹配
- **THEN** 主 Agent 将该 checkpoint 与 integrate 标记为无效，从首个未证实 checkpoint 重新核查，不复用旧的成功标记。

#### Scenario: Verify 后源码改变
- **WHEN** Verify succeeded 后到任一集成副作用前，源码快照与 Verify 指纹不一致
- **THEN** 主 Agent 拒绝进入 Integrate 或推进该 checkpoint，并让 Verify/Integrate 失效；OpenSpec 归档/规格文件变化只有在源码指纹仍一致时可继续。

#### Scenario: 跨宿主复算源码指纹
- **WHEN** 不同宿主、cwd 或 linked worktree 恢复 Verify/Integrate
- **THEN** 使用 `source-fingerprint.js` 的版本化 UTF-8 路径清单算法复算，并在 Verify 与 checkpoint evidence 记录版本、指纹、manifest 摘要和清单；同一源码状态得到同一指纹，OpenSpec 归档移动不改变源码指纹。

#### Scenario: 三端入口同核
- **WHEN** 用户分别从三种宿主启动 pipe
- **THEN** 三个宿主入口加载同一个共享工作流和 Markdown 状态协议。

### Requirement: 流程脚本静态自检（沿用既有门禁）
pipe 前置检查 SHALL 校验共享 skill、宿主入口、公共角色、Markdown 模板及适用脚本语法；不得依赖旧 `run.js --self-check`。自检可使用不启动子进程的纯解析程序；任何缺失或不一致在写入阶段前 fail-closed。

#### Scenario: 新入口自检失败
- **WHEN** 宿主入口仍调用旧 CLI driver，或角色/模板缺失
- **THEN** 前置检查失败并指明文件，不进入写入阶段

#### Scenario: 自检 fail-closed
- **WHEN** 角色、入口、模板或脚本语法存在缺失或错误
- **THEN** 缺少角色、入口、模板或脚本语法错误时自检非零退出，preflight 不进入写入阶段。

### Requirement: 命令与入口改造
Codex 的 `AGENTS.md`、Claude Code 的 `/pipe` 和 OpenCode 的 `/pipe` SHALL 引导当前主会话加载同一 pipe skill 并直接调度原生子 Agent。Epic、初始化和状态入口 SHALL 使用同一主 Agent 进度语义，不再转发 `node run.js`。`/pipe` 入口 SHALL 可识别首次运行与 Markdown 恢复。

#### Scenario: Codex 主会话启动
- **WHEN** 用户在 Codex 会话说“跑 pipe <change>”
- **THEN** 当前主 Agent 读取共享 skill、Markdown 进度和规格，直接派发 Codex 原生子 Agent

#### Scenario: Claude/OpenCode 主会话启动
- **WHEN** 用户在 Claude Code 或 OpenCode 会话运行 `/pipe <change>`
- **THEN** 当前主 Agent 执行相同阶段与恢复协议，使用该宿主原生子 Agent，不执行 CLI driver

#### Scenario: 入口薄壳
- **WHEN** 用户在 Claude Code 执行 /pipe
- **THEN** Claude Code 命令加载共享 pipe skill 并由当前主会话派发原生子 Agent。

#### Scenario: codex 识别入口
- **WHEN** 用户在 Codex 会话说“跑 pipe”
- **THEN** Codex 主会话按 AGENTS.md 加载共享 skill 并使用原生子 Agent。

#### Scenario: skill 双框架共享
- **WHEN** Claude Code 与 Codex 分别加载 pipe skill
- **THEN** Claude Code 与 Codex 读取 .agents/skills/pipe/SKILL.md 同一物理文件。

### Requirement: 统一验证基线（继承 workflow-optimize 既有门禁）
最终完整验证 SHALL 在 Tester 与 CR 产物确定后的适用 HEAD 上运行。代码域执行 cargo check、cargo test、npm test、npm build 和 OpenSpec strict validate；docs/spec/infra 域执行对应文档或脚本检查与 OpenSpec validate。验证子 Agent 可执行命令，但主 Agent SHALL 核对退出码、HEAD、源码/规格快照并写入 Markdown 证据；任一步失败不得进入集成。搜索联动类变更额外保留专项回归清单。

#### Scenario: 验证只读源码
- **WHEN** 最终验证命令写出构建产物或缓存
- **THEN** 允许白名单构建路径变化，但 HEAD、源码和规格变化使验证失败

#### Scenario: 失败阻断
- **WHEN** 任一适用验证命令失败或缺少必要专项回归项
- **THEN** 主 Agent 标记 Verify 失败，记录命令与退出码，不能创建 PR

#### Scenario: 代码域全基线
- **WHEN** 代码域进入最终 Verify 阶段
- **THEN** 主 Agent 依序执行适用的 cargo、npm 与 OpenSpec 命令，记录每项结果。

#### Scenario: 文档域跳编译
- **WHEN** docs、spec 或 infra 域进入最终 Verify 阶段
- **THEN** 主 Agent 跳过无关业务编译，执行文档或脚本检查及 OpenSpec strict validate。

#### Scenario: 搜索联动类变更回归清单
- **WHEN** 改动涉及取词、换源、并发或离线判定
- **THEN** 主 Agent 追加单源换源、跨 kind 串扰和离线判定的专项检查并记录结果。

## REMOVED Requirements

### Requirement: 跨模型 driver（P5）
**Reason**: 正式 pipe 改为当前主会话调用宿主原生子 Agent，不再以 CLI driver 运行角色。
**Migration**: 宿主入口加载共享 skill 和角色规则；缺少原生能力时明确停止。

### Requirement: Agent Runtime Adapter 契约（P6）
**Reason**: `runAgent` 的 CLI 输出、超时、schema 契约不再是正式 pipe 的 Agent 调度边界。
**Migration**: 采用共享派发/返回/提问协议和 Markdown checkpoint，主 Agent 核对真实产物。

### Requirement: OpenCode driver（P6）
**Reason**: OpenCode 角色由当前主会话通过原生 Task/subagent 能力派发。
**Migration**: 建立 OpenCode 原生角色配置与共享 pipe 入口。

### Requirement: driver 一致性测试（P6）
**Reason**: 旧 CLI driver conformance 不再对应正式入口。
**Migration**: 改为跨宿主入口、权限映射、角色规则与 Markdown 恢复的契约检查。

## ADDED Requirements

### Requirement: Markdown 记录的唯一写入者与旧状态迁移
主 Agent SHALL 是 progress.md 与开发阶段 tasks.md 完成标记的唯一写入者；Architect 只在设计阶段细化 tasks.md。旧 `state.json` SHALL 作为只读迁移输入，迁移时保留已成功节点的提交/验证证据与未完成节点，不能把旧记录直接视作通过。

#### Scenario: 旧运行迁移
- **WHEN** 同一 change 有旧 state.json 且没有 progress.md
- **THEN** 主 Agent 将旧节点结果与 checkpoint 转成 Markdown 候选记录，逐项核对 Git 和远端事实后才标记成功

### Requirement: 主会话任务所有权
每个 change 同时 SHALL 只有一个主会话持有调度权。主 Agent SHALL 在启动或恢复时核对现有运行锁及原生子 Agent 状态；无法确认旧会话已结束时，不得并行派发写入工作。

#### Scenario: 两个会话竞争
- **WHEN** 第二个主会话尝试推进仍由另一个会话调度的 change
- **THEN** 第二个会话停止写入并报告当前持有者，不覆盖进度或重复外部副作用

#### Scenario: 已结束会话的显式接管
- **WHEN** 新主会话确认旧主会话及其所有写入子 Agent 均已结束，并提供当前 lock 中记录的旧 owner
- **THEN** 状态工具核对 lock 与 progress 的旧 owner 完全匹配，要求明确确认后原子转移 owner 并记录接管证据；未确认或标识不匹配时拒绝写入
