---
name: "Pipe: Epic"
description: 并行驱动一个已初始化的 Epic——按 dependsOn DAG 就绪集 ≤3 并行跑子变更（worktree 隔离 + 独立分支 + 合并顺序保证）
category: Workflow
tags: [workflow, epic, pipeline, automation, parallel]
---

# Pipe: Epic — 并行实施 Epic 子变更

**触发**：`/pipe:init <epic>` 已完成（总 PRD 已批准）后，或续跑中断的 Epic。

**输入**：`/pipe:epic <epic名>`（如 `v1`）。

**目标**：按 `openspec/epics/<epic>/epic.json` 的 `dependsOn` DAG，**每批就绪子项 ≤3 并行**跑完所有未完成子变更。每个并行子项在**独立 git worktree + 独立分支**内跑完整 pipe 子流程（一个 change → 一个 worktree → 一个 PR）；合并回 main 按依赖拓扑保证前置先合并。

## 入口

`/pipe:epic` 是薄壳，转发到核心 epic 执行器：

```bash
node .agents/tools/pipe-core/run.js --epic <epic> --driver claude
```

- 核心读 `epic.json` `dependsOn` → 每批就绪子项 ≤3 并行 → 每个子项 `git worktree add .worktrees/<item> -b <branch>` → 子进程 `node run.js <item> --driver claude --cwd <worktree>`（`PIPE_CORE_REPO_ROOT` 注入主仓库，状态根锚定主仓库）→ 成功清理 worktree。
- 并行运行态写 `.agents/runs/<epic>/epic-state.json`（版本控制外）；`epic.json` 的 `cursor` 字段已废弃，推进判定按就绪集/批次。
- **崩溃可恢复**：重跑 `/pipe:epic <epic>` 读 epic-state，只跑未完成子项，不重跑已合并项。
- **前置合并后 refresh**：前置子项合回 main 后，依赖它的 worktree 先 `git rebase origin/main` 刷新基准再开 PR，避免合并期冲突。

## 前置校验（硬门槛）

1. `openspec/epics/<epic>/epic.json` 已提交且 `prdConfirmed === true`（总 PRD 已批准）。
2. 当前在 main 且工作区干净（`git status` 无未提交改动）。
3. 每个未完成子项的 `openspec/changes/<name>/` 中 proposal、specs、design、tasks 齐全，并且 `openspec validate <name>` 通过。

## 并行语义

- **就绪集**：子项依赖全部 `done` 且自身未 `done`/`running`/`failed`。
- **上限 ≤3**：每批最多 3 个并行，保守降低冲突面。
- **worktree 隔离**：两个并行子项各自在独立 worktree + 独立分支，互不污染对方工作区（对应记忆 `music-tag-branch-switch-during-workflow` 教训）。
- **依赖保证顺序**：子项 B `dependsOn` A → A 合回 main 后才合并 B，B 不在 A 之前合并（B 的 worktree 在 A 合并后 rebase main 刷新基准）。
- **失败子项不自动重试**：某子项失败 → 状态落盘 `failed`，执行器停止推进依赖它的子项，退出非零；由主会话决策后清理状态或重跑（D6 总原则）。

## 执行步骤

### ① 校验状态
- 读 `epic.json`，确认各子项 `dependsOn` 依赖项状态。
- 确认 main 干净。
- 执行 `.claude/workflows/pipe-epic-preflight.sh <epic>`；它机械校验 Epic 状态、sourceRevision、来源文件漂移和子 change artifacts。

### ② 运行核心 epic 执行器
```bash
node .agents/tools/pipe-core/run.js --epic <epic> --driver claude
```
核心按就绪集循环推进：每批就绪子项并行（worktree 准备 → 子进程完整 pipe → 成功清理 → 落盘 epic-state），全部就绪集空时结束。

### ③ 结果处理
| 退出码 | 处理 |
|--------|------|
| `0` | 全部子项完成，向用户汇报 |
| 非零 | 有失败/挂起子项：读 `.agents/runs/<epic>/epic-state.json` 与各 worktree 日志，停下上报用户；修复后重跑（已 done 项不重跑） |

### ④ 续跑（断点恢复）
- 重跑 `/pipe:epic <epic>`：读 epic-state.json → 跳过 `done` 项 → 从未完成/失败项续。
- 中断（Ctrl-C / 崩溃 / 挂起）后天然可续；worktree 残留由执行器 `ensureBranch` + `rebaseMain` 恢复。

## 确认点

- 无中间确认：总 PRD 已在 `/pipe:init` 批准，全程自动。
- **只在以下情况停下上报**：
  - 子项挂起（CR 三轮 / 需决策）
  - 验证/测试无法自动通过（修后续跑，反复不过上报）
  - 并行子项文件级冲突（合并期冲突由核心提示主会话处置）
  - 用户主动打断

## 完成报告

- 跑完的子项数、每个的 merge commit hash
- 每个子项的 implementation commit、CR 轮次 / 验证 / 测试结果
- 剩余的未完成子项（如有）
- 下一步：`/pipe:epic:status <epic>` 查看进度

## Guardrails

- 并行：每批 ≤3；依赖拓扑保证前置先合并；worktree + 独立分支隔离并写。
- 一个子变更 = 一个 worktree = 一个分支 = 一个 PR；不在 main 上直接开发。
- 失败不假报成功；`epic-state.json` 如实记录 status/error。
- 总 PRD 未批准（`prdConfirmed !== true`）禁止运行——先 `/pipe:init`。
- **集成派 subagent**：子项归档/PR/合并由子流程 integrate 节点（leader 角色）完成；主会话只做编排与上报。
