// MusicTag — 领域模型（纯 serde 契约，无业务逻辑）。
//
// 跨 IPC 的 Rust/TS 契约形状在此冻结（design.md §10.1）：字段逐字保留
// `rename_all`/snake_case/`#[serde(rename="sidecar")]` 注解，任何改动都会
// 破坏前端 `src/api/types.ts` 与集成测试的序列化断言。

use serde::{Deserialize, Serialize};

/// 只读列表项。字段均 `String`，Rust 侧不 trim。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SongSummary {
    pub path: String,
    pub title: String,
    pub artist: String,
}

/// 歌词来源（design.md D1 契约形状：`"embedded" | "sidecar" | "none"`）。
///
/// serde 默认会把 enum 序列化成 `{"Embedded":null}` 对象形状，破坏 TS 契约，
/// 必须逐变体 rename 对齐 `src/api/types.ts` 的字面量。`SidecarLrc` 若只依赖
/// `rename_all = "snake_case"` 会得到 `"sidecar_lrc"`，故显式 `rename = "sidecar"`。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LyricsSource {
    Embedded,
    #[serde(rename = "sidecar")]
    SidecarLrc,
    None,
}

/// 完整标签（open_song 返回 / save_song 提交）。字段与 TS `Song` 契约逐项对齐。
///
/// - 文本字段一律 `String`，未设置读空串（PRD §6），Rust 侧不 trim。
/// - `cover` 为 base64 data URL（`data:<mime>;base64,...`），前端 `<img :src>` 直接用。
/// - `lyrics_source` 本变更只落内嵌判定（trim 非空 → Embedded，否则 None）；
///   `SidecarLrc` 由 v1-lyrics-lrc 补充。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Song {
    pub path: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub album_artist: String,
    pub track: String,
    pub track_total: String,
    pub year: String,
    pub genre: String,
    pub lyrics: String,
    pub lyrics_source: LyricsSource,
    pub cover: Option<String>,
    pub cover_mime: Option<String>,
}

/// 封面选择/拖拽输入（`pick_cover_file` / `read_cover_path` 返回，v1-cover-embed）。
///
/// 字段与 TS `CoverInput` 契约逐字对齐（`src/api/types.ts`）：
/// - `data_url`：压缩后小图的 base64 data URL（`data:<mime>;base64,...`），
///   直接进 `Song.cover`（`<img :src>` 同形状，前端零转换，design.md §10.3 / D1）；
/// - `mime`：`image/jpeg | image/png | image/webp`，供 `cover_mime` 展示。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoverInput {
    pub data_url: String,
    pub mime: String,
}

/// 搜索来源（design.md §10.3 契约形状：`"netease" | "qqmusic" | "kugou" | "lrclib" | "itunes"`，
/// v1-search-backend / search-sources-renewal 五源）。
///
/// serde 默认会把 enum 序列化成 `{"Netease":null}` 对象形状，且 `rename_all = "snake_case"`
/// 会把 `QqMusic` 序列化成 `"qq_music"`（≠ 前端 TS 字面量 `'qqmusic'`），必须显式
/// `#[serde(rename = "qqmusic")]` —— 与 `LyricsSource::SidecarLrc` 显式 `rename = "sidecar"` 同款教训。
/// `Kugou`/`Lrclib`/`Itunes` 在 snake_case 下自动映射 `"kugou"|"lrclib"|"itunes"`，无需显式 rename。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MusicSourceId {
    Netease,
    #[serde(rename = "qqmusic")]
    QqMusic,
    Kugou,
    Lrclib,
    Itunes,
}

/// 搜索候选（design.md §10.3 契约，v1-search-backend）。
///
/// 惰性拉取：候选只带 `id` + `cover_url`（随三家搜索响应带出），歌词文本 / 封面字节
/// 点选后才 `fetch_lyric` / `download_cover`。无 `year` 字段（§10.3 TS 未定义）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SongCandidate {
    pub source: MusicSourceId,
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub cover_url: Option<String>,
}

/// 五源并发搜索结果（design.md §10.3 契约，v1-search-backend / v1-search-fixes / search-sources-renewal）。
///
/// `source_stats` 元组序列化为 `[source, count]` 数组，对齐 TS
/// `Array<[MusicSourceId, number]>`（各家成功返回的候选条数，失败/超时记 0）。
/// `all_failed`：五源**全部失败**（网络错误/超时）→ true；至少一源成功（含正常空结果）→
/// false。前端仅在 `all_failed` 时判定会话离线（FR-8.4a「全部源失败」——冷门歌正常空结果不标离线）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub songs: Vec<SongCandidate>,
    pub source_stats: Vec<(MusicSourceId, usize)>,
    pub all_failed: bool,
}
