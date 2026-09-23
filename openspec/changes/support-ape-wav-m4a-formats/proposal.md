## Why

当前应用只收集与支持 `.flac` / `.mp3` 两种格式（`folder-list` 规格明确以二者为界，`.wav` 等被归为非音频忽略），用户本地音乐库中的 Monkey's Audio（`.ape`）、无损 `.wav` 与 Apple `.m4a`/`.mp4` 文件无法纳入列表、更无法补全歌词/封面。lofty 0.24 已原生支持这三种格式的标签读写，只需放开扩展名过滤并核对/补齐各 TagType 的字段映射，即可让这批文件获得与 FLAC/MP3 一致的编辑体验。来源：GitHub Issue #128。

## What Changes

- 收集范围扩展：`is_audio_file` 扩展名过滤从 `.flac`/`.mp3` 放宽至新增 `.ape`、`.wav`、`.m4a`（是否纳入 `.mp4` 在设计阶段实测定夺；大小写不敏感，与现状一致）。
- 读侧开箱支持：`open_song` 经 `Probe::open().read()` + `primary_tag()` 读取三种新格式的 10 字段 + 歌词 + 封面；坏标签仍走只读降级，行为不变。
- 写侧字段映射核对与补齐（`apply_meta` / `apply_lyrics` / `apply_cover` 按 TagType 分支）：
  - 歌词：APE 标签走 `ItemKey::Lyrics`（Vorbis 风格 item，需实测）；WAV 内嵌 ID3v2 走 USLT（与 MP3 同路径）；M4A `©lyr` 直接可用。
  - 封面：WAV→APIC、M4A→`covr`、APE→APE Cover Art（`push_picture` 支持需实测）。
  - 年份统一写 `RecordingDate`，核对 APE/M4A 的 item key 映射无遗漏。
- MP3/FLAC 既有行为不回归；MP3 仍写 ID3v2.4；APE 不写只读的 ID3v2（写侧仅作用于 APE 标签）。
- 文档同步：`docs/V1-PRD.md`（FR-1.3 扩展名、技术栈小节）、`docs/design/design.md` 格式分支说明。

不涉及：批量能力（V2 边界不变）、搜索源与选中即搜行为（格式无关，不改）、保存语义/直接写盘约束（全部沿用）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `folder-list`: 打开文件夹的收集范围从仅 `.flac`/`.mp3` 扩展为含 `.ape`/`.wav`/对应 m4a 扩展名（含「非音频忽略」场景改写：`.wav` 不再被忽略）。
- `song-save`: 「字段映射符合业界惯例」新增 APE/WAV/M4A 三种 TagType 的字段、歌词、封面映射要求与场景。
- `lyrics-lrc`: 「内嵌歌词读写」的写入映射从 FLAC/MP3 两种扩展为五种格式（新增 APE→`ItemKey::Lyrics`、WAV→USLT、M4A→`©lyr`）。
- `cover-embed`: 「统一封面路径」的嵌入目标从 PICTURE/APIC 扩展为按格式分派（含 M4A `covr`、APE Cover Art）。

## Impact

- 代码：`src-tauri/src/meta.rs`（`is_audio_file` 扩展名过滤）、`src-tauri/src/reader.rs`（读侧 primary tag 核对）、`src-tauri/src/meta.rs` `apply_meta`/`apply_lyrics`/`apply_cover`（写侧 TagType 分支）、对应 Rust 测试。
- 前端：预期零改动（格式差异收敛在 Rust 侧；封面仍走 base64 data URL）。
- 依赖：lofty 已具备三种格式能力，无新增依赖。
- 文档：`docs/V1-PRD.md`、`docs/design/design.md` 同步（拍板决策变更须先同步文档再改代码）。
- 关联 Issue：#128。
