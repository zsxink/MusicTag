## Why

GitHub Issue：`#132`。

现有 pipe 由 Node 核心启动独立的 Agent CLI 进程，当前与用户对话的主 Agent 无法在运行中直接调度角色、回答子 Agent 的疑问，也无法依靠可读的进度文件恢复工作。Issue #132 要求把 Leader 放回主会话，用宿主原生子 Agent 完成角色任务，并保留现有规格、审查、验证和集成门槛。

## What Changes

- **BREAKING** `/pipe` 与 Epic 入口改由当前主 Agent 执行共享工作流，不再调用 `node run.js`、CLI driver 或 Node 子进程启动角色 Agent。
- Architect、开发、Tester、CR 等角色通过 Codex、Claude Code、OpenCode 的原生子 Agent 能力派发；主 Agent负责阶段推进、文件范围审计、提交、验证结果核对与集成。
- 子 Agent 的规格内疑问先由主 Agent在已批准范围内回答并记录；规格冲突、范围变化和无法判断的事项再交用户。
- 使用 OpenSpec `tasks.md` 与 `.agents/runs/<change>/progress.md` 记录任务、决策和 checkpoint；恢复时核对 Git、文件与 GitHub 远端事实，不信任单纯的完成标记。
- Epic 仍按依赖图和独立 worktree 最多并行三个子变更，由主 Agent统一协调，不启动完整 pipe 子进程。
- 保留 Issue→OpenSpec→Dev→Tester→CR→Verify→归档→PR→required CI→合并的质量闭环，并淘汰正式入口中的旧 Node driver 调度。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `workflow-core`：变更 Leader 所在位置、角色运行方式、决策边界、进度恢复、Epic 调度和正式入口，同时保留现有质量门。

## Impact

- 入口与角色：`AGENTS.md`、`.agents/skills/pipe/`、`.claude/commands/pipe*.md`、`.claude/agents/`、`.opencode/commands/pipe*.md` 和 OpenCode 原生 Agent 配置。
- 工作流实现：`.agents/workflows/`、`.agents/tools/pipe-core/`、`.agents/commands/` 的正式调用路径及相应测试、文档。
- 运行记录：新增 Markdown 模板与状态核对工具，旧 `state.json` 作为迁移输入。产品 UI 与标签读写行为不变，`docs/V1-PRD.md` 和 `docs/design/design.md` 的产品约束不受影响。
