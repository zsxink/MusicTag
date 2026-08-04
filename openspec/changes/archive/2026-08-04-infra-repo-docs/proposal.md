## Why

仓库根目前没有 `README.md`（或内容残缺）。作为开源仓库的第一入口，README 承担「项目是什么 / 怎么跑 / 文档在哪」的速览职责。V1 全量功能已交付（读标签→编辑→保存→自动搜索），规格文档 `docs/V1-PRD.md`、`docs/design/design.md` 齐备，但仓库缺少对外统一的入口页，新人/自己回头翻阅都要先靠记忆。本变更补齐根 `README.md`，把项目定位、技术栈、常用命令、文档入口、协作流程（Issue 驱动 + pipe）沉淀为可读的中文文档，后续任何子变更都有据可查。

## What Changes

- 在仓库根新增 `README.md`（默认中文），包含：
  - **项目简介**：工具线 · 自用 · 纯本地取向；一次一首地给本地裸 FLAC/MP3 补全元数据（歌名、作者、专辑、封面、歌词）。
  - **核心特性**：一次一首编辑、选中即搜（网易云+QQ+咪咕三源并发聚合）、保存 = 表单全量覆盖、直接写盘、离线降级、坏标签只读等 V1 关键能力（简述，不展开）。
  - **技术栈**：Tauri 2 + Rust、lofty 标签读写、Vue 3 + Vite + TypeScript、单 store（不用 Pinia）。
  - **常用命令**：`npm run tauri dev` / `npm run tauri build` / `npm run dev` / `npm run build` / `cargo check` / `cargo test` / `cargo clippy`。
  - **文档入口**：`docs/V1-PRD.md`（产品需求）、`docs/design/design.md`（技术设计）。
  - **协作流程**：Issue 驱动（变更前先建 Issue）+ pipe 流水线（`/pipe <name>` 一键全自动）说明。
- 纯文档变更：不涉及代码、不涉及 Tauri command 契约、不改构建配置。

## Capabilities

### New Capabilities
- `infra-repo-docs`: 仓库根 README.md——中文速览入口，含项目简介 / 核心特性 / 技术栈 / 常用命令 / 文档入口 / Issue 驱动 + pipe 工作流

### Modified Capabilities
（无）

## 关联 Issue

- GitHub Issue：`#49`（变更前已建，作为本变更锚点；分支提交 `feat(49): ...`、PR `Closes #49`）
- 属于 Epic「项目基建初始化」（总 Issue `#48`）的子变更，域：docs，无依赖。

## Impact

- 纯文档：仓库根新增一个 `README.md`，不引入依赖、不改构建、不改运行时行为。
- 与其他子变更的关系：与「项目基建初始化」Epic 下的 CI（`infra-ci`）等子变更正交；README 是静态入口，不影响任何 command 契约。
- 验收可离线执行：检查 `README.md` 存在、全中文、含关键章节（项目简介/核心特性/技术栈/常用命令/文档入口/协作流程），链接指向真实文件。
