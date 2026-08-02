## Context

`v1-song-save` 已实现 cover base64 → 原始字节 → PICTURE/APIC 写回通道。本变更补齐封面嵌入交互与压缩，统一「获得 bytes → 封面区」路径。

## Goals / Non-Goals

**Goals:**
- 封面区点击选择（rfd 文件对话框）与拖拽嵌入。
- >5MB 图片等比压缩至 ≤2048×2048（`image` crate）。
- 封面区预览压缩后小图，`save_song` 统一嵌入。

**Non-Goals:**
- 不实现网络封面下载（`v1-search-backend`）。
- 不实现封面候选网格（`v1-search-ui`）。

## Decisions

- **交互入口**：
  - 点击封面区 → Rust command `pick_cover_file() -> Option<(bytes_base64, mime)>`（rfd 文件对话框，过滤器 jpg/png/webp）。
  - 拖拽 → 前端 dragover/drop 拿 File → FileReader 读 base64 → 走同一「获得 bytes → 封面区」路径。
- **压缩策略**：`image` 解码 → 若任一边 >2048 则等比缩放至 ≤2048 → 按原 mime 编码（jpeg→jpeg，png→png）。压缩失败静默保留原 bytes（不阻塞嵌入）。
- **预览态**：封面区持 `coverPreview: { dataUrl, mime }`，即压缩后小图；`save_song` 时随 Song.cover 传递 base64，Rust 解码嵌入。
- **删除封面**：封面区提供清空操作（置 null），保存后该字段清空删除（配合 `v1-song-save` 全量覆盖语义）。

## Risks / Trade-offs

- 压缩会丢原图（进标签的是压缩图）——符合 PRD §5.3 决策 A：预览即压缩后图，原图丢弃。
- 拖拽路径依赖 WebView 的 FileReader；Tauri 下用 `drop` 事件读取本地文件路径再经 Rust 读 bytes，可避开 WebView 安全限制。
