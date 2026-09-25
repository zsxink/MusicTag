---
name: "Pipe: Init"
description: 当前主会话把 Epic 拆成有依赖的 OpenSpec 子变更
category: Workflow
tags: [workflow, epic, native-subagents]
---

# Pipe: Init

输入：`/pipe:init <epic> [来源]`。当前主会话读取 `.agents/skills/pipe/WORKFLOW.md` 和公共 `architect` 角色规则，以 Claude 原生 Agent 工具完成拆分。

1. 读取来源（默认 `docs/V1-PRD.md`，也可为 Issue 或需求描述），派 Architect 提出最小可独立合并的子变更：name、scope、domain、dependsOn、slice。
2. 展示拆分和依赖图，等待用户批准总 PRD。批准前不创建子 change 或开发工作树。
3. 批准后，主会话为每个子变更建立 Issue 与完整 OpenSpec artifacts，严格校验后写入受版本控制的 `openspec/epics/<epic>/epic.json` 和 `epic.md`。
4. 将 Epic 的批准事实、子项 Issue、依赖和验证证据写入 `.agents/runs/<epic>/epic-progress.md`。后续 `/pipe:epic` 按共享协议推进。

主会话保存所有调度与 Git 控制权；不要启动 CLI driver 或完整子流水线进程。
