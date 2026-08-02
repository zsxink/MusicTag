---
name: "Pipe: Epic"
description: 串行驱动一个已初始化的 Epic——逐个子变更跑完整流水线（前置校验→架构→开发→测试→CR→最终验证→归档→PR→合并）
category: Workflow
tags: [workflow, epic, pipeline, automation]
---

# Pipe: Epic — 串行实施 Epic 子变更

**触发**：`/pipe:init <epic>` 已完成（总 PRD 已批准）后，或续跑中断的 Epic。

**输入**：`/pipe:epic <epic名>`（如 `v1`）。

**目标**：按 `openspec/epics/<epic>/epic.json` 的 cursor，**串行**跑完所有未完成子变更。每个子变更 = 完整 `/pipe` 流水线（一个 change → 一个分支 → 一个 PR）。前一个合并回 main 后再开下一个。

## 前置校验（硬门槛）

1. `openspec/epics/<epic>/epic.json` 已提交且 `prdConfirmed === true`（总 PRD 已批准）。
2. 当前在 main 且工作区干净（`git status` 无未提交改动）。
3. 当前 cursor 所指子项的 `openspec/changes/<name>/` 中 proposal、specs、design、tasks 齐全，并且 `openspec validate <name>` 通过。

## 执行步骤（主会话串行循环）

对每个未完成子变更（`status !== 'done'`，从 `cursor` 开始）：

### ① 校验状态
- 读 `epic.json`，确认当前子变更 `item` 与其 `dependsOn`（依赖项必须全部 done）。
- 确认 main 干净。
- 在 main 上执行 `.claude/workflows/pipe-epic-preflight.sh <epic> <子变更>`；它机械校验 Epic 状态、sourceRevision、来源文件漂移和子 change artifacts。不完整或来源已漂移时停止并重新初始化/确认。

### ② 创建分支并调 Workflow 执行子变更
- `git checkout -b <子变更>` 后，执行 `.claude/workflows/pipe-preflight.sh <子变更>`；该脚本校验分支、工作区、OpenSpec artifacts 和 `main` 基线。
- 调用 **Workflow 工具**执行 `.claude/workflows/music-tag-run.js`，`args.name=<子变更名>`。
- 复用全部 7 角色逻辑（前置校验→架构→开发按依赖→测试→CR 只读三轮→最终验证），**不复制逻辑**。
- 子变更的完整 artifacts 已在 `/pipe:init` 从已批准切片生成并校验，**运行期不再确认**。

### ③ 结果处理
| Workflow 返回 | 处理 |
|--------------|------|
| `success` | 集成已在 workflow ⑦ 由 leader subagent 完成（归档/PR/合并），主会话只做 ⑦ checkpoint 写入 + ⑧ 推进下一个 |
| `verify_failed` / `test_failed` | 打回修复重跑（可续跑） |
| `integration_failed` | 集成未完成：检查 `integration` 原因，修复后重跑或人工介入 |
| `suspended` | 停下上报用户（CR 三轮未通过 / 需决策），记 epic.json error |
| `failed` | 停下报告失败原因与阶段 |

### ④–⑥ 归档 / PR / 合并（已由 workflow ⑦ leader subagent 完成）
子变更 Workflow 返回 `success` 时，**归档 / 提交 PR / 等 CI / 合并 / 分支清理已在 workflow ⑦ 由 `leader` subagent 完成**（对应 pipe skill ⑤–⑦），主会话**不再直接执行**这些 git/gh 命令。主会话只负责 ⑦ checkpoint 写入与 ⑧ 推进下一个子变更。

> 兼容说明：若直接以单变更方式跑 `/pipe <name>`（非 epic），集成同样在 workflow ⑦ 内完成。

### ⑦ 写 checkpoint
- 在子变更 PR 中更新 `epic.json`：成功路径预写 `item.status = 'done'`、`item.implementationCommit = <当前分支 HEAD>`、`cursor++`；该状态随同一 PR 合入 main。
- 失败/挂起时不伪造成功；保留工作区并把原因写入 `item.error`，通过一个状态 PR 提交后再停止，保证其他机器能恢复。
- `openspec/epics/` 是受版本控制的状态；`/pipe:epic:status` 以 main 上状态为准。

### ⑧ 下一个
- 成功 → 继续下一个子变更；失败/挂起 → 停下上报用户。

## 续跑（断点恢复）

- 重跑 `/pipe:epic <epic>`：读 epic.json → 跳过 `status === 'done'` 项 → 从 `cursor` 续。
- 中断（Ctrl-C / 崩溃 / 挂起）后天然可续。
- 已归档的 change **不能重跑** workflow（校验点）——只有挂起/失败的未归档项可重试。

## 确认点

- 无中间确认：总 PRD 已在 `/pipe:init` 批准，全程自动。
- **只在以下情况停下上报**：
  - 单个子变更挂起（CR 三轮 / 需决策）
  - 验证/测试无法自动通过（修后重跑，反复不过上报）
  - 用户主动打断

## 完成报告

- 跑完的子变更数、每个的 merge commit hash
- 每个子变更的 implementation commit、CR 轮次 / 验证 / 测试结果
- 剩余的未完成子变更（如有）
- 下一步：`/pipe:epic:status <epic>` 查看进度

## Guardrails

- 严格串行：前一个合并回 main 后才开下一个，保证 CR 的 `git diff main...HEAD` 只含当前子变更。
- 一个子变更 = 一个分支 = 一个 PR；不在 main 上直接开发。
- 失败不假报成功；`epic.json` 如实记录 status/error。
- 总 PRD 未批准（`prdConfirmed !== true`）禁止运行——先 `/pipe:init`。
- **集成派 subagent**：子变更的归档/PR/合并由 workflow ⑦ 内 `leader` subagent 完成；主会话不直接跑这些 git/gh 命令（只做 checkpoint 与循环推进）。
