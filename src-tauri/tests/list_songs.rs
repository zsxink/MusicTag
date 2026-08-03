// MusicTag — list_songs 命令域集成测试（file I/O：TempDir + lofty 写盘）。
//
// 访问被测函数经 `app_lib::commands::folder::list_songs`（Cargo.toml `[lib] name = "app_lib"`）。

mod common;

use common::{write_tagged_flac, write_tagged_mp3};
use std::fs;
use tempfile::TempDir;

#[test]
fn list_songs_recurses_filters_and_reads_tags() {
    let tmp = TempDir::new().unwrap();
    // 混合大小写扩展名
    write_tagged_flac(tmp.path(), "song.flac", "Song", "Artist");
    fs::rename(tmp.path().join("song.flac"), tmp.path().join("song.FLAC")).unwrap();
    write_tagged_flac(tmp.path(), "b.flac", "Beta", "B");
    write_tagged_mp3(tmp.path(), "c.mp3", "See", "C");
    // 非音频
    fs::write(tmp.path().join("notes.txt"), "not audio").unwrap();
    fs::write(tmp.path().join("cover.jpg"), "nope").unwrap();
    // 子目录深度遍历
    let sub = tmp.path().join("sub");
    fs::create_dir(&sub).unwrap();
    write_tagged_mp3(&sub, "deep.mp3", "Deep", "D");

    let songs = app_lib::commands::folder::list_songs(tmp.path().to_string_lossy().into_owned());

    assert_eq!(
        songs.len(),
        4,
        "应只收录 song.FLAC、b.flac、c.mp3、sub/deep.mp3"
    );
    assert!(songs.iter().any(|s| s.path.ends_with("song.FLAC")));
    assert!(songs.iter().any(|s| s.path.ends_with("b.flac")));
    assert!(songs.iter().any(|s| s.path.ends_with("c.mp3")));
    assert!(songs.iter().any(|s| s.path.ends_with("deep.mp3")));

    let song = songs
        .iter()
        .find(|s| s.path.ends_with("song.FLAC"))
        .unwrap();
    assert_eq!(song.title, "Song");
    assert_eq!(song.artist, "Artist");
    let deep = songs.iter().find(|s| s.path.ends_with("deep.mp3")).unwrap();
    assert_eq!(deep.title, "Deep");
    assert_eq!(deep.artist, "D");
}

#[test]
fn non_audio_files_are_ignored() {
    let tmp = TempDir::new().unwrap();
    fs::write(tmp.path().join("readme.txt"), "no audio").unwrap();
    fs::write(tmp.path().join("cover.jpg"), "nope").unwrap();
    fs::write(tmp.path().join("a.invalid"), "x").unwrap();
    write_tagged_flac(tmp.path(), "keep.flac", "Keep", "K");
    let songs = app_lib::commands::folder::list_songs(tmp.path().to_string_lossy().into_owned());
    assert_eq!(songs.len(), 1);
    assert!(songs[0].path.ends_with("keep.flac"));
}

#[test]
fn empty_dir_returns_empty_list() {
    let tmp = TempDir::new().unwrap();
    let songs = app_lib::commands::folder::list_songs(tmp.path().to_string_lossy().into_owned());
    assert!(songs.is_empty());
}

#[test]
fn corrupt_file_yields_blank_not_error() {
    let tmp = TempDir::new().unwrap();
    fs::write(tmp.path().join("broken.mp3"), b"garbage bytes").unwrap();
    let songs = app_lib::commands::folder::list_songs(tmp.path().to_string_lossy().into_owned());
    assert_eq!(songs.len(), 1);
    assert_eq!(songs[0].title, "");
    assert_eq!(songs[0].artist, "");
}

#[test]
fn summary_never_trims() {
    let tmp = TempDir::new().unwrap();
    write_tagged_flac(tmp.path(), "padded.flac", "  Song  ", " Artist ");
    let songs = app_lib::commands::folder::list_songs(tmp.path().to_string_lossy().into_owned());
    assert_eq!(songs.len(), 1);
    assert_eq!(songs[0].title, "  Song  ");
    assert_eq!(songs[0].artist, " Artist ");
}
