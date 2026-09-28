# Design: WAV RIFF INFO 标签兼容修复

## 范围与结论

本变更属于 `backend` 域，修复范围限定在 WAV 标签读写和 Rust 集成测试。文件发现、Tauri command、Vue 表单、搜索、侧载歌词和其他容器的标签语义不变。

lofty 0.24 将 WAV 的 `primary_tag()` 定义为 ID3v2，同时把 RIFF INFO 暴露为 `TagType::RiffInfo`。当前实现只读取/清空 primary tag，因此 RIFF INFO-only WAV 会被当作空标签；保存时也不会把表单字段同步回已有 RIFF INFO。实现通过 `TaggedFileExt::tag(TagType::RiffInfo)` 做辅助标签读取和写入，继续以 ID3v2 承载 WAV 的完整应用字段。

## 标签优先级与字段边界

### 读取

对 WAV 读取时保留现有 ID3v2 主标签路径，并取得同一 `TaggedFile` 中的 RIFF INFO 标签。字段按字段回退：ID3v2 对某字段提供非空值时优先使用它；该字段为空或不存在时，再读取 RIFF INFO 的对应值。这样双标签文件不会被一套标签的缺失字段遮蔽，同时既有 ID3v2 数据仍是权威值。

RIFF INFO 仅能表示以下文本字段，按 lofty 的 `ItemKey` 映射读取：

| 表单字段 | RIFF INFO key | 备注 |
| --- | --- | --- |
| `title` | `INAM` / `TrackTitle` | 标题 |
| `artist` | `IART` / `TrackArtist` | 艺术家 |
| `album` | `IPRD` / `AlbumTitle` | 专辑 |
| `track` | `IPRT` 或 `ITRK` / `TrackNumber` | 沿用 lofty 映射及现有合串拆分 |
| `track_total` | `IFRM` / `TrackTotal` | 总音轨数 |
| `year` | `ICRD` / `RecordingDate` | 年份 |
| `genre` | `IGNR` / `Genre` | 流派 |

`album_artist`、歌词、封面及其来源信息没有 RIFF INFO 对应承载，始终只从/向 ID3v2 处理。年份继续沿用现有 `RecordingDate` 后 `Year` 兜底规则；歌词继续先读 `Lyrics` 后读 `UnsyncLyrics`，WAV 写入仍使用 ID3v2 USLT，封面仍使用 ID3v2 APIC。

### 写入

保存前记录原文件是否存在非空 RIFF INFO 标签。ID3v2 始终按当前全量覆盖流程清空后重建，并写入全部可表示字段、歌词和封面；因此即使输入是 RIFF INFO-only，保存后也会得到完整的 ID3v2 承载。

仅当原文件已有 RIFF INFO 标签时，才对该标签镜像本次表单中 RIFF INFO 可表示的七个字段。镜像前清空已有 RIFF INFO，再插入非空值；表单空值不插入，从而删除对应 RIFF INFO 项。不得因为 WAV 没有 RIFF INFO 而新建一个 RIFF INFO 标签，也不得把 album artist、歌词或封面伪写成自定义 RIFF INFO 项。ID3v2-only WAV 不产生 RIFF INFO；双标签 WAV 保留 RIFF INFO 的存在并同步可表示字段。

写回继续使用现有 `TaggedFile` 原子替换流程，并让 lofty 一次写出更新后的 ID3v2 和（若原有）RIFF INFO。保存失败时维持现有错误返回、原文件不变、表单 dirty 状态由上层保留的语义。

## 实现位置与数据流

1. `src-tauri/tests/common/mod.rs` 先增加/调整最小真实 WAV fixture：RIFF INFO-only、ID3v2-only、双标签和坏 WAV，并在任何业务断言前检查 fixture 可被 lofty 读取且标签形态符合预期。fixture 不引入新的生产依赖。
2. `src-tauri/src/service/reader.rs` 增加 WAV 专用辅助读取：识别 `TagType::RiffInfo`，对七个可表示字段逐项执行 ID3v2 非空优先、RIFF INFO 回退；其他格式继续使用原有通用读取路径。
3. `src-tauri/src/service/writer.rs` 在清空主标签前取得 WAV 原有 RIFF INFO 是否存在及其可写副本；完成现有 ID3v2 `apply_meta` 后，按上述边界清空并镜像 RIFF INFO，再交给既有原子写回。tagless WAV 不创建 RIFF INFO。
4. `src-tauri/src/service/meta.rs` 只抽取可复用的 RIFF INFO 字段映射/镜像辅助（如实现需要）；不得改变非 WAV 的 `apply_meta`、MP3 ID3v2.4 或歌词/封面分支。
5. `src-tauri/tests/open_song.rs`、`src-tauri/tests/save_song.rs` 增加场景断言；已有 FLAC/MP3/APE/M4A 测试保持原路径并继续作为回归证据。

## 验证策略

- fixture 早检：所有新 fixture 在业务测试开始前通过 `Probe::open(...).read()`，断言 WAV 文件类型、RIFF INFO/ID3v2 存在性；坏 WAV 断言读取失败且不会进入写回。
- RIFF INFO-only：打开时读出七个可表示字段；保存后 ID3v2 包含完整字段、歌词和封面，原有 RIFF INFO 仍存在且七个字段同步，空字段被删除。
- ID3v2-only：打开读取 ID3v2；保存不新建 RIFF INFO；完整字段、歌词、封面和空值清理均只验证 ID3v2。
- 双标签优先级：ID3v2 与 RIFF INFO 对同一字段设置不同值，确认 ID3v2 非空值胜出；仅 ID3v2 缺失的字段从 RIFF INFO 回退；保存后两者的可表示字段与表单一致。
- 坏 WAV：`read_song_meta` 和 `save_song` 均返回现有错误，不写文件。
- 既有格式回归：运行现有 Rust 测试，至少保留 MP3 ID3v2.4、USLT `eng`、FLAC/APE/M4A 往返断言。

建议验证顺序由主会话在 Dev/Tester 阶段执行：

```sh
cargo test --manifest-path src-tauri/Cargo.toml --test open_song --test save_song
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
npx openspec validate fix-wav-riff-info-tags --strict --no-interactive
```

## 风险与边界

- RIFF INFO 的标准映射不覆盖 album artist、歌词和封面；扩展这些字段需要另行规格，不在本变更中处理。
- 双标签的优先级是“ID3v2 对单字段非空即优先”，不是整套标签优先；这是为了让 RIFF INFO-only 的缺失字段仍可回退。
- 不修改 lofty 依赖版本，不引入手写 RIFF chunk 解析；若现有 lofty API 无法保留原 RIFF INFO 标签，应在 Dev 阶段报告 `NEEDS_PARENT_DECISION`，不得扩大为自定义容器重写。
