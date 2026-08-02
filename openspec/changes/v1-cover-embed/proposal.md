## Why

`v1-song-save` 已实现 cover 统一写回通道（base64 → 原始字节 → PICTURE/APIC），但封面嵌入的交互（点击选择 / 拖拽嵌入）与 >5MB 自动压缩尚未落地。本变更补齐封面区的完整交互：本地选择/拖拽 → 获得 bytes → 封面区预览（压缩后小图）→ 保存时嵌入。

## What Changes

- 封面区支持**点击选择图片**（系统文件选择器，`rfd` 文件对话框）与**拖拽嵌入**（前端 dragover/drop）。
- 嵌入前压缩：图片 >5MB 自动等比缩至 ≤2048×2048（`image` crate），避免元数据膨胀。
- **统一封面路径**：本地选择 / 网络下载（后续 `v1-search-backend`）统一为「获得 bytes → 封面区」，`save_song` 统一嵌入；封面区预览的就是压缩后小图，原图丢弃，进标签的是 ≤2048 压缩图。
- 新增 Rust command `pick_cover_file()`（`rfd` 文件对话框，返回图片 bytes + mime）；封面统一走「获得 bytes → 封面区 → `save_song` 嵌入」通道，**无独立 `embed_cover` command**（design.md §10.3 已定）；封面区预览状态由前端管理。

## Capabilities

### New Capabilities
- `cover-embed`: 封面区点击选择/拖拽嵌入 + 自动压缩（>2048 缩至 ≤2048×2048）+ 封面区预览

### Modified Capabilities
（无）

## 关联 Issue

- GitHub Issue：`#10`（变更前已建，作为本变更锚点；分支提交 `feat(10): ...`、PR `Closes #10`）

## Impact

- 新增 Rust 依赖：`image`（压缩，已在 v1-song-read 引入用于 mime 探测，此处扩展压缩能力）、`rfd`（文件选择，已引入）。
- 复用 `v1-song-save` 的 cover base64 → 原始字节 → PICTURE/APIC 写回通道，本变更只补交互与压缩。
- 后续 `v1-search-backend` 的 `download_cover` 结果同样走「获得 bytes → 封面区」统一路径。
