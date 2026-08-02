## Why

列表只给了 `SongSummary`，用户选中一首后需要 `open_song` 读全量标签并渲染到右栏编辑表单，且要满足「按需读取」——只有选中时才读完整标签+封面。同时要建立 `current`/`original`/`dirty` 编辑状态模型，并保证坏标签只读不误写。

## What Changes

- 新增 Rust command `open_song(path) -> Song`：读一首的完整标签（10 字段 + 歌词 + 封面 base64 data URL + `lyrics_source`）。读标签失败 → 返回错误，前端表单只读禁用并提示「标签损坏，只读」。
- 定义完整 `Song` struct（`path`/`title`/`artist`/`album`/`album_artist`/`track`/`track_total`/`year`/`genre`/`lyrics`/`lyrics_source`/`cover`/`cover_mime`），封面跨 IPC 用 base64 data URL。
- 前端 store 落 `SongEditor { current, original, dirty }`：选中一行 → `open_song` 读全量 → 渲染右栏表单（10 字段 + 封面 + 歌词，先只读展示，可编辑性随 v1-song-save 的保存语义）；`dirty` 由 current/original 对比 computed。
- 字段行/封面区/歌词区的基础展示组件（FieldRow、FieldList、CoverPanel、LyricPanel 骨架）。

## Capabilities

### New Capabilities
- `song-open`: 选中歌曲读取完整标签渲染编辑表单 + 编辑状态模型（current/original/dirty）+ 坏标签只读

### Modified Capabilities
（无）

## Impact

- 新增 Rust 依赖：`lofty`（读标签 + 封面）、`image`（封面读 bytes）、`base64`。
- 契约落点：本变更定义完整 `Song` struct（含 `lyrics_source` 枚举、`cover` base64）与 `open_song` 签名；`SongSummary` 由 `v1-folder-list` 提供。
- `lyrics_source`（Embedded/SidecarLrc/None）的侧载 `.lrc` 关联读由 `v1-lyrics-lrc` 增强，本变更先落枚举与内嵌判定。
