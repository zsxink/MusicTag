# infra-repo-docs 技术设计

## Context

仓库已完成 V1 全量功能交付（读标签 → 编辑 → 保存 → 自动搜索 → 离线降级），定稿规格在 `docs/V1-PRD.md` 与 `docs/design/design.md`。但仓库根缺少统一入口 `README.md`：项目定位、技术栈、常用命令、文档入口、协作流程（Issue 驱动 + pipe）散落在 `.claude/CLAUDE.md`、`openspec/config.yaml` 与两份定稿文档里，对初次接触仓库的人（或隔段时间回看的自己）没有「第一屏」。本变更把上述信息沉淀为根 `README.md`，作为仓库的门面与导航页。

## Goals / Non-Goals

**Goals:**
- 仓库根新增 `README.md`（默认中文），含 6 个必备章节：项目简介、核心特性、技术栈、常用命令、文档入口、协作流程（Issue 驱动 + pipe）。
- README 内容与既有定稿一致（`docs/V1-PRD.md`、`docs/design/design.md`、`.claude/CLAUDE.md` 的关键事实不冲突、不夸大）。
- 文档链接真实可达：`docs/V1-PRD.md`、`docs/design/design.md` 用仓库相对路径链接。

**Non-Goals:**
- 不写英文 README / 双语 README（V1 沟通与 UI 全中文，README 默认中文）。
- 不补 `CONTRIBUTING.md`、`LICENSE`、`CHANGELOG` 等其他仓库基建文件（属 Epic「项目基建初始化」其他子变更或后续变更范围）。
- 不引入文档工具链（如 docusaurus/vitepress）：README 是纯 Markdown 静态文件，不建站点、不加依赖。
- 不写徽章（CI badge 等）：CI 子变更（`infra-ci`）落地后再决定是否加。

## 变更域判定

**docs（纯文档）**。不涉及 Rust、不涉及 Vue、不涉及构建配置，无契约改动，无依赖。

## Decisions

### D1 README 语言与风格
- 默认中文撰写；技术术语（`Tauri 2`、`lofty`、`cargo`、`npm`、`FLAC/MP3`、Issue、PR）保留英文原文。
- 风格：简洁的速览文档——先讲清楚「这是什么、给谁用、怎么跑、文档在哪、怎么协作」，不堆砌实现细节；细节一律指回 `docs/V1-PRD.md` 与 `docs/design/design.md`。

### D2 README 必备章节（与 spec 一一对应）
README 采用 `##` 章节标题，6 个必备章节：

1. **项目简介**：工具线 · 自用 · 纯本地取向；一次一首地给本地裸 FLAC/MP3 补全元数据（歌名、作者、专辑、封面、歌词）；目标播放器：自研播放器 + Slat Player。
2. **核心特性**（条目式，简述 V1 关键能力，不展开）：
   - 一次一首，无批量编辑；
   - 选中即搜：仅对缺失的歌词/封面自动联网搜索（网易云 + QQ + 咪咕三源并发聚合），已有则不搜；
   - 结果不自动写盘：候选列表展示、手动点选才填入，切歌即弃；
   - 保存 = 表单全量覆盖：填了就存、不填即清空删除；直接写盘（无备份、无撤销）；
   - 离线降级：全源失败后仅留手动搜索。
3. **技术栈**：外壳 Tauri 2 + Rust；标签读写 lofty（MP3 写 ID3v2.4、FLAC Vorbis LYRICS/PICTURE、MP3 USLT/APIC）；前端 Vue 3 + Vite + TypeScript（`<script setup>`，单 store 不用 Pinia）。
4. **常用命令**（含注释说明 manifest 路径）：
   - 前端：`npm run dev` / `npm run build`
   - 外壳：`npm run tauri dev` / `npm run tauri build`
   - 后端：`cargo check --manifest-path src-tauri/Cargo.toml` / `cargo test --manifest-path src-tauri/Cargo.toml` / `cargo clippy`
5. **文档入口**：`docs/V1-PRD.md`（产品需求，含验收标准）、`docs/design/design.md`（技术设计，含 Tauri command 契约 §10）。
6. **协作流程**：Issue 驱动（任何变更动手前先建 GitHub Issue 作为锚点，PR 描述引用 `Closes #<issue>`）+ pipe 工作流（`/pipe <name>` 一键全自动闭环：前置校验 → 设计 → 开发 → 测试 → CR → 最终验证 → 归档 → PR → 合并）。

### D3 事实来源与一致性
- 命令、技术栈、项目定位从 `.claude/CLAUDE.md`、`openspec/config.yaml`、`docs/V1-PRD.md`、`docs/design/design.md` 抽取，不新造事实。
- 若 README 与上述文档存在表述差异，以 `docs/V1-PRD.md`、`docs/design/design.md`（定稿权威）为准；写 README 前先核对这两份文档。

### D4 链接策略
- `docs/V1-PRD.md`、`docs/design/design.md` 用**仓库相对路径** Markdown 链接（`[docs/V1-PRD.md](docs/V1-PRD.md)`），保证 GitHub 页面可直接跳转。
- 不引用 `.claude/` 内部文件（CLAUDE.md 属 Agent 配置，非对外文档）。

### D5 不引入构建/检查
- README 是纯 Markdown 静态文件，不改 `package.json`、`Cargo.toml`、CI 配置；无测试（纯文档）。

## Risks / Trade-offs

- **文档漂移**：README 是手写快照，规格/命令变更后可能过时。**缓解**：README 对细节只做「指路」不复制全文，改动集中在 `docs/` 时只需检查链接与章节存留；后续子变更 CR 时如涉及命令/文档入口变化，顺手核对 README。
- **信息重复**：README 与 `.claude/CLAUDE.md`、`openspec/config.yaml` 有部分重叠（技术栈、命令）。**权衡**：README 面向「仓库第一屏」的读者，配置类文件面向 Agent 工作流，受众不同，保留适度重叠是刻意的（README 是最小速览，配置是完整规则）。
- **语言单一**：只写中文 README，非中文读者体验打折。**权衡**：工具线 · 自用定位 + 全中文沟通约定，V1 不做英文版；如将来开源需要再加。

## 任务拆分建议

依赖顺序：**单文件任务 → 验证**（变更域 docs，无先后端依赖，无 worktree 需要）。

1. **创建 `README.md`**（design.md D2）：
   - 写项目简介 + 核心特性 + 技术栈（D2 第 1–3 节）；
   - 写常用命令（含 `src-tauri/Cargo.toml` manifest 路径，D2 第 4 节）；
   - 写文档入口（`docs/V1-PRD.md`、`docs/design/design.md` 相对链接，D2 第 5 节）；
   - 写协作流程（Issue 驱动 + pipe，D2 第 6 节）。
2. **验证**：
   - 检查 `README.md` 存在、全中文、含 6 个必备章节（对应 spec 各 requirement）；
   - 核对命令与 `package.json`/`Cargo.toml` script 一致；
   - 核对 `docs/V1-PRD.md`、`docs/design/design.md` 两个链接目标真实存在。
   - 无自动化测试（纯文档，不跑 cargo/npm 测试）。
