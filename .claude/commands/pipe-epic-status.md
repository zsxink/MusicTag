---
name: "Pipe: Epic Status"
description: 读取 Epic 与 Markdown checkpoint，展示可恢复的调度状态
category: Workflow
tags: [workflow, epic, status]
---

# Pipe: Epic Status

输入：`/pipe:epic:status <epic>`。读取 `.agents/skills/pipe/WORKFLOW.md`、`openspec/epics/<epic>/epic.json` 与 `.agents/runs/<epic>/epic-progress.md`，不修改任何文件。

简洁列出：总 PRD 批准记录、每个子变更的 domain、dependsOn、分支/worktree、最近阶段、验证 HEAD、PR/CI/远端合并证据、当前持有者和下一步。若进度标记与 GitHub 或 Git 事实矛盾，标记“待核实”，不要把它显示为完成。
