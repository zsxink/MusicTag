## Why

V1 全量交付后，独立复核（Issue #46/#47）在搜索联动核心路径上抓出了 3 个 major 缺陷（C2 换源被聚合去重破坏、searchSeq 跨 kind 串扰、离线降级误判）与若干 minor。这些缺陷并非孤例——它们在「自测全绿 + CR 两轮通过」之后仍然漏到交付，说明流水线门禁对**跨模块状态语义**与**边界判定**类缺陷的拦截力不足，且缺陷被发现后回到主流程的**回归验证路径**（换源/串扰/离线三类场景）缺乏强制覆盖。

本变更属于 Epic「项目基建初始化」（#48），在 `spec-review`（#52）把 V1 定稿规格修正之后，对 pipe 流水线 / CR / 验证门禁做一次针对性优化：把复盘结论沉淀成可重复执行的质量门，避免同类缺陷再次漏网。这是**流程/脚本优化**，不改应用功能。

## What Changes

- 复核 `.claude/workflows/`（`music-tag-run.js`、`pipe-preflight.sh`、`pipe-epic-preflight.sh`）、`openspec/config.yaml`、各 skill（`pipe`）与 agent 定义（`cr-agent` / `verify-agent` / `tester` / `leader` 等），识别与复盘缺陷相关的薄弱点。
- 优化 **CR 门禁**：增加「复盘专项审查维度」（跨模块状态语义 / 竞态与串扰 / 网络与离线判定）、区分「阻断 / major / minor」的通过标准与缺陷证据要求、限制单轮修复范围并明确打回重审路径。
- 优化 **验证覆盖**：`verify-agent` 与 `pipe-preflight.sh` 统一验证基线（cargo check/test + npm test + npm run build + openspec validate）；为流程脚本本身补充静态自检；把复盘缺陷的回归场景纳入验证步骤清单。
- 优化 **流水线编排**：Tester 覆盖审计补「失败路径与边界」维度、Dev 增量提交补充阶段自验证、Workflow 返回阶段补充关键中间产物，使门禁可审计、可回溯。

## Capabilities

### New Capabilities
- `workflow-optimize`: 优化后的 pipe / CR / 验证门禁——复盘专项审查维度、统一验证基线、门禁可审计

### Modified Capabilities
（无；本变更不动 `openspec/specs/` 主规格，只改 `.claude/workflows/`、`openspec/config.yaml` 与 skill/agent 定义）

## 关联 Issue

- GitHub Issue：`#53`（变更前已建，作为本变更锚点；分支 `workflow-optimize`、PR 引用 `Closes #53`）

## Impact

- 影响面：开发流程基础设施（`.claude/workflows/music-tag-run.js`、`pipe-preflight.sh`、`pipe-epic-preflight.sh`、`openspec/config.yaml`、`pipe` skill 与 `cr-agent`/`verify-agent`/`tester` 等 agent 定义）。
- 与后续变更的关系：作为 `spec-review`（#52）的后续，其优化方向建立在已修正的 V1 定稿规格之上；后续所有子变更跑 `/pipe` 时都会经过新的门禁。
- 不改应用功能：无 Rust/前端业务代码改动；对 `src/`、`src-tauri/` 只做回归测试验证，不做功能改动。
- 归档时无主规格同步（`openspec/specs/` 无对应 capability 变更），只需归档 change 本体并随分支提交。
