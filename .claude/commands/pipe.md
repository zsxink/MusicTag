---
name: "Pipe"
description: 当前主会话以原生子 Agent 执行单变更 pipe，并用 Markdown checkpoint 恢复
category: Workflow
tags: [workflow, native-subagents, pipeline]
---

# Pipe

输入：`/pipe <change>`。当前 Claude 主会话担任 Leader；先读取 `.agents/skills/pipe/SKILL.md` 和 `.agents/skills/pipe/WORKFLOW.md`，然后执行共享阶段：

`bootstrap → architect → spec-gate → dev → tester → cr → verify → integrate`

1. 读取 `openspec/changes/<change>/tasks.md` 与 `.agents/runs/<change>/progress.md`。恢复时核对工作树、分支、HEAD、提交、PR、CI 和任务产物；事实不符时从首个未证实阶段继续。
2. 首次启动运行 `.agents/workflows/pipe-preflight.sh <change> bootstrap`；Architect 产出 design/tasks 后再运行 `spec-gate`。检查失败时不得派发写入任务。
3. 通过 Claude 原生 Agent 工具派发公共角色：每个 prompt 指明 change、Issue、任务 ID、允许路径、完成条件、角色规则文件与 `DONE | NEEDS_PARENT_DECISION | FAILED` 回报格式。当前主会话不得派发 `leader` 角色。
4. 主会话只在已批准规格内回答子 Agent 的技术问题，并把依据写进 progress；范围、规格或不可逆外部动作的问题升级给用户。
5. CR 只读，最多三轮。主会话核对每次 CR 前后快照；有 blocker/major 时定向重派开发角色，三轮仍未通过则挂起。
6. 主会话核对命令退出码、HEAD 与文件快照，审计子 Agent 的授权范围后提交。Verify 成功后按共享工作流归档、创建或复用 PR、等待 required CI、合并并记录远端证据。

不得通过 Node、CLI driver 或任何 Agent CLI 运行角色。若 Claude 无法为某角色提供所需最小权限，停止在写入前并报告。
