## Context

`v1-folder-list` 已提供 `SongSummary` 与左栏列表。本变更实现「选中 → `open_song` 读全量 → 渲染表单」与编辑状态模型。

## Goals / Non-Goals

**Goals:**
- `open_song(path) -> Song`：读全量标签 + 封面 base64；坏标签返回错误。
- store 落 `SongEditor { current, original, dirty }`，`dirty` computed 对比。
- 编辑表单组件骨架（字段列 + 封面区 + 歌词区），本变更先渲染只读/可编辑展示。

**Non-Goals:**
- 不做保存写回（`v1-song-save`）。
- 不做 `.lrc` 侧载关联读（`v1-lyrics-lrc`，本变更先落 `lyrics_source` 内嵌判定）。
- 不做封面嵌入（`v1-cover-embed`）。

## Decisions

- **`Song` struct 契约落点**：本变更定义完整 `Song`：
  ```rust
  struct Song {
    path: String,
    title: String, artist: String, album: String, album_artist: String,
    track: String, track_total: String, year: String, genre: String,
    lyrics: String,
    lyrics_source: LyricsSource,   // Embedded | SidecarLrc | None
    cover: Option<String>,         // base64 data URL
    cover_mime: Option<String>,
  }
  ```
- **字段映射（读）**：FLAC→Vorbis（TITLE/ARTIST/ALBUM/ALBUMARTIST/TRACKNUMBER/TRACKTOTAL/DATE/GENRE/LYRICS），MP3→ID3v2（TIT2/TPE1/TALB/TPE2/TRCK/TDRC/TCON/USLT），封面 FLAC→PICTURE / MP3→APIC。未设置字段读为空串（PRD §6 数据结构草案）。
- **封面 IPC**：`cover: Option<Vec<u8>>` 序列化为 base64 data URL（`data:<mime>;base64,...`），前端 `<img :src>` 直接用（design.md §10.3）。`cover_mime` 由 `image` 探测格式得出。
- **坏标签**：`open_song` 返回 `Result<Song, String>`；lofty 读取失败 → Err。前端捕获 Err → 表单 `readonly` 禁用 + 提示「标签损坏，只读」（FR-5.7）。
- **`lyrics_source`**：本变更先做「内嵌歌词非空 → Embedded，否则 None」；`.lrc` 侧载检测（同目录同名）由 `v1-lyrics-lrc` 补。
- **store**：`store/song.ts` 持 `current: Song | null`、`original: Song | null`；`dirty` 为 computed（逐字段对比）。切歌时如果 `dirty` 需确认——确认弹窗由 `v1-ux-settings` 统一，本变更只提供 store 状态与「未保存修改」判定能力。

## Risks / Trade-offs

- 封面 bytes 经 IPC 传输：单首封面 ≤2048×2048 压缩后通常 <2MB，base64 膨胀约 33%，可接受（一次只编辑一首）。
- 读损坏标签的边界：lofty 对结构严重损坏文件返回 Err，走只读路径；轻微异常字段返回空串，不阻塞表单。
