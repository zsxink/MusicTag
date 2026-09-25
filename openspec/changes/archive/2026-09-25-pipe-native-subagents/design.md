## Context

当前 pipe 的 Node core 通过 Codex、Claude Code、OpenCode CLI driver 启动独立进程。它持有状态机、决策、提交和集成控制权，主会话只能等待进程结果。Issue #132 要求主会话成为 Leader，原生子 Agent 执行角色任务，并通过 Markdown 留下可恢复的事实。现有 Issue、OpenSpec、测试、CR、最终验证及 PR/CI/合并门槛仍适用。

本变更只改变开发工作流，不修改 MusicTag 产品行为。Codex、Claude Code、OpenCode 的原生子 Agent API 各不相同，跨宿主共享的是协议与角色内容，而非统一的进程 driver。

## Goals / Non-Goals

**Goals**

- 当前主会话负责阶段推进、原生子 Agent 派发、问题裁决、文件范围审计、Git 提交与集成。
- 子 Agent 的工作范围和回报格式可追踪；主 Agent 可直接回答已批准规格内的疑问。
- `tasks.md` 与运行目录的 Markdown 进度保存 checkpoint；新会话可核对事实后续跑。
- Epic 按依赖图派发最多三个隔离 worktree 的子变更。
- 正式 pipe 入口不再用 Node 或其他 CLI 启动 Agent 进程。

**Non-Goals**

- 不实现跨宿主会话 ID 迁移，也不绕过宿主权限确认。
- 不改变产品需求、构建工具或 GitHub 的权限模型。
- 不保证断线前运行中的子 Agent 可以重新连接；恢复时按未完成任务重新派发。

## Decisions

### 1. 主会话执行协议，脚本只做确定性工作

`AGENTS.md` 和 pipe skill 指向共享的 `WORKFLOW.md`。三个宿主的命令入口只加载共享流程；主 Agent 通过宿主原生子 Agent 工具派发角色。Codex 使用协作子 Agent 工具，Claude Code 使用 Agent 工具，OpenCode 使用 Task/原生 subagent。缺少原生能力时暂停并报告，不降级为 CLI driver。既有 Node core 从正式入口退出；允许 Node 运行纯检查或文件转换脚本，但不得通过它启动 Agent。

选择共享 Markdown 协议，是因为原生调度工具不能由仓库内 Node 脚本调用。替代方案“Node 包一层 CLI driver”无法让当前主会话接管决策，故弃用。各宿主命令保留极薄指针，避免复制完整规则。

### 2. 固定阶段与角色边界

阶段为 `bootstrap → architect → spec-gate → dev → tester → cr → verify → integrate`。主 Agent 执行 deterministic checkpoint；Architect、Dev、Tester、CR 通过原生子 Agent 派发。主 Agent为每次派发给出 change、Issue、任务、允许修改路径、完成条件、角色文案路径及报告格式。Dev/Tester 可修改授权文件，不执行 Git 写入；CR 只读且独立于开发者。失败按阶段重试上限和显式反馈重新派发，不能以文字“已完成”代替证据。

架构阶段先更新 OpenSpec 设计与任务；`spec-gate` 运行严格验证。开发任务按 `tasks.md` 顺序或独立性派发，文件写入范围不得重叠。Tester 验证并补足必要测试。CR 审阅当前差异，问题返回负责 Dev 修复，再重新检查。主 Agent 最终重新检查文件、命令结果和远端事实。

### 3. 主 Agent 的决策权限

子 Agent 用 `DONE`、`NEEDS_PARENT_DECISION`、`FAILED` 汇报，并给出证据、阻碍、候选方案。主 Agent 可依据已批准 PRD/OpenSpec、当前任务和项目约定回答实现细节、重试、任务重派、CR 修复、范围内取舍；将问答和依据写进进度文件。遇到产品行为歧义、需求/授权范围变化、不可逆外部动作或无证据可判断的问题，向用户升级。宿主工具的权限确认仍按宿主机制由用户处理；主 Agent 的回复不冒充用户批准。

### 4. Markdown 为运行状态来源

`openspec/changes/<change>/tasks.md` 的复选项表示交付任务。`.agents/runs/<change>/progress.md` 是唯一运行进度文件，含版本、变更与 Issue、主会话/分支/worktree、阶段状态、任务 ID、attempt、角色、授权路径、决定、命令及退出码、提交 SHA、PR/CI/合并证据。主 Agent 是唯一写入者，采用临时文件同目录原子替换；每次状态变动先落盘再派发后续任务。完成标记必须有对应证据。

`.agents/runs/` 已 gitignore；`tasks.md` 随 PR 版本化。linked worktree 内的 progress CLI 从 `.git` 指针和 `commondir` 解析主仓根，所有 `progress.md`/lock 都保存在主仓共享 `.agents/runs/`，子 worktree 删除后仍可追加 cleanup checkpoint；纯目录测试或非 Git 调用可显式传 `--repo-root`。恢复时先读 Markdown，再核对当前分支、工作树、OpenSpec 任务、提交、PR 和 CI。merge 与 cleanup 已被当前事实证实后进入终态恢复：当前 checkout 可为 main、worktree 可已删除、HEAD 可为 merge 后 HEAD；验证 HEAD 必须仍从 main 可达，历史验证命令和原始快照证据保持可核验，不再拿归档后的当前规格指纹与旧快照直接比较。Verify 与 Integrate/checkpoint 始终绑定同一源码指纹；源码变化使验证失效，规格归档可单独变化。事实不符则标记待核实/重做，不凭旧完成标记跳过。旧 `state.json` 只读迁移一次；转换不宣称未验证的节点已完成，原文件保留。并发会话使用运行目录锁；已有活跃主会话时拒绝第二个写入者。新主会话只有在确认旧写入会话及其子 Agent 均已结束后，才能用旧 owner 标识显式接管，并在同一原子更新中改写 progress/lock owner、保留接管人和核验依据。若新 owner 在接管事务中崩溃，后继主会话需通过显式 recovery 命令核实旧 takeover owner 已退出，再按 journal 与 lock/progress 的部分提交状态完成接管；不能确认时停止，不手动删除 journal。

### 5. Git 与集成由主 Agent 执行

Issue 在开始前存在；每变更使用同名分支和独立工作树。每个 Dev/Tester checkpoint 后，主 Agent 审计 `git status`、越权路径、密钥/生成物等，并按授权路径提交。最终 `verify` 校验 OpenSpec、构建/测试及仓库规则，再执行 archive、提交、同步 main、推送、创建或复用 PR、等待 required CI、合并及远端核对。任何失败保留 checkpoint 和现场，以事实续跑。Epic 最多并行三个无依赖子变更，每个独立 worktree 和进度文件；依赖变更通过合并的远端事实解锁。

### 6. 迁移与兼容边界

新入口以 `WORKFLOW.md` 为准。旧 `run.js`/drivers/Node core 不再作为受支持的 pipe 入口，保留短期历史模块以便迁移和回溯，并在调用时提示新入口；旧流程测试改为针对 Markdown 合同、宿主入口和确定性检查。旧 `state.json` 不能与新 `progress.md` 双写。文档和 preflight 去掉对旧 core self-check 的依赖。

## Risks / Trade-offs

- **主会话上下文耗尽或中断**：Markdown checkpoint 加上 Git/GitHub 事实核对支持新会话重建；运行中的子 Agent 任务重派，可能重复无副作用的工作。
- **各宿主原生工具语义不同**：共享的任务/回报协议和薄入口保持行为一致；缺能力即暂停，不偷偷回退 CLI。
- **主 Agent 手工操作失误**：确定性 preflight/状态检查、只允许指定路径提交、每阶段记录证据；CR 和最终验证为独立关卡。
- **旧 Node 测试与新协议并存**：旧 core 暂留但从入口退役；迁移后逐步删除，不让旧测试结果冒充新工作流验证。

## Migration Plan

1. 发布共享流程、角色回报协议、进度模板与检查工具；更新三个宿主入口、AGENTS 和 pipe skill。
2. 切换 preflight/self-check 指针，禁用旧 `run.js` 正式入口的 Agent 启动；保留旧状态用于只读迁移。
3. 在本变更中按新流程的 Markdown 结构记录一次执行证据，并验证跨新会话可根据文件和 Git 事实恢复。
4. 完成 OpenSpec 严格校验、工作流相关检查、CR 和 PR/CI 后集成；需要回滚时恢复入口指针，旧 `state.json` 未被改写。
