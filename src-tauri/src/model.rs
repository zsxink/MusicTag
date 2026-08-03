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
}
