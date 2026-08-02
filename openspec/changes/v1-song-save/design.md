## Context

`v1-song-read` 已定义完整 `Song` 与 `open_song` 读取，store 有 `current`/`original`/`dirty`。本变更实现保存写回闭环。

## Goals / Non-Goals

**Goals:**
- `save_song(song) -> Result<(), String>`：表单全量覆盖写回原路径。
- 字段映射符合 PRD §5：FLAC Vorbis / MP3 ID3v2.4。
- 保存状态机：dirty → saving → saved / save_failed。
- 编辑区撤销（current = original）。

**Non-Goals:**
- 不做封面嵌入交互/压缩（`v1-cover-embed`）。
- 不做 `.lrc` 写入与侧载（`v1-lyrics-lrc`）。
- 不做改名（`v1-rename-sync`）。
- 不做切歌三选一弹窗（`v1-ux-settings`，本变更只保证 dirty/保存状态正确）。

## Decisions

- **写回策略**：`save_song` 接收前端序列化的完整 `Song`，Rust 侧构造 lofty `Tag`：
  - 逐字段 set；空串字段**不 set**（lofty 中移除既有条目 = 清空删除）。实现「表单全量覆盖」语义。
  - cover：`Option<String>` base64 data URL → 解码回 `Vec<u8>`，探测 mime，FLAC→PICTURE（PictureType::CoverFront=3）/ MP3→APIC。
- **MP3 版本**：lofty 默认 ID3v2.4，**不调用 `use_id3v23`**（PRD §5.2 拍板）。USLT 用 `ItemKey::UnsyncLyrics` + `TagItem::set_lang(lofty::tag::items::ENGLISH)`。
- **年份**：MP3 写 `TDRC`（ID3v2.4 完整 ISO 时间），无需 TYER。
- **写失败不损坏原文件**：先校验格式，写前可考虑先写临时文件再替换（PRD §4 稳健）；写入失败返回 `Err(String)`，前端保留内容重试。
- **保存状态机（前端）**：`saveState: 'clean'|'dirty'|'saving'|'saved'|'save_failed'`。成功→saved（绿），失败→save_failed + 保留 current + dirty 保持 true。
- **撤销**：编辑区撤销按钮把 `current` 整体恢复为 `original` 深拷贝，`dirty` 归 false（非磁盘级，FR-5.3）。

## Risks / Trade-offs

- 「表单全量覆盖」是破坏性语义：误清空即删除。与 PRD 一致（改错认栽，无撤销写入），但保存成功前 UI 必须给足 dirty 提示。
- 写回原路径：写失败不得损坏原文件——用写临时文件 + rename 替换保证原子性；rename 撞名场景由 `v1-rename-sync` 处理（本变更不涉及改名）。
