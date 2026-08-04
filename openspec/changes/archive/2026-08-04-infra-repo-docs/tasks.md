# infra-repo-docs 任务清单

> 依赖顺序：单任务 → 验证（变更域 docs，纯文档，无前后端依赖）。README 是根目录静态 Markdown，内容对照 `docs/V1-PRD.md`、`docs/design/design.md`、`.claude/CLAUDE.md` 事实来源，不新造事实。

## 1. 创建根 README.md（design.md D2）

- [ ] 1.1 在仓库根创建 `README.md`（默认中文），写「项目简介」：工具线 · 自用 · 纯本地取向；一次一首地给本地裸 FLAC/MP3 补全元数据（歌名、作者、专辑、封面、歌词）；目标播放器说明
- [ ] 1.2 写「核心特性」条目：一次一首（无批量）、选中即搜（网易云+QQ+咪咕三源并发聚合、仅补缺失、已有不搜）、结果不自动写盘（列表点选、切歌即弃）、保存 = 表单全量覆盖（填了就存、不填即清空删除、直接写盘无备份无撤销）、离线降级
- [ ] 1.3 写「技术栈」：Tauri 2 + Rust、lofty 标签读写（MP3 ID3v2.4 / FLAC Vorbis LYRICS、MP3 USLT、封面 PICTURE/APIC）、Vue 3 + Vite + TypeScript（`<script setup>`、单 store 不用 Pinia）
- [ ] 1.4 写「常用命令」：前端 `npm run dev`/`npm run build`、外壳 `npm run tauri dev`/`npm run tauri build`、后端 `cargo check --manifest-path src-tauri/Cargo.toml`/`cargo test --manifest-path src-tauri/Cargo.toml`/`cargo clippy`
- [ ] 1.5 写「文档入口」：`docs/V1-PRD.md`（产品需求，含验收标准）、`docs/design/design.md`（技术设计），用仓库相对路径链接
- [ ] 1.6 写「协作流程」：Issue 驱动（任何变更动手前先建 GitHub Issue 作为锚点、PR 描述引用 `Closes #<issue>`）+ pipe 工作流（`/pipe <name>` 一键全自动：前置校验→设计→开发→测试→CR→最终验证→归档→PR→合并）

## 2. 验证

- [ ] 2.1 检查：仓库根存在 `README.md`，正文全中文，含 6 个必备章节（项目简介/核心特性/技术栈/常用命令/文档入口/协作流程）
- [ ] 2.2 核对：常用命令与 `package.json`（scripts）+ `Cargo.toml` 的 script 一致；`docs/V1-PRD.md`、`docs/design/design.md` 链接目标真实存在
- [ ] 2.3 无测试：README 为纯文档，测试标注「无（纯文档）」：不运行 cargo/npm 测试、不引入构建依赖