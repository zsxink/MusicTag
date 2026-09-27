# Design: APE、WAV、M4A 标签支持

## 范围与结论

本变更属于 `backend` 域，修改集中在 Rust 的 `service/meta.rs`、`service/reader.rs`、`service/writer.rs` 及文件发现入口，并补充 Rust 文件 I/O 集成测试。前端 command 契约和编辑流程不变，因此不需要 Vue 文件。

文件发现只纳入扩展名 `.ape`、`.wav`、`.m4a`，匹配大小写不敏感；继续保留 `.flac` 与 `.mp3`。Issue 中提到的 `.mp4` 不纳入本次收集范围：`.mp4` 是通用 MP4 容器扩展名，单靠扩展名无法可靠区分音频与视频；lofty 虽能解析其中的 MP4 音频容器，但把所有 `.mp4` 收入列表会改变产品的音频文件边界并可能展示视频文件。已批准 spec 的对象是 M4A，验收项也明确为 M4A 对应扩展名，因此实现和测试将把 `.mp4` 作为不收集项。若产品要支持通用 MP4，需另行明确视频排除或内容探测策略。

坏文件仍可进入列表摘要（摘要读取失败回退为空字段），打开或保存时沿用现有错误链路，触发只读降级；不增加批量扫描、自动写入或新的 Tauri command。

## lofty 0.24 格式与标签映射

`Probe::open(path).read()`、`primary_tag()` 和现有 `ItemKey` 访问方式继续作为唯一读写入口。lofty 0.24 的 primary tag 选择如下：

| 容器 | lofty `FileType` | primary `TagType` | 歌词写入 | 年份 | 封面 |
|---|---|---|---|---|---|
| APE | `Ape` | `Ape` | `ItemKey::Lyrics`，映射为 `Lyrics` | `ItemKey::RecordingDate`，映射为 `Year` | `ApeTag` 专用写入 `Cover Art (Front)` binary item；读取使用 `ApeFile` 专用 API |
| WAV | `Wav` | `Id3v2` | `ItemKey::UnsyncLyrics` + `lang=eng`，写 USLT | `ItemKey::RecordingDate`，写 TDRC | `push_picture` 写 ID3v2 APIC |
| M4A | `Mp4` | `Mp4Ilst` | `ItemKey::Lyrics`，映射为 `©lyr`（与 `UnsyncLyrics` 读取兼容） | `ItemKey::RecordingDate`，映射为 `©day` | `push_picture` 写 MP4 `covr` |

标题、作者、专辑、专辑作者、音轨号、音轨总数、流派继续使用 `TrackTitle`、`TrackArtist`、`AlbumTitle`、`AlbumArtist`、`TrackNumber`、`TrackTotal`、`Genre`，由 lofty 针对各 `TagType` 映射到 APE/WAV ID3v2/MP4 ilst 或现有 FLAC/MP3 标签。保存前清空 primary tag，再写入非空表单字段；空字段依靠 `clear()` 后不重新插入实现删除。lofty 0.24 的 generic `Tag` APE 转换不会把 APE 图片项放入 `Tag::pictures()`，因此写侧从已构建的 generic 表单 `Tag` 转成 `ApeTag`，在同目录临时副本上调用 `ApeTag::save_to`，随后原子替换原文件；其他格式继续使用 `TaggedFile::save_to`。读侧对 APE 使用 `ApeFile::read_from` 获取 `Cover Art (Front)` binary item，剥离描述分隔符后按图片字节探测 MIME。APE 只操作 `TagType::Ape`，不得创建或写入 ID3v2。

歌词分支保持现有规则：仅 `TagType::Id3v2` 使用 `UnsyncLyrics`/USLT，其余新增格式使用 `Lyrics`。读取先取 `Lyrics`，为空再取 `UnsyncLyrics`，所以 APE、WAV、M4A 与现有 FLAC/MP3 的读侧保持对称；侧载 `.lrc` 和 `LyricsSource` 不变。封面继续使用 `CoverFront` 和现有 data URL 解码，格式写入由 lofty primary tag 负责。

## 数据流与边界

1. `list_songs` 递归遍历，使用 `meta::is_audio_file` 做扩展名过滤；只读摘要字段。
2. `open_song` 通过现有 reader 读取 primary tag、歌词和第一张封面；任何 probe/read 错误仍返回错误，由前端沿用坏标签只读状态。
3. `save_song` 通过现有 writer 读取并校验文件；若有效容器没有 primary tag，则按 lofty 的 `primary_tag_type()` 创建对应空标签（APE/WAV/M4A 分别为 Ape/Id3v2/Mp4Ilst），随后清空并调用 `apply_meta`，再经既有原子写回；`.lrc` 导出顺序和失败语义不变。
4. 不改变路径改名、搜索、封面压缩、IPC 类型和 MP3 ID3v2.4 写入行为。

## 测试策略

- `meta::is_audio_file`：六种受支持扩展名的大小写变体均为 true，`.mp4`、非音频扩展名为 false。
- 列表集成测试：递归收集 APE/WAV/M4A 与 FLAC/MP3，确认摘要和排序输入不变；`.mp4` 被忽略。
- 三种新增格式的读写集成测试：构造有标签与无 primary tag 的有效 fixture，验证首次补标签、完整文本字段、年份、歌词和封面保存后重读一致；清空表单字段时确认相应标签项删除；同时检查 APE 结果没有 ID3v2，WAV/M4A 使用各自 primary tag。
- 现有 FLAC/MP3 测试继续运行，特别保留 MP3 ID3v2.4 断言。

验证命令由主会话在后续阶段执行：`cargo test --manifest-path src-tauri/Cargo.toml`、`cargo check --manifest-path src-tauri/Cargo.toml`，以及适用的前端 test/build 和 `openspec validate support-ape-wav-m4a-tags --strict --no-interactive`。

## 风险与回滚

- WAV 文件可能同时存在 RIFF INFO 与 ID3v2；本变更依赖 lofty 的 `primary_tag()` 约定（WAV primary 为 ID3v2），不自行合并两套标签。测试应覆盖该选择，避免应用层出现不一致的双写策略。
- APE/MP4 的字段映射由 lofty 0.24 的 `ItemKey` 表驱动；若 fixture 暴露某字段不支持，应在 `meta.rs` 做最小的格式分支修正，并保持字段全量覆盖契约。
- 写回仍走现有原子替换，因此变更失败时无需迁移或数据修复；回滚仅需撤销本变更文件和代码差异。
