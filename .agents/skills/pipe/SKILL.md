---
name: pipe
description: MusicTag 多 Agent 开发流程。当前主会话 Agent 调度宿主原生子 Agent，使用 OpenSpec tasks.md 和 Markdown progress.md 记录、恢复；用于新功能、行为修改和 Bug 修复。
---

# pipe

当前与用户对话的主 Agent 就是 Leader。收到「跑 pipe `<change>`」、`/pipe <change>` 或 Epic 入口后，读取 [WORKFLOW.md](WORKFLOW.md) 全文并按其中的阶段、权限和 checkpoint 执行。Agent 派发只能使用当前宿主的原生子 Agent 工具，不能调用旧 `.agents/tools/pipe-core/run.js`、`codex exec`、`claude -p`、`opencode run` 启动角色。普通 Git、OpenSpec、构建和纯状态检查命令可由主 Agent 的命令工具直接执行。

- Codex：根 `AGENTS.md` 指向此 skill，使用原生协作子 Agent。
- Claude Code：`/pipe <change>` 在当前会话执行，使用 Agent 工具。
- OpenCode：`/pipe <change>` 在当前会话执行，使用 Task/原生 subagent。
- Epic：`/pipe:epic <epic>` 依共享流程的 Epic 章节推进。
- 恢复：再次触发同一 change，先读 `tasks.md` 与 `.agents/runs/<change>/progress.md`，核对 Git/GitHub 事实。

公共角色文案在 `.agents/tools/pipe-core/roles/`；宿主文件只做注册和权限边界。Leader 规则由当前主会话执行，不派 Leader 子 Agent。若缺少原生子 Agent 或必要的只读能力，在写入前停止并说明，不能回退 CLI driver。Claude 的 `.claude/skills/pipe` 是指向本目录的 symlink，不维护第二份 skill。
