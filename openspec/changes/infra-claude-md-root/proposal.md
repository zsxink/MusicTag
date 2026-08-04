## Why

当前项目规则只放在 `.claude/CLAUDE.md`，仅对 Claude Code 会话生效，且面向项目成员/Agent 协作。仓库根级缺少一份 `CLAUDE.md`（Claude Code 在任意仓库根自动加载的约定文件），新会话、子 Agent、外部协作者进入仓库时难以第一时间对齐项目规则。

根级 `CLAUDE.md` 是 Claude Code 的自动加载入口（无需 `.claude/` 目录存在即可生效）。在仓库根建立一份与定稿 specs（`docs/V1-PRD.md`、`docs/design/design.md`）完全一致的规范化规则，可让所有入口（根级 + `.claude/` 内）规则统一、单一事实源可追溯，避免二处文档漂移。

本变更只做「规范化 + 新增根级文件」，不改任何产品行为，也不动现有 `.claude/CLAUDE.md`。

## What Changes

- 仓库根新增 `CLAUDE.md`（Claude Code 根级自动加载），内容为规范化后的项目规则，章节：
  - 项目是什么（一次一首补全本地 FLAC/MP3 元数据，工具线 · 自用 · 纯本地）
  - 定稿规格（最终权威）：`docs/V1-PRD.md` + `docs/design/design.md` + 记忆 `music-tag-v1-spec.md`，改行为先同步文档
  - V1 关键约束（已拍板，勿违反）：一次一首 / 选中即搜 / 结果不自动写盘 / 保存=表单全量覆盖 / 直接写盘 / MP3 统一写 ID3v2.4 / 坏标签只读 / 保存失败保留可重试 / 离线降级
  - 技术栈：Tauri 2 + Rust、Vue 3 + Vite + TS、lofty、其余依赖清单
  - 常用命令：前端 `npm run dev/build/tauri dev/build`、后端 `cargo check/test/clippy/fmt`
  - 规格与变更管理（OpenSpec）：`openspec/` 根目录、`/opsx:*` 命令族、`/pipe` 流水线
  - 开发流水线：`pipe` 总入口、`/pipe:init`/`/pipe:epic` Epic 拆分、`/cr`/`/verify` 分步
  - 多 Agent 协作（pipe 流水线）：7 角色、Workflow 编排、CR 只读中转
  - GitHub：远程地址、Issue 驱动、PR 基分支 main、`gh` 白名单
  - Git 约定：每变更一分支、merge PR 回 main、增量提交、归档在 PR 前
  - 工作流约定：CodeGraph 优先、subagent 重度委派、pipe/调试/测试驱动
  - 语言与沟通：中文
- 根级 `CLAUDE.md` 与定稿 specs 逐条对齐：V1 关键约束、技术栈、命令、流程均以 specs 为唯一来源转述，无新增、无矛盾。
- **边界（不改）**：现有 `.claude/CLAUDE.md` 保持原样，本变更不增删改其中任何内容；不新增其他文件。
- 校验：根级 `CLAUDE.md` 可被 Claude Code 根级自动加载（存在且为有效 Markdown 规则文件）。

## Capabilities

### New Capabilities
- `infra-claude-md-root`: 仓库根 `CLAUDE.md` 存在且可被 Claude Code 自动加载，内容与定稿 specs 一致、无矛盾，且不修改 `.claude/` 下既有文件

### Modified Capabilities
（无）

## 关联 Issue

- GitHub Issue：`#50`（Epic「项目基建初始化」总 Issue `#48` 的子变更；分支提交 `feat(50): ...`、PR `Closes #50`）

## Impact

- 无产品行为变更：不碰 `src-tauri/`、`src/`（前端）、`docs/` 定稿文档。
- 文件面：仅新增仓库根 `CLAUDE.md` 一个文件；`.claude/CLAUDE.md` 及 `openspec/` 目录不受影响（本变更的 artifacts 属正常变更生命周期产物）。
- 规则口径：根级与 `.claude/` 二处规则并存，本变更要求二者口径一致；后续任何规则变更须同步维护两处（见 spec 验收场景）。
- 域：docs；无依赖（Epic 内先行子变更，无前后端代码依赖）。
