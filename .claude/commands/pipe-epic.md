---
name: "Pipe: Epic"
description: 串行驱动一个已初始化的 Epic——逐个子变更跑完整流水线（架构→开发→CR→验证→测试→归档→PR→合并）
category: Workflow
tags: [workflow, epic, pipeline, automation]
---

# Pipe: Epic — 串行实施 Epic 子变更

**触发**：`/pipe:init <epic>` 已完成（总 PRD 已批准）后，或续跑中断的 Epic。

**输入**：`/pipe:epic <epic名>`（如 `v1`）。

**目标**：按 `openspec/epics/<epic>/epic.json` 的 cursor，**串行**跑完所有未完成子变更。每个子变更 = 完整 `/pipe` 流水线（一个 change → 一个分支 → 一个 PR）。前一个合并回 main 后再开下一个。

## 前置校验（硬门槛）

1. `openspec/epics/<epic>/epic.json` 存在，`prdConfirmed === true`（总 PRD 已批准）。
2. 当前在 main 且工作区干净（`git status` 无未提交改动）。
3. 无正在进行的子变更分支（`git branch` 里没有未合并的子变更分支）。

## 执行步骤（主会话串行循环）

对每个未完成子变更（`status !== 'done'`，从 `cursor` 开始）：

### ① 校验状态
- 读 `epic.json`，确认当前子变更 `item` 与其 `dependsOn`（依赖项必须全部 done）。
- 确认 main 干净。

### ② 调 Workflow 执行子变更
- 调用 **Workflow 工具**执行 `.claude/workflows/music-tag-run.js`，`args.name=<子变更名>`。
- 复用全部 7 角色逻辑（架构设计→开发按域→CR 只读三轮→验证→测试），**不复制逻辑**。
- 子变更的 PRD 已在 `/pipe:init` 由 Architect 从来源切片生成并获批，**运行期不再确认**。

### ③ 结果处理
| Workflow 返回 | 处理 |
|--------------|------|
| `success` | 进 ④ 归档 + ⑤ PR + ⑥ 合并 |
| `verify_failed` / `test_failed` | 打回修复重跑（可续跑） |
| `suspended` | 停下上报用户（CR 三轮未通过 / 需决策），记 epic.json error |
| `failed` | 停下报告失败原因与阶段 |

### ④ 归档（规格随分支走）
- 在子变更分支上执行 `/opsx:archive <子变更>`，规格更新进分支。

### ⑤ 提交 PR
```bash
git add . && git commit -m "feat(<子变更>): <变更摘要>"
git push -u origin <子变更>
gh pr create --base main --head <子变更> --body "Closes #<issue>"   # 有对应 Issue 时
```

### ⑥ 合并 PR
```bash
git checkout main && git pull
gh pr merge <子变更> --squash
git branch -d <子变更>
```

### ⑦ 写 checkpoint
- 更新 `epic.json`：
  - 成功 → `item.status = 'done'`、`item.mergedHash = <merge提交hash>`、`cursor++`。
  - 失败/挂起 → `item.status = <失败状态>`、`item.error = <原因>`、`cursor` 停在当前。
- `openspec/epics/` 整体 gitignored，**不提交**（本地编排状态）。

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
- 每个子变更的 CR 轮次 / 验证 / 测试结果
- 剩余的未完成子变更（如有）
- 下一步：`/pipe:epic:status <epic>` 查看进度

## Guardrails

- 严格串行：前一个合并回 main 后才开下一个，保证 CR 的 `git diff main...HEAD` 只含当前子变更。
- 一个子变更 = 一个分支 = 一个 PR；不在 main 上直接开发。
- 失败不假报成功；`epic.json` 如实记录 status/error。
- 总 PRD 未批准（`prdConfirmed !== true`）禁止运行——先 `/pipe:init`。
