## ADDED Requirements

### Requirement: 仓库根存在 README.md 且为中文
仓库根 `README.md` SHALL 存在，且正文默认使用中文撰写（本项目沟通与 UI 文案均为中文）。

#### Scenario: README 存在
- **WHEN** 检查仓库根目录
- **THEN** 存在 `README.md` 文件

#### Scenario: README 为中文
- **WHEN** 阅读 `README.md` 正文
- **THEN** 主体内容为中文（标题、简介、章节、命令说明均以中文撰写；技术术语如 `Tauri 2`、`lofty`、`cargo` 可保留英文原文）

### Requirement: README 含项目简介
README SHALL 在开头说明项目定位：工具线 · 自用 · 纯本地取向，一次一首地给本地裸 FLAC/MP3 补全元数据（歌名、作者、专辑、封面、歌词）。

#### Scenario: 简介说明定位与用途
- **WHEN** 阅读 README 开头的项目简介
- **THEN** 能读到「一次一首」「本地 FLAC/MP3」「补全元数据（歌名、作者、专辑、封面、歌词）」的表述

#### Scenario: 简介说明本地取向
- **WHEN** 阅读 README 的项目简介
- **THEN** 能读到「工具线 · 自用 · 纯本地」的定位描述

### Requirement: README 含核心特性
README SHALL 列出 V1 核心特性，至少覆盖：一次一首编辑、选中即搜（网易云+QQ+咪咕三源并发聚合、仅补缺失、已有不搜）、结果不自动写盘（候选列表手动点选）、保存 = 表单全量覆盖（填了就存、不填即清空）、直接写盘（无备份、无撤销）、离线降级。

#### Scenario: 特性列表覆盖一次一首与搜索
- **WHEN** 阅读 README 的「核心特性」章节
- **THEN** 能读到「一次一首」与「选中即搜」「网易云+QQ+咪咕三源并发聚合」的条目

#### Scenario: 特性列表覆盖保存语义
- **WHEN** 阅读 README 的「核心特性」章节
- **THEN** 能读到「表单全量覆盖（填了就存、不填即清空删除）」与「直接写盘（无备份、无撤销）」的条目

### Requirement: README 含技术栈
README SHALL 说明技术栈：外壳 Tauri 2 + Rust、标签读写 lofty、前端 Vue 3 + Vite + TypeScript。

#### Scenario: 技术栈覆盖外壳与前端
- **WHEN** 阅读 README 的「技术栈」章节
- **THEN** 能读到 `Tauri 2`、`Rust`、`Vue 3`、`Vite`、`TypeScript` 的表述

#### Scenario: 技术栈覆盖标签读写
- **WHEN** 阅读 README 的「技术栈」章节
- **THEN** 能读到标签读写库 `lofty` 的表述

### Requirement: README 含常用命令
README SHALL 列出常用命令：前端 `npm run dev` / `npm run build`，外壳 `npm run tauri dev` / `npm run tauri build`，后端 `cargo check` / `cargo test` / `cargo clippy`（含 manifest 路径 `src-tauri/Cargo.toml`）。

#### Scenario: 列出前后端命令
- **WHEN** 阅读 README 的「常用命令」章节
- **THEN** 能读到 `npm run tauri dev` 与 `cargo test`（并注明 manifest 为 `src-tauri/Cargo.toml`）的条目

#### Scenario: 命令可复制执行
- **WHEN** 按 README 列出的命令在仓库根执行
- **THEN** 命令与 `package.json` / `Cargo.toml` 中的 script 一致，可正常发起（如 `npm run build`、`cargo check --manifest-path src-tauri/Cargo.toml`）

### Requirement: README 含文档入口
README SHALL 链接到规格文档 `docs/V1-PRD.md`（产品需求）与 `docs/design/design.md`（技术设计），作为文档入口。

#### Scenario: 文档入口指向 PRD 与设计
- **WHEN** 阅读 README 的「文档入口」章节
- **THEN** 能读到指向 `docs/V1-PRD.md` 与 `docs/design/design.md` 的链接（Markdown 相对链接）

#### Scenario: 链接真实可达
- **WHEN** 从仓库根按 README 的链接访问
- **THEN** `docs/V1-PRD.md` 与 `docs/design/design.md` 两个文件均存在

### Requirement: README 含协作流程说明
README SHALL 说明协作约定：Issue 驱动（任何变更动手前先建 GitHub Issue 作为锚点）+ pipe 工作流（`/pipe <name>` 一键全自动：前置校验 → 设计 → 开发 → 测试 → CR → 验证 → 归档 → PR → 合并）。

#### Scenario: 说明 Issue 驱动
- **WHEN** 阅读 README 的「协作流程」章节
- **THEN** 能读到「变更前先建 Issue」的约定

#### Scenario: 说明 pipe 工作流
- **WHEN** 阅读 README 的「协作流程」章节
- **THEN** 能读到 `pipe` 流水线的入口（如 `/pipe <name>`）及其闭环描述
