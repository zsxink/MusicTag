// MusicTag — save_song 命令域集成测试（file I/O：TempDir + lofty 写盘）。
//
// 访问被测函数经 `app_lib::service::writer::save_song` 与
// `app_lib::service::reader::read_song_meta`（Cargo.toml `[lib] name = "app_lib"`）。

mod common;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use common::{add_tags, full_song, tiny_png_bytes, write_tagged_flac, write_tagged_mp3};
use lofty::prelude::TaggedFileExt;
use lofty::probe::Probe;
use std::fs;
use std::path::Path;
use tempfile::TempDir;

#[test]
fn save_song_flac_roundtrips_all_fields() {
    let tmp = TempDir::new().unwrap();
    write_tagged_flac(tmp.path(), "song.flac", "旧标题", "旧艺术家");
    let path = tmp.path().join("song.flac").to_string_lossy().into_owned();

    let song = full_song(path.clone());
    app_lib::service::writer::save_song(song).expect("FLAC 保存应成功");

    // 读回逐字段断言一致
    let saved = app_lib::service::reader::read_song_meta(Path::new(&path)).expect("保存后应可读");
    assert_eq!(saved.title, "保存标题");
    assert_eq!(saved.artist, "保存艺术家");
    assert_eq!(saved.album, "保存专辑");
    assert_eq!(saved.album_artist, "保存专辑艺术家");
    assert_eq!(saved.track, "7");
    assert_eq!(saved.track_total, "9");
    assert_eq!(saved.year, "2022");
    assert_eq!(saved.genre, "Rock");
    assert_eq!(saved.lyrics, "[00:00.00]保存歌词第一行\n[00:10.00]第二行");
    assert_eq!(saved.lyrics_source, app_lib::model::LyricsSource::Embedded);
    // 封面读回字节一致
    let cover = saved.cover.expect("应有封面");
    let b64 = cover.split_once(";base64,").map(|(_, b)| b).unwrap();
    assert_eq!(BASE64.decode(b64).unwrap(), tiny_png_bytes());
}

#[test]
fn save_song_mp3_roundtrips_all_fields_id3v24() {
    let tmp = TempDir::new().unwrap();
    write_tagged_mp3(tmp.path(), "song.mp3", "旧标题", "旧艺术家");
    let path = tmp.path().join("song.mp3").to_string_lossy().into_owned();

    let song = full_song(path.clone());
    app_lib::service::writer::save_song(song).expect("MP3 保存应成功");

    let saved = app_lib::service::reader::read_song_meta(Path::new(&path)).expect("保存后应可读");
    assert_eq!(saved.title, "保存标题");
    assert_eq!(saved.artist, "保存艺术家");
    assert_eq!(saved.album, "保存专辑");
    assert_eq!(saved.album_artist, "保存专辑艺术家");
    assert_eq!(saved.track, "7");
    assert_eq!(saved.track_total, "9");
    assert_eq!(saved.year, "2022");
    assert_eq!(saved.genre, "Rock");
    assert_eq!(saved.lyrics, "[00:00.00]保存歌词第一行\n[00:10.00]第二行");

    // 写后文件头必须是 ID3v2.4（`ID3\x04`，非 v2.3）
    let bytes = fs::read(&path).unwrap();
    assert_eq!(&bytes[..3], b"ID3");
    assert_eq!(
        bytes[3], 0x04,
        "MP3 写回必须为 ID3v2.4，实际版本: {}",
        bytes[3]
    );
    // 封面 APIC 读回字节一致
    let cover = saved.cover.expect("应有封面");
    let b64 = cover.split_once(";base64,").map(|(_, b)| b).unwrap();
    assert_eq!(BASE64.decode(b64).unwrap(), tiny_png_bytes());
}

#[test]
fn save_song_mp3_uslt_lang_is_eng() {
    let tmp = TempDir::new().unwrap();
    write_tagged_mp3(tmp.path(), "lyric.mp3", "T", "A");
    let path = tmp.path().join("lyric.mp3").to_string_lossy().into_owned();

    let mut song = full_song(path.clone());
    song.lyrics = "一段歌词".into();
    app_lib::service::writer::save_song(song).expect("MP3 保存应成功");

    // 读回 USLT 帧并断言 lang=eng
    let tagged = Probe::open(&path).and_then(|p| p.read()).expect("应可读");
    let tag = tagged.primary_tag().expect("应有主标签");
    let uslt = tag
        .get(lofty::tag::ItemKey::UnsyncLyrics)
        .expect("应有 USLT 帧");
    assert_eq!(
        uslt.lang(),
        &lofty::tag::items::ENGLISH,
        "USLT lang 必须为 eng"
    );
}

#[test]
fn save_song_clears_empty_fields_and_removes_lyrics_cover() {
    let tmp = TempDir::new().unwrap();
    write_tagged_flac(tmp.path(), "full.flac", "旧标题", "旧艺术家");
    add_tags(
        &tmp.path().join("full.flac"),
        Some("[00:00.00]旧歌词"),
        Some(tiny_png_bytes()),
    );
    let path = tmp.path().join("full.flac").to_string_lossy().into_owned();

    // 表单全空 + 无封面 → 保存后标签被清空
    let song = app_lib::model::Song {
        path: path.clone(),
        title: String::new(),
        artist: String::new(),
        album: String::new(),
        album_artist: String::new(),
        track: String::new(),
        track_total: String::new(),
        year: String::new(),
        genre: String::new(),
        lyrics: String::new(),
        lyrics_source: app_lib::model::LyricsSource::None,
        cover: None,
        cover_mime: None,
    };
    app_lib::service::writer::save_song(song).expect("保存应成功");

    let saved = app_lib::service::reader::read_song_meta(Path::new(&path)).expect("应可读");
    assert_eq!(saved.title, "");
    assert_eq!(saved.artist, "");
    assert_eq!(saved.album, "");
    assert_eq!(saved.lyrics, "");
    assert_eq!(saved.lyrics_source, app_lib::model::LyricsSource::None);
    assert_eq!(saved.cover, None, "cover=None 后标签应无封面");
    assert_eq!(saved.cover_mime, None);
}

#[test]
fn save_song_removes_cover_when_cover_none() {
    let tmp = TempDir::new().unwrap();
    write_tagged_mp3(tmp.path(), "cover.mp3", "T", "A");
    add_tags(&tmp.path().join("cover.mp3"), None, Some(tiny_png_bytes()));
    let path = tmp.path().join("cover.mp3").to_string_lossy().into_owned();

    // 先确认原文件有封面
    let before = app_lib::service::reader::read_song_meta(Path::new(&path)).expect("应可读");
    assert!(before.cover.is_some());

    // 表单保留标题但 cover=None → 封面被删除
    let song = app_lib::model::Song {
        path: path.clone(),
        title: "保留标题".into(),
        cover: None,
        ..full_song(path.clone())
    };
    app_lib::service::writer::save_song(song).expect("保存应成功");

    let after = app_lib::service::reader::read_song_meta(Path::new(&path)).expect("应可读");
    assert_eq!(after.title, "保留标题");
    assert_eq!(after.cover, None, "cover=None 应删除封面");
    assert_eq!(after.cover_mime, None);
}

#[test]
fn save_song_atomic_write_failure_keeps_original_untouched() {
    let tmp = TempDir::new().unwrap();
    // 独立子目录（可单独改权限，不影响 TempDir 自身清理）
    let dir = tmp.path().join("ro_dir");
    fs::create_dir(&dir).unwrap();
    write_tagged_flac(&dir, "song.flac", "原标题", "原艺术家");
    let path = dir.join("song.flac");
    let orig_bytes = fs::read(&path).unwrap();

    // 写失败场景：目录只读 → 临时文件创建失败 → Err 且原文件 bytes 不变。
    // 原文件仍可读（Probe::open 只读成功），失败发生在 write_atomic 阶段。
    let mut perms = fs::metadata(&dir).unwrap().permissions();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        perms.set_mode(0o555); // r-x，去掉写位
    }
    fs::set_permissions(&dir, perms).expect("设置只读目录失败");

    let song = full_song(path.to_string_lossy().into_owned());
    let res = app_lib::service::writer::save_song(song);
    assert!(res.is_err(), "只读目录应返回 Err");
    assert!(res.unwrap_err().contains("写回文件失败"));

    // 恢复目录写权限以便后续清理
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o755)).unwrap();
    }

    // 原文件 bytes 完全不变
    assert_eq!(
        fs::read(&path).unwrap(),
        orig_bytes,
        "原子写失败不得改动原文件"
    );
}

#[test]
fn save_song_missing_path_returns_err_not_panic() {
    let song = full_song("/nonexistent/missing/file.mp3".into());
    let res = app_lib::service::writer::save_song(song);
    assert!(res.is_err(), "路径不存在应返回 Err（不 panic）");
}

#[test]
fn save_song_corrupt_file_returns_err_not_panic() {
    let tmp = TempDir::new().unwrap();
    let path = tmp.path().join("broken.mp3");
    fs::write(&path, b"garbage bytes").unwrap();
    let song = full_song(path.to_string_lossy().into_owned());
    let res = app_lib::service::writer::save_song(song);
    assert!(res.is_err(), "坏标签文件应返回 Err（不 panic）");
}

#[test]
fn save_song_cover_bad_mime_returns_err() {
    let tmp = TempDir::new().unwrap();
    write_tagged_flac(tmp.path(), "badcover.flac", "T", "A");
    let path = tmp
        .path()
        .join("badcover.flac")
        .to_string_lossy()
        .into_owned();

    // 封面字节无法识别为图片格式（纯文本 base64）
    let mut song = full_song(path.clone());
    song.cover = Some(format!(
        "data:application/octet-stream;base64,{}",
        BASE64.encode(b"not an image")
    ));
    let res = app_lib::service::writer::save_song(song);
    assert!(res.is_err(), "MIME 探测失败应返回 Err");
    assert!(res.unwrap_err().contains("封面格式无法识别"));
}

#[test]
fn save_song_track_only_writes_trck_x() {
    let tmp = TempDir::new().unwrap();
    write_tagged_mp3(tmp.path(), "track.mp3", "T", "A");
    let path = tmp.path().join("track.mp3").to_string_lossy().into_owned();

    // 只有 track 无 track_total → TRCK 只写 `x`
    let mut song = full_song(path.clone());
    song.track = "5".into();
    song.track_total = String::new();
    app_lib::service::writer::save_song(song).expect("保存应成功");

    let saved = app_lib::service::reader::read_song_meta(Path::new(&path)).expect("应可读");
    assert_eq!(saved.track, "5");
    assert_eq!(saved.track_total, "", "track_total 空则不写");
}

#[test]
fn save_song_preserves_audio_frames() {
    // 保存后文件仍可被 lofty 完整解析（音频帧未损坏），且不再残留临时文件。
    let tmp = TempDir::new().unwrap();
    write_tagged_mp3(tmp.path(), "keep.mp3", "旧标题", "旧艺术家");
    let path = tmp.path().join("keep.mp3");
    let orig_len = fs::metadata(&path).unwrap().len();

    let song = full_song(path.to_string_lossy().into_owned());
    app_lib::service::writer::save_song(song).expect("保存应成功");

    // 原路径下无残留 .tmp
    let leftovers: Vec<_> = fs::read_dir(tmp.path())
        .unwrap()
        .filter_map(Result::ok)
        .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
        .collect();
    assert!(
        leftovers.is_empty(),
        "临时文件应在保存后清理: {leftovers:?}"
    );

    // 文件仍可读（audio frames 完好）
    let tagged = Probe::open(&path)
        .and_then(|p| p.read())
        .expect("保存后仍可解析");
    assert_eq!(tagged.file_type(), lofty::file::FileType::Mpeg);
    // 文件只增不减标签体积（音频保留）
    assert!(fs::metadata(&path).unwrap().len() >= orig_len);
}

#[test]
fn save_song_embeds_compressed_cover_not_original() {
    // v1-cover-embed spec「统一写盘」：封面区预览即压缩后图，进标签的是 ≤2048 压缩图
    // （PRD §5.3 决策 A：原图在 Rust 侧压缩后即弃）。完整链路：
    //   大图 bytes → compress_cover → encode_data_url → Song.cover → save_song
    //   → 读回 PICTURE/APIC → 解码 → 维度 ≤2048 且 ≠ 原大图字节。
    let tmp = TempDir::new().unwrap();
    write_tagged_flac(tmp.path(), "cover.flac", "T", "A");
    let path = tmp.path().join("cover.flac").to_string_lossy().into_owned();

    // 构造 3000x2000 大 PNG（compress_cover 应缩至 2048x1365）
    let big = {
        use std::io::Cursor;
        let mut buf = Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            3000,
            2000,
            image::Rgba([12, 34, 56, 255]),
        ))
        .write_to(&mut buf, image::ImageFormat::Png)
        .expect("编码测试 PNG 失败");
        buf.into_inner()
    };
    let (compressed, mime) =
        app_lib::service::cover::compress_cover(&big, "image/png").expect("大图应压缩成功");
    assert_eq!(mime, "image/png");
    let compressed_img = image::load_from_memory(&compressed).expect("压缩结果应可解码");
    assert!(
        compressed_img.width() <= 2048 && compressed_img.height() <= 2048,
        "压缩后应 ≤2048×2048，实际 {}x{}",
        compressed_img.width(),
        compressed_img.height()
    );
    assert_ne!(compressed, big, "压缩图不得等于原图");

    // 压缩图 → data URL（复用 service::cover::encode_data_url，与 cover_from_path 同编码路径）
    let data_url = app_lib::service::cover::encode_data_url(&compressed, "image/png");
    let mut song = full_song(path.clone());
    song.cover = Some(data_url);
    song.cover_mime = Some("image/png".into());
    app_lib::service::writer::save_song(song).expect("保存应成功");

    // 读回 → 解码 → 字节 = 压缩图（≤2048），而非原大图
    let saved = app_lib::service::reader::read_song_meta(Path::new(&path)).expect("保存后应可读");
    let cover_url = saved.cover.expect("应有封面");
    let b64 = cover_url.split_once(";base64,").map(|(_, b)| b).unwrap();
    let embedded = BASE64.decode(b64).unwrap();
    assert_eq!(embedded, compressed, "嵌入的应为压缩图字节（原图丢弃）");
    let embedded_img = image::load_from_memory(&embedded).expect("嵌入封面应可解码");
    assert!(
        embedded_img.width() <= 2048 && embedded_img.height() <= 2048,
        "嵌入封面应 ≤2048×2048，实际 {}x{}",
        embedded_img.width(),
        embedded_img.height()
    );
    assert_ne!(embedded, big, "不得嵌入原大图");
}

#[test]
fn save_song_mp3_embeds_compressed_cover_not_original() {
    // v1-cover-embed spec「统一写盘」的 MP3/APIC 分支：压缩图经 save_song 嵌入 APIC
    // （FLAC PICTURE 分支由 save_song_embeds_compressed_cover_not_original 覆盖；
    //  apply_cover 为共享写盘路径，此处验证 APIC 端到端字节一致）。
    let tmp = TempDir::new().unwrap();
    write_tagged_mp3(tmp.path(), "cover.mp3", "T", "A");
    let path = tmp.path().join("cover.mp3").to_string_lossy().into_owned();

    let big = {
        use std::io::Cursor;
        let mut buf = Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
            3000,
            2000,
            image::Rgb([12, 34, 56]),
        ))
        .write_to(&mut buf, image::ImageFormat::Jpeg)
        .expect("编码测试 JPEG 失败");
        buf.into_inner()
    };
    let (compressed, mime) =
        app_lib::service::cover::compress_cover(&big, "image/jpeg").expect("大图应压缩成功");
    assert_eq!(mime, "image/jpeg");
    assert_eq!(
        image::guess_format(&compressed).expect("压缩结果应为 JPEG"),
        image::ImageFormat::Jpeg
    );
    let compressed_img = image::load_from_memory(&compressed).expect("压缩结果应可解码");
    assert!(
        compressed_img.width() <= 2048 && compressed_img.height() <= 2048,
        "压缩后应 ≤2048×2048，实际 {}x{}",
        compressed_img.width(),
        compressed_img.height()
    );
    assert_ne!(compressed, big, "压缩图不得等于原图");

    let data_url = app_lib::service::cover::encode_data_url(&compressed, "image/jpeg");
    let mut song = full_song(path.clone());
    song.cover = Some(data_url);
    song.cover_mime = Some("image/jpeg".into());
    app_lib::service::writer::save_song(song).expect("保存应成功");

    let saved = app_lib::service::reader::read_song_meta(Path::new(&path)).expect("保存后应可读");
    let cover_url = saved.cover.expect("应有 APIC 封面");
    assert!(cover_url.starts_with("data:image/jpeg;base64,"));
    let b64 = cover_url.split_once(";base64,").map(|(_, b)| b).unwrap();
    let embedded = BASE64.decode(b64).unwrap();
    assert_eq!(
        embedded, compressed,
        "MP3 APIC 嵌入的应为压缩图字节（原图丢弃）"
    );
    let embedded_img = image::load_from_memory(&embedded).expect("嵌入封面应可解码");
    assert!(
        embedded_img.width() <= 2048 && embedded_img.height() <= 2048,
        "MP3 嵌入封面应 ≤2048×2048，实际 {}x{}",
        embedded_img.width(),
        embedded_img.height()
    );
}
