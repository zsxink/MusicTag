#!/usr/bin/env node
'use strict';

// Retired CLI entry. Agent scheduling now belongs to the current main session.
console.error('旧 pipe-core CLI 已退役。请在当前主会话加载 .agents/skills/pipe/SKILL.md 与 WORKFLOW.md，使用宿主原生子 Agent 运行或恢复 pipe。');
process.exitCode = 2;
