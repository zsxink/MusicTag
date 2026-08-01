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

**目标**：产出 Epic 拆分子变更清单，**用户只批一次总 PRD**，之后 `/pipe:epic` 全自动串行实施。

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
- 变更域：backend / frontend / both
- dependsOn：前置子变更名数组（用于顺序校验）
- 切片索引：从来源规格（V1-PRD 章节 / Issue / 描述）锚定内容来源
按依赖序排列（依赖者排后）。粒度 = 可独立 CR + 可独立验收 + 可独立合并的最小单元。
```
- 参考 V1 拆分基准：按 V1-PRD §9 里程碑 M1–M7 拆（skeleton→tag-read→tag-save→lyrics-lrc→theme-ux→search-core→search-ui），串行顺序即依赖序。
- **通用要求**：拆分逻辑只依赖「来源规格 + 拆分 prompt」，机制对 V2 可复用。

### ④ 落盘 Epic 状态
- 建 `openspec/epics/<epic>/`（gitignored，本地编排状态，不提交）。
- 写 `epic.json`（机器真相源）：
```json
{
  "name": "v1",
  "status": "planned",
  "prdConfirmed": false,
  "source": "docs/V1-PRD.md",
  "items": [
    { "name": "v1-skeleton", "domain": "both", "dependsOn": [], "status": "todo", "mergedHash": null, "slice": "FR-1/FR-2" }
  ],
  "cursor": 0,
  "error": null
}
```
- 写 `epic.md`（人类读）：总 PRD 摘要、子变更说明、依赖、确认记录。

### ⑤ 总 PRD 确认点（唯一参与点）
- **展示子变更清单给用户**：每项名称、范围、域、依赖、切片来源。
- 请用户确认：拆分是否合理、顺序是否正确、是否需要增删/合并子变更。
- **用户批准后**：`epic.json` 的 `prdConfirmed = true`，`status = running`。
- 此后全自动：`/pipe:epic` 串行实施，不再逐个子变更确认。

## 确认点

- **唯一强制确认点**：⑤ 的总 PRD（子变更清单）用户批准。批准后即全自动。
- 若用户要求调整拆分（合并/拆分/改顺序）：改 `epic.json` items 后重新展示确认。

## 完成报告

- 子变更清单（名称 + 范围 + 域 + 依赖 + 切片来源）
- epic.json / epic.md 位置
- 提示下一步：`/pipe:epic <epic名>` 开始串行实施

## Guardrails

- 不把 V1-PRD.md 整本当作单个 openspec change——它权威但非 artifact，子变更的 proposal/specs 由 Architect 按切片产出。
- Epic 状态只放 `openspec/epics/`，**不放** `openspec/changes/`（避免与 openspec 变更生命周期纠缠）。
- 一个子变更 = 一个 openspec change = 一个分支 = 一个 PR，保持 CR 的 `git diff main...HEAD` 语义。
- 用户未批准总 PRD，**禁止**开始 `/pipe:epic`。
