---
name: "Pipe: Epic"
description: 当前主会话按 dependsOn DAG 用原生子 Agent 推进 Epic
category: Workflow
tags: [workflow, epic, native-subagents]
---

# Pipe: Epic

输入：`/pipe:epic <epic>`。当前主会话读取 `.agents/skills/pipe/WORKFLOW.md` 的 Epic 协议、`openspec/epics/<epic>/epic.json` 和 `.agents/runs/<epic>/epic-progress.md`。

1. 由当前主会话显式提供自己的 `<current-owner>`，运行 `.agents/workflows/pipe-epic-preflight.sh <epic> <current-owner>`，确认总 PRD 已批准、主 worktree 干净、每个活动子变更的 GitHub Issue 存在且 OpenSpec 完整并通过 strict validate。如果 progress/lock 属于其他会话，先核对写入 Agent 已退出并完成 takeover。preflight 只接受本仓库且明确关闭对应 Issue 的已合并 PR；当前远端事实刷新 Markdown 后再计算依赖。仍为 `running` 的子项不会被自动重置或重派，须先核实原生子 Agent 状态。
2. 从 `dependsOn` 计算就绪集。最多同时推进三个无依赖子变更，每项在独立分支和 worktree 中，由主会话通过 Claude 原生 Agent 工具执行完整单变更协议。
3. 主会话维护 Epic 和子变更的 Markdown checkpoint。已合并项由远端事实确认后复用；运行中断且子 Agent 不可确认时，检查差异和所有权后重新派发，不并行写同一路径。
4. 只有前置子项已在远端合并，才解锁后继项的 rebase、PR 和合并。任何失败、冲突或需要用户的决定都记录并停止受影响依赖项。

不得调用 CLI driver 或启动完整 pipe 子进程。
