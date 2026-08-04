## Why

当前项目规则只放在 `.claude/CLAUDE.md`，仅对 Claude Code 会话生效，且面向项目成员/Agent 协作。仓库根级缺少一份 `CLAUDE.md`（Claude Code 在任意仓库根自动加载的约定文件），新会话、子 Agent、外部协作者进入仓库时难以第一时间对齐项目规则。

根级 `CLAUDE.md` 是 Claude Code 的自动加载入口（无需 `.claude/` 目录存在即可生效）。在仓库根建立一份**分层式** `CLAUDE.md`：根级作为**总索引/总览**（项目是什么、文档入口、关键约束精要、规则入口指针），`.claude/CLAUDE.md` 承载**详细规则**，两层互补不重复，避免二处文档漂移。

本变更只做「新增根级总览文件」，不改任何产品行为，也不动现有 `.claude/CLAUDE.md`。

## What Changes

- 仓库根新增 `CLAUDE.md`（Claude Code 根级自动加载），定位为**总索引/总览**，章节：
  - 项目是什么（一句话 + 链接：一次一首补全本地 FLAC/MP3 元数据，工具线 · 自用 · 纯本地）
  - 文档入口（权威）：`docs/V1-PRD.md` + `docs/design/design.md` + 记忆 `music-tag-v1-spec.md`，改行为先同步文档
  - V1 关键约束（精要九条一行）：一次一首 / 选中即搜 / 结果不自动写盘 / 保存=表单全量覆盖 / 直接写盘 / MP3 统一写 ID3v2.4 / 坏标签只读 / 保存失败保留可重试 / 离线降级
  - 技术栈（精要）：Tauri 2 + Rust、Vue 3 + Vite + TS、lofty
  - 规则详情入口：指向 `.claude/CLAUDE.md`（常用命令 / OpenSpec-pipe / GitHub-Git / 工作流 / 7 角色协作的**全量细节都在那里**）
  - 快速上手：3 条命令 + 文档入口链接
- 根级 `CLAUDE.md` 的**精要**与定稿 specs 逐条对齐（V1 约束、技术栈、文档入口均以 specs 为唯一来源转述），且与 `.claude/CLAUDE.md` 详细规则**口径一致、指针正确**。
- **边界（不改）**：现有 `.claude/CLAUDE.md` 保持原样（详细规则），本变更不增删改其中任何内容；根级不复制其全量全文。
- 校验：根级 `CLAUDE.md` 可被 Claude Code 根级自动加载（存在且为有效 Markdown 规则文件）。

## Capabilities

### New Capabilities
- `infra-claude-md-root`: 仓库根 `CLAUDE.md`（总索引/总览）存在且可被 Claude Code 自动加载，与 `.claude/CLAUDE.md`（详细规则）形成层次——总览精要与详细规则口径一致、指针正确、互不复制全文，且不修改 `.claude/` 下既有文件

### Modified Capabilities
（无）

## 关联 Issue

- GitHub Issue：`#50`（Epic「项目基建初始化」总 Issue `#48` 的子变更；分支提交 `feat(50): ...`、PR `Closes #50`）

## Impact

- 无产品行为变更：不碰 `src-tauri/`、`src/`（前端）、`docs/` 定稿文档。
- 文件面：仅新增仓库根 `CLAUDE.md` 一个文件；`.claude/CLAUDE.md` 及 `openspec/` 目录不受影响（本变更的 artifacts 属正常变更生命周期产物）。
- 规则口径：根级（总览）与 `.claude/`（详细）两层规则并存，本变更要求二者分层一致（精要 = 详情的正确浓缩，指针指向正确）；后续任何规则变更须同步维护两层（见 spec 验收场景）。
- 域：docs；无依赖（Epic 内先行子变更，无前后端代码依赖）。
