// MusicTag — open_song 命令域集成测试（file I/O：TempDir + lofty 写盘）。
//
// 访问被测函数经 `app_lib::service::reader::read_song_meta` 与
// `app_lib::commands::song::open_song`（Cargo.toml `[lib] name = "app_lib"`）。

mod common;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use common::{
    add_ape_tags_with_picture, add_tags, assert_bad_wav_fixture, assert_wav_fixture_tags,
    tiny_png_bytes, write_dual_tagged_wav, write_riff_info_only_wav, write_tagged_ape,
    write_tagged_flac, write_tagged_m4a, write_tagged_mp3, write_tagged_wav,
};
use std::fs;
use tempfile::TempDir;

#[test]
fn open_song_flac_reads_all_fields_with_lyrics_and_cover() {
    let tmp = TempDir::new().unwrap();
    write_tagged_flac(tmp.path(), "song.flac", "Song", "Artist");
    add_tags(
        &tmp.path().join("song.flac"),
        Some("[00:00.00]第一行歌词\n[00:05.00]第二行"),
        Some(tiny_png_bytes()),
    );

    let song = app_lib::service::reader::read_song_meta(&tmp.path().join("song.flac"))
        .expect("FLAC 应可读");

    assert_eq!(song.path, tmp.path().join("song.flac").to_string_lossy());
    assert_eq!(song.title, "Song");
    assert_eq!(song.artist, "Artist");
    assert_eq!(song.album, "Album");
    assert_eq!(song.album_artist, "AlbumArtist");
    assert_eq!(song.track, "3");
    assert_eq!(song.track_total, "12");
    assert_eq!(song.year, "2021");
    assert_eq!(song.genre, "Pop");
    assert_eq!(song.lyrics, "[00:00.00]第一行歌词\n[00:05.00]第二行");
    assert_eq!(song.lyrics_source, app_lib::model::LyricsSource::Embedded);

    let cover = song.cover.expect("应有封面 data URL");
    assert!(
        cover.starts_with("data:image/png;base64,"),
        "封面应前缀 data:image/png;base64,，实际: {cover}"
    );
    assert_eq!(song.cover_mime.as_deref(), Some("image/png"));
    // base64 解码回去应与原始 PNG 字节一致
    let b64 = cover.strip_prefix("data:image/png;base64,").unwrap();
    let decoded = BASE64.decode(b64).expect("base64 应可解码");
    assert_eq!(decoded, tiny_png_bytes());
}

#[test]
fn open_song_mp3_reads_all_fields_with_uslt_and_apic() {
    let tmp = TempDir::new().unwrap();
    write_tagged_mp3(tmp.path(), "song.mp3", "Song", "Artist");
    add_tags(
        &tmp.path().join("song.mp3"),
        Some("[00:00.00]第一行歌词\n[00:05.00]第二行"),
        Some(tiny_png_bytes()),
    );

    let song =
        app_lib::service::reader::read_song_meta(&tmp.path().join("song.mp3")).expect("MP3 应可读");

    assert_eq!(song.title, "Song");
    assert_eq!(song.artist, "Artist");
    assert_eq!(song.album, "Album");
    assert_eq!(song.album_artist, "AlbumArtist");
    assert_eq!(song.track, "3");
    assert_eq!(song.track_total, "12");
    assert_eq!(song.year, "2021");
    assert_eq!(song.genre, "Pop");
    assert_eq!(song.lyrics, "[00:00.00]第一行歌词\n[00:05.00]第二行");
    assert_eq!(song.lyrics_source, app_lib::model::LyricsSource::Embedded);

    let cover = song.cover.expect("应有封面 data URL");
    assert!(
        cover.starts_with("data:image/png;base64,"),
        "封面应前缀 data:image/png;base64,，实际: {cover}"
    );
    assert_eq!(song.cover_mime.as_deref(), Some("image/png"));
    let b64 = cover.strip_prefix("data:image/png;base64,").unwrap();
    assert_eq!(BASE64.decode(b64).unwrap(), tiny_png_bytes());
}

#[test]
fn open_song_new_formats_reads_all_fields_with_lyrics_and_cover() {
    let cases = [
        (
            "song.wav",
            write_tagged_wav as fn(&std::path::Path, &str, &str, &str),
        ),
        ("song.m4a", write_tagged_m4a),
        ("song.ape", write_tagged_ape),
    ];
    for (name, write_fixture) in cases {
        let tmp = TempDir::new().unwrap();
        write_fixture(tmp.path(), name, "Song", "Artist");
        let path = tmp.path().join(name);
        if name.ends_with(".ape") {
            add_ape_tags_with_picture(&path, tiny_png_bytes());
        } else {
            add_tags(&path, Some("歌词"), Some(tiny_png_bytes()));
        }
        let song = app_lib::service::reader::read_song_meta(&path).expect("新增格式应可读");
        assert_eq!(song.title, "Song");
        assert_eq!(song.artist, "Artist");
        assert_eq!(song.album, "Album");
        assert_eq!(song.year, "2021");
        assert_eq!(song.lyrics, "歌词");
        assert!(song.cover.is_some(), "{name} should retain cover");
    }
}

#[test]
fn open_song_wav_riff_info_only_reads_summary_and_all_mapped_fields() {
    let tmp = TempDir::new().unwrap();
    let path = tmp.path().join("riff-only.wav");
    write_riff_info_only_wav(
        tmp.path(),
        "riff-only.wav",
        &[
            ("INAM", "RIFF 标题"),
            ("IART", "RIFF 艺术家"),
            ("IPRD", "RIFF 专辑"),
            ("IPRT", "3"),
            ("IFRM", "12"),
            ("ICRD", "2021"),
            ("IGNR", "Jazz"),
        ],
    );

    assert_wav_fixture_tags(&path, false, true);
    let summary = app_lib::service::reader::read_summary(&path);
    assert_eq!(summary.title, "RIFF 标题");
    assert_eq!(summary.artist, "RIFF 艺术家");

    let song = app_lib::service::reader::read_song_meta(&path).expect("RIFF INFO-only WAV 应可读");
    assert_eq!(song.title, "RIFF 标题");
    assert_eq!(song.artist, "RIFF 艺术家");
    assert_eq!(song.album, "RIFF 专辑");
    assert_eq!(song.track, "3");
    assert_eq!(song.track_total, "12");
    assert_eq!(song.year, "2021");
    assert_eq!(song.genre, "Jazz");
    assert_eq!(song.lyrics, "");
    assert_eq!(song.cover, None);
}

#[test]
fn open_song_wav_dual_tags_use_id3_per_field_and_riff_fallback() {
    let tmp = TempDir::new().unwrap();
    let path = tmp.path().join("dual.wav");
    write_dual_tagged_wav(
        tmp.path(),
        "dual.wav",
        "ID3 标题",
        "ID3 艺术家",
        &[
            ("INAM", "RIFF 标题"),
            ("IART", "RIFF 艺术家"),
            ("IPRD", "RIFF 专辑"),
            ("IPRT", "4"),
            ("IFRM", "10"),
            ("ICRD", "2020"),
            ("IGNR", "Classical"),
        ],
    );

    assert_wav_fixture_tags(&path, true, true);
    let song = app_lib::service::reader::read_song_meta(&path).expect("双标签 WAV 应可读");
    assert_eq!(song.title, "ID3 标题");
    assert_eq!(song.artist, "ID3 艺术家");
    assert_eq!(song.album, "RIFF 专辑");
    assert_eq!(song.track, "4");
    assert_eq!(song.track_total, "10");
    assert_eq!(song.year, "2020");
    assert_eq!(song.genre, "Classical");
}

#[test]
fn open_song_wav_bad_fixture_fails_early_and_returns_error() {
    let tmp = TempDir::new().unwrap();
    let path = tmp.path().join("broken.wav");
    fs::write(&path, b"RIFF\x00\x00\x00\x00WAVE").unwrap();
    assert_bad_wav_fixture(&path);
    let err = app_lib::service::reader::read_song_meta(&path)
        .expect_err("坏 WAV 不应进入可编辑表单");
    assert!(!err.is_empty());
    let summary = app_lib::service::reader::read_summary(&path);
    assert_eq!(summary.title, "");
    assert_eq!(summary.artist, "");
}

#[test]
fn open_song_mp3_track_pair_merged_frame_reads_split() {
    // 部分 MP3 的 TRCK 写成合并串 `03/12`。lofty 读侧已拆（design.md D2），
    // 这里直接手工拼一个含 `/` 的 TRCK 文本帧注入 ID3v2.4 tag，验证读路径端到端拆分。
    let tmp = TempDir::new().unwrap();

    fn synchsafe(n: usize) -> [u8; 4] {
        let n = n as u32;
        [(n >> 21) as u8, (n >> 14) as u8, (n >> 7) as u8, n as u8]
    }
    // TRCK 文本帧：帧头（ID3v2.4 无 flags）+ UTF-8 文本
    let mut trck = Vec::from(b"TRCK");
    let content = b"03/12";
    trck.extend_from_slice(&synchsafe(content.len() + 1));
    trck.extend_from_slice(&[0, 0]);
    trck.push(0x03); // UTF-8
    trck.extend_from_slice(content);

    let mut audio = Vec::from(b"ID3\x04\x00\x00");
    audio.extend_from_slice(&synchsafe(trck.len()));
    audio.extend(&trck);
    // 两个合法 MPEG 帧保证 lofty 解析通过
    for _ in 0..2 {
        audio.extend_from_slice(&[0xFF, 0xFB, 0x90, 0x00]);
        audio.extend(std::iter::repeat_n(0u8, 413));
    }
    fs::write(tmp.path().join("trck.mp3"), &audio).expect("写入测试 MP3 失败");

    // 读回，lofty 对 TRCK 读侧做 x/y 拆分 → track/track_total 拆开
    let song =
        app_lib::service::reader::read_song_meta(&tmp.path().join("trck.mp3")).expect("应可读");
    assert_eq!(song.track, "03");
    assert_eq!(song.track_total, "12");
}

#[test]
fn open_song_untagged_file_returns_blanks() {
    let tmp = TempDir::new().unwrap();
    write_tagged_flac(tmp.path(), "plain.flac", "", "");
    // 只写基础 FLAC，不 add_tags —— title/artist 为空，其余字段未设置

    let song = app_lib::service::reader::read_song_meta(&tmp.path().join("plain.flac"))
        .expect("无标签 FLAC 应可读");

    assert_eq!(song.title, "");
    assert_eq!(song.artist, "");
    assert_eq!(song.album, "");
    assert_eq!(song.album_artist, "");
    assert_eq!(song.track, "");
    assert_eq!(song.track_total, "");
    assert_eq!(song.year, "");
    assert_eq!(song.genre, "");
    assert_eq!(song.lyrics, "");
    assert_eq!(song.lyrics_source, app_lib::model::LyricsSource::None);
    assert_eq!(song.cover, None);
    assert_eq!(song.cover_mime, None);
}

#[test]
fn open_song_corrupt_file_returns_err_not_blank() {
    // 与 list_songs 的语义差异：坏标签 → list_songs 空串、open_song 必须 Err。
    let tmp = TempDir::new().unwrap();
    fs::write(tmp.path().join("broken.mp3"), b"garbage bytes").unwrap();
    let res = app_lib::service::reader::read_song_meta(&tmp.path().join("broken.mp3"));
    assert!(res.is_err(), "坏标签文件应返回 Err，而非空 Song");
    assert!(!res.unwrap_err().is_empty(), "错误原因不应为空串");
}

#[test]
fn open_song_corrupt_new_formats_returns_err() {
    for ext in ["ape", "wav", "m4a"] {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join(format!("broken.{ext}"));
        fs::write(&path, b"garbage bytes").unwrap();
        let res = app_lib::service::reader::read_song_meta(&path);
        assert!(res.is_err(), "坏 {ext} 标签应进入只读错误路径");
    }
}

#[test]
fn open_song_lyrics_source_none_when_whitespace_only() {
    let tmp = TempDir::new().unwrap();
    write_tagged_flac(tmp.path(), "ws.flac", "T", "A");
    add_tags(&tmp.path().join("ws.flac"), Some("   \n  "), None);

    let song =
        app_lib::service::reader::read_song_meta(&tmp.path().join("ws.flac")).expect("应可读");
    // 内嵌歌词 trim 后为空 → None
    assert_eq!(song.lyrics_source, app_lib::model::LyricsSource::None);
    assert_eq!(song.lyrics, "   \n  ");
}

#[test]
fn open_song_command_returns_err_for_missing_path() {
    // 不存在的路径 → Err（区别于空串）
    let res =
        app_lib::commands::song::open_song("/nonexistent/definitely/missing.flac".to_string());
    assert!(res.is_err());
}
