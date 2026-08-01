---
name: "OPSX: Run"
description: 旧版单 Agent 流水线（仅兼容保留；新变更默认使用 /pipe）
category: Workflow
tags: [workflow, automation, pipeline]
---

# OPSX: Run — 旧版单 Agent 流水线

> 兼容保留。新变更默认使用 `/pipe`：它具有前置 artifact 校验、测试先于 CR、最终验证及 CI 合并门禁。本命令不得绕过这些门禁。

**触发**：用户明确一个需求/变更（已有定稿规格或清晰描述），要求「自动完成后续」。用户输入可能是变更名（kebab-case）或一段需求描述。

**目标**：需求确认后，无人值守跑完整个开发闭环，只在真卡住时停下。

## 总览

```
需求确认
  ↓
① 规格产出  /opsx:propose <name>（proposal→specs→design→tasks）
  ↓
② 分支      git checkout -b <name>（每变更一分支）
  ↓
③ 开发      /opsx:apply <name>（TDD，逐任务实现）
  ↓
④ 自动 CR   /cr <name>（subagent 审查：规格一致性、遗漏、缺陷）
  ↓
⑤ 验证      /verify <name>（cargo check+test、npm run build、openspec validate）
  ↓
⑥ 归档+PR   archive → git add + commit → push → gh pr create → CI 全绿
  ↓
⑦ 合并      gh pr merge <name> --squash
```

## 执行步骤

### ① 规格产出
- 输入是需求描述 → 按 `/opsx:propose` 流程：确认理解 → `openspec new change <name>` → 生成全部 artifacts（proposal/specs/design/tasks）→ 用户 review proposal 与 design 并批准。
- 输入已是变更名 → 跳过 propose，直接进入 ②。
- **涉及 V1 拍板决策**的变更：同步 `docs/V1-PRD.md` / `docs/design/design.md` 后再往下。

### ② 创建分支
```bash
git checkout -b <change-name>   # 从 main 开分支，每变更一分支
```
- 若当前不在 main，先 `git checkout main`。
- 分支名 = change 名（kebab-case，git 安全）。

### ③ 开发
- 按 `/opsx:apply <name>` 执行：读上下文文件 → 逐任务实现 → 每完成一个勾一个 checkbox。
- **TDD**：新逻辑先写失败测试再实现。
- 开发期间**保持最新**：每完成一批任务就 `git add + commit`（消息形如 `feat(<name>): <任务>`），让进度可追溯、崩溃可恢复。

### ④ 自动 CR
- 运行 `/cr <name>`（或直接执行 CR 流程）：派 subagent 对照 `openspec/changes/<name>/` 的 specs/design 与代码 diff 审查。
- 审查维度：**规格一致性**（实现是否符合 specs）、**遗漏**（specs 有但代码没有）、**缺陷**（逻辑/边界/测试缺失）。
- **发现的问题自动修复**：回到 ③ 修复，重跑受影响测试，再回到 ④ 复审。循环直到 CR 通过。

### ⑤ 验证
- 运行 `/verify <name>`：`cargo check`、`cargo test`、`npm run build`、`openspec validate <name>`。
- 任一失败：修复 → 重跑验证，直到全绿。

### ⑥ 归档与 PR
```bash
git add . && git commit -m "feat(<name>): <变更摘要>"
git push -u origin <name>
gh pr create --base main --head <name>
```
- `/opsx:archive <name>` 必须在提交前完成；等待 CI required checks 全绿后方可合并。

### ⑦ 合并
- `gh pr merge <name> --squash` 后更新 main 并删除已合并的本地分支。

## 确认点

- **唯一强制确认点**：用户下达需求时（必须理解需求、确认过 propose 的 proposal/design）。
- 流程中不设中间确认；**只在以下情况停下**：
  - 需求/规格有歧义或冲突（暂停，问用户）
  - 实现暴露设计缺陷（暂停，建议更新 artifacts）
  - 验证或 CR 无法自动通过（暂停，报告）
  - 用户主动打断

## 完成报告

结束后汇报：
- 变更名、改动摘要、涉及文件数
- 测试/CR/验证结果（全绿）
- 合并方式、分支清理情况
- 归档后的主规格变更

## Guardrails

- **proposal/design 未经用户批准**不得进入开发（①②是唯二需要用户参与的阶段）。
- 不在 main 上直接开发；merge 是回到 main 的唯一方式。
- 不删用户的未合并分支（`-d` 只删已合并）。
- 报告如实：失败就停，不粉饰、不假报全绿。
