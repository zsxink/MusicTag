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

/// 搜索来源（design.md §10.3 契约形状：`"netease" | "qqmusic" | "migu"`，v1-search-backend）。
///
/// serde 默认会把 enum 序列化成 `{"Netease":null}` 对象形状，且 `rename_all = "snake_case"`
/// 会把 `QqMusic` 序列化成 `"qq_music"`（≠ 前端 TS 字面量 `'qqmusic'`），必须显式
/// `#[serde(rename = "qqmusic")]` —— 与 `LyricsSource::SidecarLrc` 显式 `rename = "sidecar"` 同款教训。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MusicSourceId {
    Netease,
    #[serde(rename = "qqmusic")]
    QqMusic,
    Migu,
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

/// 三源并发搜索结果（design.md §10.3 契约，v1-search-backend）。
///
/// `source_stats` 元组序列化为 `[source, count]` 数组，对齐 TS
/// `Array<[MusicSourceId, number]>`（各家成功返回的候选条数，失败/超时记 0，供前端离线判定）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub songs: Vec<SongCandidate>,
    pub source_stats: Vec<(MusicSourceId, usize)>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summary_serializes_to_contract_shape() {
        let s = SongSummary {
            path: "p".into(),
            title: "t".into(),
            artist: "a".into(),
        };
        let json = serde_json::to_string(&s).unwrap();
        assert_eq!(json, r#"{"path":"p","title":"t","artist":"a"}"#);
    }

    #[test]
    fn lyrics_source_serializes_to_contract_shape() {
        // 契约形状冻结（design.md D1）：embedded / sidecar / none。
        // 杜绝 `{"Embedded":null}` 对象形状与 `"sidecar_lrc"`。
        let embedded = Song {
            path: "p".into(),
            title: "t".into(),
            artist: "a".into(),
            album: String::new(),
            album_artist: String::new(),
            track: String::new(),
            track_total: String::new(),
            year: String::new(),
            genre: String::new(),
            lyrics: String::new(),
            lyrics_source: LyricsSource::Embedded,
            cover: None,
            cover_mime: None,
        };
        let json = serde_json::to_string(&embedded).unwrap();
        assert!(
            json.contains(r#""lyrics_source":"embedded""#),
            "Embedded 应序列化为 embedded，实际: {json}"
        );

        let sidecar = Song {
            lyrics_source: LyricsSource::SidecarLrc,
            ..embedded
        };
        let json = serde_json::to_string(&sidecar).unwrap();
        assert!(
            json.contains(r#""lyrics_source":"sidecar""#),
            "SidecarLrc 应序列化为 sidecar（显式 rename），实际: {json}"
        );
        assert!(!json.contains("sidecar_lrc"), "不得出现 sidecar_lrc");
        assert!(!json.contains("SidecarLrc"), "不得出现 Rust 变体名");

        let none = Song {
            lyrics_source: LyricsSource::None,
            ..sidecar
        };
        let json = serde_json::to_string(&none).unwrap();
        assert!(
            json.contains(r#""lyrics_source":"none""#),
            "None 应序列化为 none，实际: {json}"
        );
    }

    #[test]
    fn song_serializes_snake_case_cover_shape() {
        let song = Song {
            path: "p".into(),
            title: "t".into(),
            artist: "a".into(),
            album: "al".into(),
            album_artist: "aa".into(),
            track: "1".into(),
            track_total: "10".into(),
            year: "2000".into(),
            genre: "g".into(),
            lyrics: "l".into(),
            lyrics_source: LyricsSource::None,
            cover: Some("data:image/png;base64,AAAA".into()),
            cover_mime: Some("image/png".into()),
        };
        let json = serde_json::to_string(&song).unwrap();
        // 断言全字段 snake_case 契约形状（与 src/api/types.ts 对齐）
        assert!(
            json.contains(r#""album_artist":"aa""#),
            "album_artist 应为 snake_case: {json}"
        );
        assert!(json.contains(r#""track_total":"10""#));
        assert!(json.contains(r#""lyrics_source":"none""#));
        assert!(json.contains(r#""cover":"data:image/png;base64,AAAA""#));
        assert!(json.contains(r#""cover_mime":"image/png""#));
    }

    #[test]
    fn cover_input_serializes_to_contract_shape() {
        // 契约形状冻结（design.md D1 / §10.3）：data_url + mime，与 src/api/types.ts 逐字对齐。
        let input = CoverInput {
            data_url: "data:image/jpeg;base64,AAAA".into(),
            mime: "image/jpeg".into(),
        };
        let json = serde_json::to_string(&input).unwrap();
        assert_eq!(
            json,
            r#"{"data_url":"data:image/jpeg;base64,AAAA","mime":"image/jpeg"}"#
        );
    }

    #[test]
    fn music_source_id_serializes_to_contract_shape() {
        // 契约形状冻结（design.md D6）：netease / qqmusic / migu 字面量。
        // 杜绝 `{"Netease":null}` 对象形状与 `"qq_music"`（snake_case 陷阱，同 SidecarLrc 教训）。
        assert_eq!(
            serde_json::to_string(&MusicSourceId::Netease).unwrap(),
            r#""netease""#
        );
        assert_eq!(
            serde_json::to_string(&MusicSourceId::QqMusic).unwrap(),
            r#""qqmusic""#,
            "QqMusic 必须显式 rename 为 qqmusic，不得出现 qq_music"
        );
        assert_eq!(
            serde_json::to_string(&MusicSourceId::Migu).unwrap(),
            r#""migu""#
        );
        // 反序列化对称
        assert_eq!(
            serde_json::from_str::<MusicSourceId>(r#""qqmusic""#).unwrap(),
            MusicSourceId::QqMusic
        );
        assert_eq!(
            serde_json::from_str::<MusicSourceId>(r#""netease""#).unwrap(),
            MusicSourceId::Netease
        );
        assert_eq!(
            serde_json::from_str::<MusicSourceId>(r#""migu""#).unwrap(),
            MusicSourceId::Migu
        );
    }

    #[test]
    fn song_candidate_serializes_to_contract_shape() {
        // 契约形状冻结（design.md §10.3）：字段名与 TS SongCandidate 逐字对齐。
        let c = SongCandidate {
            source: MusicSourceId::QqMusic,
            id: "004D3pK90wGyM2".into(),
            title: "晴天".into(),
            artist: "周杰伦".into(),
            album: "叶惠美".into(),
            cover_url: Some(
                "http://y.qq.com/music/photo_new/T002R300x300M000004D3pK90wGyM2.jpg".into(),
            ),
        };
        let json = serde_json::to_string(&c).unwrap();
        assert!(
            json.contains(r#""source":"qqmusic""#),
            "source 应为 qqmusic 字面量，实际: {json}"
        );
        assert!(
            json.contains(r#""cover_url":""#),
            "cover_url 字段名应为 snake_case: {json}"
        );
        assert!(!json.contains("QqMusic"), "不得出现 Rust 变体名: {json}");
        let back: SongCandidate = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, c.id);
        assert_eq!(back.source, MusicSourceId::QqMusic);
    }

    #[test]
    fn search_result_source_stats_serializes_as_tuple_array() {
        // 契约形状冻结（design.md §10.3）：source_stats 元组 → `[[source, count], ...]` 数组，
        // 对齐 TS `Array<[MusicSourceId, number]>`。
        let r = SearchResult {
            songs: vec![],
            source_stats: vec![
                (MusicSourceId::Netease, 3),
                (MusicSourceId::QqMusic, 0),
                (MusicSourceId::Migu, 2),
            ],
        };
        let json = serde_json::to_string(&r).unwrap();
        assert!(
            json.contains(r#"source_stats":[["netease",3],["qqmusic",0],["migu",2]]"#),
            "source_stats 应序列化为 [source, count] 数组，实际: {json}"
        );
    }
}
