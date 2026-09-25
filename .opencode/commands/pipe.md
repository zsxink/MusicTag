# Pipe

输入：`/pipe <change>`。当前 OpenCode 主会话担任 Leader。读取 `.agents/skills/pipe/SKILL.md` 和 `.agents/skills/pipe/WORKFLOW.md`，并直接推进：

`bootstrap → architect → spec-gate → dev → tester → cr → verify → integrate`

1. 读取 `openspec/changes/<change>/tasks.md`、`.agents/runs/<change>/progress.md`，并核对 Git、worktree、提交、PR 和 CI 事实；从首个没有有效证据的阶段恢复。
2. 首次启动运行 `.agents/workflows/pipe-preflight.sh <change> bootstrap`；Architect 产出 design/tasks 后再运行 `spec-gate`。检查失败时不得派发写入任务。
3. 用 OpenCode 原生 `subagent`/Task 能力调用 `.opencode/agents/` 中的角色；prompt 必须给出 change、Issue、任务 ID、允许路径、验收条件、公共角色文件和 `DONE | NEEDS_PARENT_DECISION | FAILED` 回报格式。不得派发 `leader`。
4. 已批准规格内的技术问题由主会话决定并写入 progress；规格、范围、不可逆外部动作或无法判断的问题交用户。CR 只读且至多三轮。
5. 主会话审计授权路径、退出码、HEAD、提交和远端事实；只有主会话能提交、推送、创建 PR、合并或写运行进度。

不要用 Node、任何 CLI driver 或 Agent CLI 启动角色。缺少满足公共角色最小权限的原生能力时，在写入前停止并报告。
