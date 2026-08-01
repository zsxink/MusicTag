---
name: "Pipe: Epic Status"
description: 查看 Epic 进度——读 epic.json 展示每个子变更的状态、cursor、错误
category: Workflow
tags: [workflow, epic, status]
---

# Pipe: Epic Status — 查看 Epic 进度

**触发**：`/pipe:epic:status <epic名>`（如 `v1`）。

**目标**：读取 `openspec/epics/<epic>/epic.json`，展示 Epic 当前进度与断点。

## 展示内容

1. **总览**：`name`、`status`（planned/running/done/suspended/failed）、`prdConfirmed`、来源。
2. **子变更清单**（按数组顺序）：
   | 名称 | 域 | dependsOn | 状态 | mergedHash | 切片来源 |
   |------|----|-----------|------|-----------|---------|
   | v1-skeleton | both | — | ✅ done | abc123 | FR-1/FR-2 |
   | v1-tag-read | both | v1-skeleton | 🔄 running | — | FR-3 |
   | v1-tag-save | both | v1-tag-read | ⏳ todo | — | FR-5 |
3. **cursor**：下一个要执行的 index。
4. **error**（若有）：最近失败/挂起的子变更与原因。
5. **next 提示**：若 `prdConfirmed && status !== 'done'` → 建议 `/pipe:epic <epic>`；若 `prdConfirmed === false` → 建议先 `/pipe:init <epic>` 完成确认。

## 输出

用清单/表格形式，保持简短。不修改任何文件（只读）。
