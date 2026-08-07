---
name: "Pipe: Epic Status"
description: 查看 Epic 进度——读 epic.json 与 epic-state.json 展示每个子变更的状态、就绪集、错误
category: Workflow
tags: [workflow, epic, status]
---

# Pipe: Epic Status — 查看 Epic 进度

**触发**：`/pipe:epic:status <epic名>`（如 `v1`）。

**目标**：读取 `openspec/epics/<epic>/epic.json` 与 `.agents/runs/<epic>/epic-state.json`（并行运行态），展示 Epic 当前进度与断点。

## 展示内容

1. **总览**：`name`、`status`（ready/running/done/suspended/failed）、`prdConfirmed`、来源、`sourceRevision`。
2. **子变更清单**（按数组顺序）：
   | 名称 | 域 | dependsOn | 状态 | implementationCommit | 切片来源 |
   |------|----|-----------|------|----------------------|---------|
   | v1-skeleton | both | — | ✅ done | abc123 | FR-1/FR-2 |
   | v1-tag-read | both | v1-skeleton | 🔄 running | — | FR-3 |
   | v1-tag-save | both | v1-tag-read | ⏳ pending | — | FR-5 |
   | v1-search-ui | frontend | … | ⏸ suspended | — | FR-8 |
3. **并行运行态**（`epic-state.json`，版本控制外）：当前批次、worktree 路径、mergeOrder、各子项状态（pending/running/done/failed）。
4. **error**（若有）：最近失败/挂起的子项与原因。
5. **next 提示**：若 `prdConfirmed && status !== 'done'` → 建议 `/pipe:epic <epic>`；若 `prdConfirmed === false` → 建议先 `/pipe:init <epic>` 完成确认。

## 输出

用清单/表格形式，保持简短。不修改任何文件（只读）。