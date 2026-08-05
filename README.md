# MusicTag

## 项目简介

MusicTag 是一个跨平台桌面应用，为本地音乐文件补全元数据。

## 功能特性

- **支持格式**：FLAC / MP3
- **编辑音乐标签**：歌名、作者、专辑、专辑作者、音轨号、年份、流派
- **编辑封面**：点选或拖拽嵌入图片
- **编辑歌词**：内嵌歌词，可同时导出 .lrc
- **自动搜索**：选中歌曲后，对缺失的歌词与封面自动联网搜索（网易云、QQ 音乐、酷狗、LRCLIB、iTunes 多源并发），候选手动点选后写入

## 技术栈

- 外壳 **Tauri 2** + **Rust**
- 标签读写 **lofty**（MP3 写 ID3v2.4、FLAC Vorbis `LYRICS`/`PICTURE`、MP3 `USLT`/`APIC`）
- 前端 **Vue 3** + **Vite** + **TypeScript**（`<script setup>`，单 store 不用 Pinia）
- 其余：`image`（封面压缩）、`walkdir`（遍历）、`rfd`（对话框）、`reqwest` + `tokio`（搜索）、`aes`/`cbc`/`rsa`（网易云加密）

## 常用命令

```sh
# 前端
npm run dev              # 启动 Vite（浏览器态）
npm run build            # 前端构建（vue-tsc 类型检查 + vite build）

# 外壳（Tauri）
npm run tauri dev        # 起 Tauri 开发窗口
npm run tauri build      # 打包

# 后端（Rust，manifest 路径 src-tauri/Cargo.toml）
cargo check --manifest-path src-tauri/Cargo.toml
cargo test  --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml
```

## 文档入口

- [docs/V1-PRD.md](docs/V1-PRD.md) —— 产品需求文档（含验收标准，为定稿权威）
- [docs/design/design.md](docs/design/design.md) —— 技术设计（Tauri command 契约 §10、前端结构等）

新增/修改产品行为时，先同步这两份文档再动手改代码。

## 协作流程

- **Issue 驱动**：任何变更（新功能/规格/修复）动手前**必须先建 GitHub Issue** 作为锚点；PR 描述引用 `Closes #<issue>`，合并即自动关闭对应 Issue。
- **pipe 工作流**：`/pipe <name>` 一键全自动闭环——前置校验 → 设计 → 开发 → 测试 → CR → 最终验证 → 归档 → 提交 PR → 合并；唯一强制确认点是 PRD 批准。
