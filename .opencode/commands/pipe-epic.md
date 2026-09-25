# Pipe Epic

输入：`/pipe-epic <epic>`。当前 OpenCode 主会话读取 `.agents/skills/pipe/WORKFLOW.md`、`openspec/epics/<epic>/epic.json` 和 `.agents/runs/<epic>/epic-progress.md`。

由当前主会话显式提供自己的 `<current-owner>`，运行 `.agents/workflows/pipe-epic-preflight.sh <epic> <current-owner>`；如果 progress/lock 属于其他会话，先核对写入 Agent 已退出并完成 takeover。preflight 从每个 Issue 的 GitHub 时间线重查 PR，只接受本仓库且明确关闭该 Issue 的已合并 PR；当前事实刷新 Markdown 状态后再计算就绪集。仍为 `running` 的子项不会因重新运行 preflight 被重置或重新派发，需要主会话核实原生子 Agent 后再显式恢复。每批至多三个无依赖子变更；每项使用独立分支和 worktree，并由主会话用原生 `subagent`/Task 能力执行单变更协议。

主会话记录 Epic 和子变更 checkpoint。恢复时不重跑已合并项；无法确认仍在运行的写入子 Agent 时，先检查残留差异和所有权。不要通过 Node、CLI driver 或完整子流水线进程调度 Epic。
