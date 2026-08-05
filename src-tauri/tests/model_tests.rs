// MusicTag — 领域模型 serde 契约形状单测（rust-tests-separation 外置）。
//
// 跨 IPC 的 Rust/TS 契约在此冻结（design.md §10.1）：字段逐字保留
// `rename_all`/snake_case/`#[serde(rename="sidecar")]`/`#[serde(rename="qqmusic")]` 注解。
// 任何改动都会破坏前端 `src/api/types.ts` 与集成测试的序列化断言——本文件原样锁定。
// 访问被测类型经 `app_lib::model::`（Cargo.toml `[lib] name = "app_lib"`）。

mod common;

use app_lib::model::{CoverInput, LyricsSource, MusicSourceId, SearchResult, Song, SongCandidate, SongSummary};

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
    // 契约形状冻结（design.md D6 / search-sources-renewal D6）：netease / qqmusic / kugou /
    // lrclib / itunes 字面量。杜绝 `{"Netease":null}` 对象形状与 `"qq_music"`（snake_case
    // 陷阱，同 SidecarLrc 教训）。
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
        serde_json::to_string(&MusicSourceId::Kugou).unwrap(),
        r#""kugou""#
    );
    assert_eq!(
        serde_json::to_string(&MusicSourceId::Lrclib).unwrap(),
        r#""lrclib""#
    );
    assert_eq!(
        serde_json::to_string(&MusicSourceId::Itunes).unwrap(),
        r#""itunes""#
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
        serde_json::from_str::<MusicSourceId>(r#""kugou""#).unwrap(),
        MusicSourceId::Kugou
    );
    assert_eq!(
        serde_json::from_str::<MusicSourceId>(r#""lrclib""#).unwrap(),
        MusicSourceId::Lrclib
    );
    assert_eq!(
        serde_json::from_str::<MusicSourceId>(r#""itunes""#).unwrap(),
        MusicSourceId::Itunes
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
    assert!(
        !json.contains("lyric"),
        "候选不得携带歌词文本（惰性拉取：点选才 fetch_lyric），实际: {json}"
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
            (MusicSourceId::Kugou, 2),
            (MusicSourceId::Lrclib, 0),
            (MusicSourceId::Itunes, 1),
        ],
        all_failed: false,
    };
    let json = serde_json::to_string(&r).unwrap();
    assert!(
        json.contains(
            r#"source_stats":[["netease",3],["qqmusic",0],["kugou",2],["lrclib",0],["itunes",1]]"#
        ),
        "source_stats 应序列化为 [source, count] 数组，实际: {json}"
    );
    assert!(
        json.contains(r#""all_failed":false"#),
        "all_failed 应序列化（契约 v1-search-fixes），实际: {json}"
    );
    // 反序列化对称
    let back: SearchResult = serde_json::from_str(&json).unwrap();
    assert!(!back.all_failed);
}
