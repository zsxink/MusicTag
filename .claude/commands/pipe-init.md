---
name: "Pipe: Init"
description: 初始化一个大变更（Epic）——Architect 自动拆分成多个子变更，展示清单，用户只批一次总 PRD
category: Workflow
tags: [workflow, epic, split, pipeline]
---

# Pipe: Init — 初始化 Epic 拆分

**触发**：用户有大变更（如 V1 整个产品、未来 V2），需要自动拆成多个子变更逐个实施。

**输入**：`/pipe:init <epic名> [来源]`
- `<epic名>`：kebab-case，如 `v1`、`v2`。
- `[来源]`：可选。`V1-PRD.md`（默认，或给路径）、GitHub Issue 号/链接、或一段需求描述。

**目标**：产出 Epic 拆分子变更清单与每个子项的完整 OpenSpec artifacts；**用户只批一次总 PRD**，之后 `/pipe:epic` 全自动串行实施。

## 与 `/pipe` 的关系

- `/pipe <name>` = **单变更**流水线（一个 change → 一个分支 → 一个 PR）。
- `/pipe:init` + `/pipe:epic` = **Epic** 流水线（外层编排，把大变更拆成多个子变更，串行跑完）。
- 子变更内部 **100% 复用 `/pipe`**（同一个 openspec change / 分支 / PR 语义）。

## 执行步骤

### ① 基线（仅首次，仓库无提交时）
- 若 `git log` 为空：新建 `.gitignore`（node_modules、dist、src-tauri/target、`openspec/epics/`）→ `git add . && git commit -m "chore: 基建基线"` → 配远端 `git@github.com:zsxink/MusicTag.git` → `git push -u origin main`。
- 已有基线则跳过。

### ② 读取来源
- 来源是 V1-PRD.md（默认）：读 `docs/V1-PRD.md`（§3 功能需求、§8 验收标准、§9 里程碑）+ `docs/design/design.md`。
- 来源是 Issue：`gh issue view <id>` 取需求背景，作为总 PRD 输入。
- 来源是描述：把描述作为总 PRD 输入。

### ③ 派 Architect 拆分子变更
派 `architect` 代理（**Epic 拆分模式**）：
```
读取来源规格，产出子变更清单（每项）：
- kebab-case 名（= 未来的 openspec change 名 = 分支名）
- 一句话范围
- 变更域：backend / frontend / both / docs / spec / infra（docs/spec/infra 为纯文档/流程变更，不触发业务编译门禁）
- dependsOn：前置子变更名数组（用于就绪集判定与合并顺序）
- 切片索引：从来源规格（V1-PRD 章节 / Issue / 描述）锚定内容来源
按依赖序排列（依赖者排后）。粒度 = 可独立 CR + 可独立验收 + 可独立合并的最小单元。
```
- 参考 V1 拆分基准：按 V1-PRD §9 里程碑 M1–M7 拆（skeleton→tag-read→tag-save→lyrics-lrc→theme-ux→search-core→search-ui），串行顺序即依赖序。
- **通用要求**：拆分逻辑只依赖「来源规格 + 拆分 prompt」，机制对 V2 可复用。

### ④ 总 PRD 确认点（唯一参与点）
- 展示子变更清单给用户：每项名称、范围、域、依赖、切片来源。
- 请用户确认：拆分是否合理、顺序是否正确、是否需要增删/合并子变更。
- 未批准时不得创建子 change 或启动开发。

### ⑤ 创建并校验子变更 artifacts
- 用户批准总 PRD 后，先为**每个子变更创建 GitHub Issue**（Issue 驱动，一个子变更一个 Issue，body 写范围/域/依赖/slice，关联总 Epic Issue）——存下 Issue 号，供 proposal 配套段与 epic.json 使用。
- 对每个 item 从其 `slice` 生成独立的 `openspec/changes/<item.name>/`：`proposal.md`、`specs/`、`design.md`、`tasks.md`。
- **每个 proposal 必须写「## 关联 Issue」段**：`GitHub Issue：\`#<号>\``（供 `pipe-preflight.sh` 强制校验）。
- 每项 artifact 必须只覆盖其切片；共同契约先落入依赖最前的子项，后续子项以其为前置条件，避免重复实现。
- 对每个子项运行 `openspec validate <item.name>`；任一项失败则停止，修复 artifacts 后再继续。
- 此步仅生成已批准总 PRD 的可执行拆分，不实现应用代码，也不再要求逐项确认。

### ⑥ 落盘并提交 Epic 状态
- 建 `openspec/epics/<epic>/`，**纳入版本控制**；它是可恢复的编排事实，不得 gitignore。
- 写 `epic.json`（机器真相源）：
```json
{
  "name": "v1",
  "status": "ready",
  "prdConfirmed": false,
  "source": "docs/V1-PRD.md",
  "epicIssue": 5,
  "items": [
    { "name": "v1-skeleton", "issue": 6, "domain": "both", "dependsOn": [], "status": "todo", "implementationCommit": null, "slice": "FR-1/FR-2" }
  ],
  "cursor": 0,
  "error": null,
  "sourceRevision": "<批准时 main 的 commit>"
}
```
> `cursor` 字段已随并行模型废弃（保留兼容），推进判定以 `.agents/runs/<epic>/epic-state.json` 就绪集/批次为准。
- 写 `epic.md`（人类读）：总 PRD 摘要、子变更说明、依赖、确认记录、artifact 校验结果；`sourceRevision` 必须记录批准时 `git rev-parse HEAD` 的 commit。
- 在 main 上提交初始化状态；用户批准后，`prdConfirmed = true`，`status = ready`。此后 `/pipe:epic` 可串行实施，不再逐个子变更确认。

## 确认点

- **唯一强制确认点**：④ 的总 PRD（子变更清单）用户批准。批准后即全自动。
- 若用户要求调整拆分（合并/拆分/改顺序）：改 `epic.json` items 后重新展示确认。

## 完成报告

- 子变更清单（名称 + 范围 + 域 + 依赖 + 切片来源）
- 已验证的 OpenSpec 子变更目录，以及已提交的 epic.json / epic.md 位置
- 提示下一步：`/pipe:epic <epic名>` 开始串行实施

## Guardrails

- 不把 V1-PRD.md 整本当作单个 openspec change——它权威但非 artifact，子变更的 proposal/specs 由 Architect 按切片产出。
- Epic 状态放 `openspec/epics/`，与 OpenSpec change 生命周期分离，但必须随仓库提交以支持跨机器恢复。
- 一个子变更 = 一个 openspec change = 一个分支 = 一个 PR，保持 CR 的 `git diff main...HEAD` 语义。
- 用户未批准总 PRD，或任一子项 artifacts 未通过 `openspec validate`，**禁止**开始 `/pipe:epic`。
