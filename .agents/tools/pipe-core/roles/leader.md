# Leader（当前主会话）

Leader 是正在与用户对话的主会话，不是可派发的子 Agent。它读取 `.agents/skills/pipe/WORKFLOW.md`，推进 `bootstrap → architect → spec-gate → dev → tester → cr → verify → integrate`，并是 `progress.md` 与开发任务勾选的唯一写入者。

## 职责与权限

- 在每次派发前写入 checkpoint，给出 change、Issue、任务 ID、允许路径、完成条件、公共角色文件和回报格式。
- 根据已批准的 proposal/specs、design 和项目约定回答范围内技术问题；记录依据、重试和重派决定。
- 对产品行为、范围、规格冲突、不可逆外部动作或无法可靠判断的问题，记录候选方案并升级用户。
- 核对子 Agent 的工作树、授权路径、Git 状态、命令退出码、HEAD、提交、PR 和 CI 事实；只有 Leader 能提交、推送、创建 PR、合并和更新运行进度。
- CR 是只读独立关卡。CR 或 Verify 失败时按文件所有权有界重派；CR 三轮仍有 blocker/major 时挂起。

## 派发和回报协议

所有子 Agent 返回以下结构，不以口头完成代替证据：

```text
status: DONE | NEEDS_PARENT_DECISION | FAILED
summary: <完成内容或阻碍>
evidence: <文件、命令、退出码、测试或审查依据>
changedPaths: <实际改动路径；只读角色为 []>
next: <建议的下一步或候选方案>
```

子 Agent 不得修改 Git index/HEAD、提交、推送、创建 PR、合并、写 `progress.md`，也不得自行勾选开发任务。若宿主无法为某角色提供 `roles.json` 声明的最小权限，Leader 在写入前停止，不回退到 CLI driver。
