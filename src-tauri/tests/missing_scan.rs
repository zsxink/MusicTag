// MusicTag — 缺失字段只读扫描集成测试。
//
// 这些测试先锁定 Rust/IPC 契约和扫描语义，再由 service/command 实现通过。

mod common;

use app_lib::commands::missing::scan_missing as scan_missing_command;
use app_lib::model::{MissingField, MissingScanResult};
use app_lib::service::missing::scan_missing;
use common::{add_tags, tiny_png_bytes, write_tagged_flac, write_tagged_mp3};
use lofty::config::WriteOptions;
use lofty::prelude::{TagExt, TaggedFileExt};
use lofty::tag::{items::ENGLISH, ItemKey, ItemValue, TagItem};
use std::fs;
use tempfile::TempDir;

fn scan(dir: &TempDir, checks: &[MissingField]) -> MissingScanResult {
    scan_missing(dir.path(), checks).expect("测试目录扫描应成功")
}

#[test]
fn missing_field_contract_has_fixed_wire_names_and_order() {
    let checks = vec![
        MissingField::Lyrics,
        MissingField::Cover,
        MissingField::Album,
        MissingField::Artist,
        MissingField::Title,
    ];
    let json = serde_json::to_string(&checks).unwrap();
    assert_eq!(json, r#"["lyrics","cover","album","artist","title"]"#);

    let tmp = TempDir::new().unwrap();
    write_tagged_flac(tmp.path(), "ordered.flac", "  ", "Artist");
    let result = scan(&tmp, &checks);
    assert_eq!(
        result.songs[0].missing,
        vec![
            MissingField::Title,
            MissingField::Album,
            MissingField::Cover,
            MissingField::Lyrics
        ]
    );
}

#[test]
fn duplicate_checks_are_deduplicated_in_fixed_business_order() {
    let tmp = TempDir::new().unwrap();
    write_tagged_flac(tmp.path(), "duplicate-checks.flac", "  ", "Artist");

    let result = scan(
        &tmp,
        &[
            MissingField::Lyrics,
            MissingField::Title,
            MissingField::Lyrics,
            MissingField::Cover,
            MissingField::Album,
            MissingField::Title,
        ],
    );
    assert_eq!(
        result.songs[0].missing,
        vec![
            MissingField::Title,
            MissingField::Album,
            MissingField::Cover,
            MissingField::Lyrics,
        ]
    );
}

#[test]
fn scans_text_cover_and_lyrics_dimensions_with_or_semantics() {
    let tmp = TempDir::new().unwrap();
    write_tagged_flac(tmp.path(), "missing.flac", "  ", "Artist");
    write_tagged_flac(tmp.path(), "complete.flac", "Title", "Artist");
    add_tags(
        &tmp.path().join("complete.flac"),
        Some("embedded lyrics"),
        Some(tiny_png_bytes()),
    );

    let result = scan(
        &tmp,
        &[
            MissingField::Cover,
            MissingField::Lyrics,
            MissingField::Title,
            MissingField::Artist,
            MissingField::Album,
        ],
    );
    assert_eq!(result.errors, Vec::new());
    let missing = result
        .songs
        .iter()
        .find(|song| song.path.ends_with("missing.flac"))
        .expect("缺失文件应命中");
    assert_eq!(
        missing.missing,
        vec![
            MissingField::Title,
            MissingField::Album,
            MissingField::Cover,
            MissingField::Lyrics
        ]
    );
    assert!(
        result
            .songs
            .iter()
            .all(|song| !song.path.ends_with("complete.flac")),
        "完整歌曲不应命中"
    );

    let only_artist = scan(&tmp, &[MissingField::Artist]);
    assert!(only_artist.songs.is_empty(), "未选维度不得影响结果");
}

#[test]
fn cover_and_lyrics_selection_is_an_or_union_for_mixed_files() {
    let tmp = TempDir::new().unwrap();

    write_tagged_flac(tmp.path(), "cover-only.flac", "Title", "Artist");
    add_tags(
        &tmp.path().join("cover-only.flac"),
        None,
        Some(tiny_png_bytes()),
    );

    write_tagged_flac(tmp.path(), "lyrics-only.flac", "Title", "Artist");
    add_tags(
        &tmp.path().join("lyrics-only.flac"),
        Some("embedded lyrics"),
        None,
    );

    let result = scan(&tmp, &[MissingField::Cover, MissingField::Lyrics]);
    assert_eq!(result.errors, Vec::new());
    assert_eq!(result.songs.len(), 2);
    assert_eq!(
        result
            .songs
            .iter()
            .find(|song| song.path.ends_with("cover-only.flac"))
            .unwrap()
            .missing,
        vec![MissingField::Lyrics]
    );
    assert_eq!(
        result
            .songs
            .iter()
            .find(|song| song.path.ends_with("lyrics-only.flac"))
            .unwrap()
            .missing,
        vec![MissingField::Cover]
    );
}

#[test]
fn text_dimensions_treat_each_trimmed_blank_value_as_missing() {
    let tmp = TempDir::new().unwrap();
    write_tagged_flac(tmp.path(), "blank-title.flac", "  ", "Artist");
    write_tagged_flac(tmp.path(), "blank-artist.flac", "Title", "\t");
    write_tagged_flac(tmp.path(), "blank-album.flac", "Title", "Artist");

    let title_result = scan(&tmp, &[MissingField::Title]);
    assert_eq!(
        title_result
            .songs
            .iter()
            .find(|song| song.path.ends_with("blank-title.flac"))
            .unwrap()
            .missing,
        vec![MissingField::Title]
    );

    let artist_result = scan(&tmp, &[MissingField::Artist]);
    assert_eq!(
        artist_result
            .songs
            .iter()
            .find(|song| song.path.ends_with("blank-artist.flac"))
            .unwrap()
            .missing,
        vec![MissingField::Artist]
    );

    let album_result = scan(&tmp, &[MissingField::Album]);
    assert!(album_result.songs.iter().all(|song| {
        song.missing == vec![MissingField::Album]
            && (song.path.ends_with("blank-title.flac")
                || song.path.ends_with("blank-artist.flac")
                || song.path.ends_with("blank-album.flac"))
    }));
    assert_eq!(album_result.songs.len(), 3);
}

#[test]
fn embedded_mp3_lyrics_and_sidecar_lrc_are_not_missing() {
    let tmp = TempDir::new().unwrap();
    write_tagged_mp3(tmp.path(), "embedded.mp3", "Title", "Artist");
    add_tags(
        &tmp.path().join("embedded.mp3"),
        Some("[00:00.00]embedded"),
        None,
    );

    write_tagged_flac(tmp.path(), "sidecar.flac", "Title", "Artist");
    fs::write(tmp.path().join("sidecar.lrc"), b"[00:00.00]sidecar").unwrap();
    let sidecar_audio_before = fs::read(tmp.path().join("sidecar.flac")).unwrap();
    let sidecar_lrc_before = fs::read(tmp.path().join("sidecar.lrc")).unwrap();

    write_tagged_flac(tmp.path(), "empty.flac", "Title", "Artist");
    let result = scan(&tmp, &[MissingField::Lyrics]);
    assert!(result.songs.iter().all(|song| {
        !song.path.ends_with("embedded.mp3") && !song.path.ends_with("sidecar.flac")
    }));
    assert!(result
        .songs
        .iter()
        .any(|song| song.path.ends_with("empty.flac")));
    assert_eq!(
        fs::read(tmp.path().join("sidecar.flac")).unwrap(),
        sidecar_audio_before
    );
    assert_eq!(
        fs::read(tmp.path().join("sidecar.lrc")).unwrap(),
        sidecar_lrc_before
    );
}

#[test]
fn any_non_empty_lyrics_frame_satisfies_lyrics_check() {
    let tmp = TempDir::new().unwrap();
    let path = tmp.path().join("duplicate-lyrics.mp3");
    write_tagged_mp3(tmp.path(), "duplicate-lyrics.mp3", "Title", "Artist");

    let mut file = lofty::read_from_path(&path).unwrap();
    let tag = file.primary_tag_mut().unwrap();

    let mut empty = TagItem::new(ItemKey::UnsyncLyrics, ItemValue::Text(String::new()));
    empty.set_lang(ENGLISH);
    tag.push(empty);

    let mut non_empty = TagItem::new(
        ItemKey::UnsyncLyrics,
        ItemValue::Text("non-empty lyrics".to_string()),
    );
    non_empty.set_lang(ENGLISH);
    tag.push(non_empty);
    tag.save_to_path(&path, WriteOptions::default()).unwrap();

    let result = scan(&tmp, &[MissingField::Lyrics]);
    assert!(
        result
            .songs
            .iter()
            .all(|song| song.path != path.to_string_lossy()),
        "只要存在一个非空歌词帧，就不应判定为缺歌词"
    );
}

#[test]
fn empty_checks_return_empty_result_without_touching_files() {
    let tmp = TempDir::new().unwrap();
    write_tagged_flac(tmp.path(), "song.flac", "", "");
    let audio_before = fs::read(tmp.path().join("song.flac")).unwrap();

    let result = scan(&tmp, &[]);

    assert_eq!(
        result,
        MissingScanResult {
            songs: vec![],
            errors: vec![]
        }
    );
    assert_eq!(
        fs::read(tmp.path().join("song.flac")).unwrap(),
        audio_before
    );
}

#[test]
fn corrupt_file_is_reported_and_other_songs_continue() {
    let tmp = TempDir::new().unwrap();
    fs::write(tmp.path().join("broken.mp3"), b"not an mp3").unwrap();
    write_tagged_flac(tmp.path(), "valid.flac", "", "Artist");

    let result = scan(&tmp, &[MissingField::Title]);

    assert!(result
        .songs
        .iter()
        .any(|song| song.path.ends_with("valid.flac")));
    assert!(result
        .songs
        .iter()
        .all(|song| !song.path.ends_with("broken.mp3")));
    assert!(result
        .errors
        .iter()
        .any(|error| error.path.ends_with("broken.mp3")));
    assert!(result.errors.iter().all(|error| !error.reason.is_empty()));
}

#[test]
fn result_serializes_without_full_song_payload() {
    let result = MissingScanResult {
        songs: vec![app_lib::model::MissingSong {
            path: "/tmp/a.flac".into(),
            missing: vec![MissingField::Cover],
        }],
        errors: vec![app_lib::model::MissingScanError {
            path: "/tmp/b.mp3".into(),
            reason: "读取标签失败".into(),
        }],
    };
    let json = serde_json::to_string(&result).unwrap();
    assert_eq!(
        json,
        r#"{"songs":[{"path":"/tmp/a.flac","missing":["cover"]}],"errors":[{"path":"/tmp/b.mp3","reason":"读取标签失败"}]}"#
    );
}

#[test]
fn command_runs_scan_in_blocking_worker_and_preserves_service_errors() {
    let tmp = TempDir::new().unwrap();
    write_tagged_flac(tmp.path(), "song.flac", "", "Artist");
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();

    let result = runtime.block_on(scan_missing_command(
        tmp.path().to_string_lossy().into_owned(),
        vec![MissingField::Title],
    ));
    assert_eq!(result.unwrap().songs.len(), 1);

    let missing_dir = runtime.block_on(scan_missing_command(
        tmp.path().join("missing").to_string_lossy().into_owned(),
        vec![MissingField::Title],
    ));
    assert!(
        missing_dir.is_err(),
        "目录级错误应作为 command-level Err 返回"
    );
}
