## Why

读完标签渲染出表单后，用户要能把编辑结果写回原文件。V1 的保存语义是「表单全量覆盖」：填了就存、不填即清空删除；MP3 统一写 ID3v2.4；写失败必须保留内容可重试、绝不假报已保存。这是 V1 数据落盘的核心闭环。

## What Changes

- 新增 Rust command `save_song(song) -> Result<(), String>`：接收前端完整 `Song`（cover 为 base64 data URL），Rust 侧解码回 `Vec<u8>` 再写回**原路径**。
- 字段映射（PRD §5）：FLAC→Vorbis Comment，MP3→ID3v2.4（lofty 默认，勿用 `use_id3v23`）；空字段 = 清空删除（表单全量覆盖，无空字段保护）。
- MP3 用 `ItemKey::UnsyncLyrics` + `set_lang(ENGLISH)` 写 USLT；年份用 TDRC。
- 保存状态：顶栏 `dirty`（琥珀「有未保存的修改」）/ 保存中 / 成功（绿「✓ 已保存」）/ 失败（「✕ 保存失败：原因」）；失败时表单内容保留、可重试、`dirty` 保持 true。
- 编辑区撤销：恢复到打开时（`original`）的值，编辑区内撤销（非磁盘级）。
- 封面嵌入写盘（PICTURE/APIC 原始字节）也随 `save_song` 完成——本变更实现统一的 cover 写回，嵌入交互（点击/拖拽/压缩）由 `v1-cover-embed` 补。

## Capabilities

### New Capabilities
- `song-save`: 表单全量覆盖写回原文件 + 字段映射（FLAC/MP3）+ 保存状态 + 编辑区撤销

### Modified Capabilities
（无）

## Impact

- 新增 Rust 依赖：`base64`（解码 cover data URL）。
- 契约落点：`save_song(Song) -> Result<(), String>` 签名；`Song.cover` base64 → Rust 解码回 `Vec<u8>` 落盘（PRD §5.3「嵌入原始字节」指磁盘形式）。
- `v1-cover-embed`/`v1-lyrics-lrc`/`v1-rename-sync` 都以本变更的保存通道为基座。
