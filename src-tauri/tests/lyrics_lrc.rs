// MusicTag — v1-lyrics-lrc 侧载 `.lrc` 关联读 + 同步写集成测试（file I/O：TempDir + lofty 写盘）。
//
// 覆盖 design.md D2/D4/D6/D9 语义：
// - 内嵌优先 → 侧载关联 → None 的读取来源判定；
// - 复选框 opt-in 同步写 `.lrc`（空歌词不生成 / 取消不写 / 并存同步更新）；
// - `.lrc` 写失败并入 `save_song` 的 Err（中文原因「写 .lrc 失败」）。
// 访问被测函数经 `app_lib::service::`（Cargo.toml `[lib] name = "app_lib"`）。

mod common;

use common::{full_song, write_tagged_flac, write_tagged_mp3};
use std::fs;
use std::path::Path;
use tempfile::TempDir;

use app_lib::model::LyricsSource;
use app_lib::service::lyrics::{export_lrc, sidecar_lrc_path};
use app_lib::service::reader::read_song_meta;
use app_lib::service::writer::save_song;

const LYRIC_EMBEDDED: &str = "[00:00.00]内嵌歌词";
const LYRIC_SIDECAR: &str = "[00:01.00]侧载歌词\n[00:02.00]第二行";
const LYRIC_EDITED: &str = "[00:00.00]编辑后歌词\n[00:05.00]新行";

// ---------------------------------------------------------------------------
// 读取来源判定（design.md D2）
// ---------------------------------------------------------------------------

#[test]
fn lyrics_read_embedded_priority_when_sidecar_exists() {
    // 内嵌非空 + 同名 `.lrc` 存在 → 来源 Embedded、歌词取内嵌（内嵌优先）
    let tmp = TempDir::new().unwrap();
    write_tagged_flac(tmp.path(), "song.flac", "T", "A");
    common::add_tags(&tmp.path().join("song.flac"), Some(LYRIC_EMBEDDED), None);
    fs::write(tmp.path().join("song.lrc"), LYRIC_SIDECAR).unwrap();

    let song = read_song_meta(&tmp.path().join("song.flac")).expect("应可读");
    assert_eq!(song.lyrics_source, LyricsSource::Embedded);
    assert_eq!(song.lyrics, LYRIC_EMBEDDED, "内嵌是权威字段，优先于侧载");
}

#[test]
fn lyrics_read_sidecar_when_no_embedded() {
    // 无内嵌 + `.lrc` 存在 → 来源 SidecarLrc、歌词取 `.lrc` 文本
    let tmp = TempDir::new().unwrap();
    write_tagged_flac(tmp.path(), "song.flac", "T", "A");
    fs::write(tmp.path().join("song.lrc"), LYRIC_SIDECAR).unwrap();

    let song = read_song_meta(&tmp.path().join("song.flac")).expect("应可读");
    assert_eq!(song.lyrics_source, LyricsSource::SidecarLrc);
    assert_eq!(song.lyrics, LYRIC_SIDECAR);
}

#[test]
fn lyrics_read_sidecar_for_mp3() {
    // MP3 无内嵌 + `.lrc` 存在 → 同样侧载关联（不区分格式）
    let tmp = TempDir::new().unwrap();
    write_tagged_mp3(tmp.path(), "song.mp3", "T", "A");
    fs::write(tmp.path().join("song.lrc"), LYRIC_SIDECAR).unwrap();

    let song = read_song_meta(&tmp.path().join("song.mp3")).expect("应可读");
    assert_eq!(song.lyrics_source, LyricsSource::SidecarLrc);
    assert_eq!(song.lyrics, LYRIC_SIDECAR);
}

#[test]
fn lyrics_read_none_when_neither_embedded_nor_sidecar() {
    // 无内嵌 + 无 `.lrc` → 来源 None
    let tmp = TempDir::new().unwrap();
    write_tagged_flac(tmp.path(), "song.flac", "T", "A");

    let song = read_song_meta(&tmp.path().join("song.flac")).expect("应可读");
    assert_eq!(song.lyrics_source, LyricsSource::None);
    assert_eq!(song.lyrics, "");
}

// ---------------------------------------------------------------------------
// 复选框 opt-in 同步写 `.lrc`（design.md D3/D4/D6）
// ---------------------------------------------------------------------------

#[test]
fn export_lrc_checked_nonempty_writes_flac_sidecar_and_embedded() {
    let tmp = TempDir::new().unwrap();
    write_tagged_flac(tmp.path(), "song.flac", "T", "A");
    let path = tmp.path().join("song.flac");

    let song = full_song(path.to_string_lossy().into_owned());
    save_song(song.clone(), true).expect("FLAC 勾选保存应成功");

    // 同目录生成同名 `.lrc`（去扩展名），内容 = 当前歌词
    let lrc_path = sidecar_lrc_path(&path);
    assert_eq!(lrc_path, tmp.path().join("song.lrc"));
    assert_eq!(fs::read_to_string(&lrc_path).unwrap(), song.lyrics);

    // 内嵌同步写 → 来源 Embedded、歌词 = 当前编辑内容
    let saved = read_song_meta(&path).expect("保存后应可读");
    assert_eq!(saved.lyrics_source, LyricsSource::Embedded);
    assert_eq!(saved.lyrics, song.lyrics);
}

#[test]
fn export_lrc_checked_nonempty_writes_mp3_sidecar_and_embedded() {
    let tmp = TempDir::new().unwrap();
    write_tagged_mp3(tmp.path(), "song.mp3", "T", "A");
    let path = tmp.path().join("song.mp3");

    let song = full_song(path.to_string_lossy().into_owned());
    save_song(song.clone(), true).expect("MP3 勾选保存应成功");

    assert_eq!(
        fs::read_to_string(tmp.path().join("song.lrc")).unwrap(),
        song.lyrics
    );

    let saved = read_song_meta(&path).expect("保存后应可读");
    assert_eq!(saved.lyrics_source, LyricsSource::Embedded);
    assert_eq!(saved.lyrics, song.lyrics);
}

#[test]
fn export_lrc_checked_empty_lyrics_does_not_create_file() {
    // 勾选 + 空歌词 → 不生成 `.lrc`（FR-4.4a 忽略复选框）
    let tmp = TempDir::new().unwrap();
    write_tagged_flac(tmp.path(), "song.flac", "T", "A");
    let path = tmp.path().join("song.flac");

    let mut song = full_song(path.to_string_lossy().into_owned());
    song.lyrics = String::new();
    save_song(song, true).expect("空歌词勾选保存应成功");

    assert!(
        !tmp.path().join("song.lrc").exists(),
        "空歌词不得生成空 .lrc"
    );
    // 内嵌也已清空
    let saved = read_song_meta(&path).expect("应可读");
    assert_eq!(saved.lyrics, "");
    assert_eq!(saved.lyrics_source, LyricsSource::None);
}

#[test]
fn export_lrc_unchecked_preserves_existing_sidecar() {
    // 取消勾选 → 不写 `.lrc`（仅写内嵌），既有 `.lrc` 保留不动（opt-in 预期）
    let tmp = TempDir::new().unwrap();
    write_tagged_flac(tmp.path(), "song.flac", "T", "A");
    fs::write(tmp.path().join("song.lrc"), "旧侧载内容").unwrap();
    let path = tmp.path().join("song.flac");

    let mut song = full_song(path.to_string_lossy().into_owned());
    song.lyrics = LYRIC_EDITED.into();
    save_song(song, false).expect("不勾选保存应成功");

    assert_eq!(
        fs::read_to_string(tmp.path().join("song.lrc")).unwrap(),
        "旧侧载内容",
        "未勾选不得改动既有 .lrc"
    );
    let saved = read_song_meta(&path).expect("应可读");
    assert_eq!(saved.lyrics, LYRIC_EDITED, "内嵌已按当前内容更新");
}

#[test]
fn export_lrc_coexisting_syncs_both_sides() {
    // 内嵌 + `.lrc` 并存时：保存以当前编辑内容为准，两边一起更新（FR-4.5 / D9）
    let tmp = TempDir::new().unwrap();
    write_tagged_flac(tmp.path(), "song.flac", "T", "A");
    common::add_tags(&tmp.path().join("song.flac"), Some(LYRIC_EMBEDDED), None);
    fs::write(tmp.path().join("song.lrc"), LYRIC_SIDECAR).unwrap();
    let path = tmp.path().join("song.flac");

    let mut song = full_song(path.to_string_lossy().into_owned());
    song.lyrics = LYRIC_EDITED.into();
    save_song(song, true).expect("并存保存应成功");

    assert_eq!(
        fs::read_to_string(tmp.path().join("song.lrc")).unwrap(),
        LYRIC_EDITED,
        "勾选时 .lrc 与当前编辑内容一致"
    );
    let saved = read_song_meta(&path).expect("应可读");
    assert_eq!(saved.lyrics, LYRIC_EDITED, "内嵌与当前编辑内容一致");
    assert_eq!(saved.lyrics_source, LyricsSource::Embedded, "内嵌优先");
}

#[test]
fn export_lrc_write_failure_returns_err_with_reason() {
    // `.lrc` 写失败（rename 目标被目录占位）→ Err 含「写 .lrc 失败」且如实返回；
    // 内嵌已先落盘（写顺序内嵌先、`.lrc` 后，D4）。
    let tmp = TempDir::new().unwrap();
    write_tagged_flac(tmp.path(), "song.flac", "T", "A");
    fs::create_dir(tmp.path().join("song.lrc")).unwrap(); // 占位目录 → rename 失败
    let path = tmp.path().join("song.flac");

    let mut song = full_song(path.to_string_lossy().into_owned());
    song.lyrics = LYRIC_EDITED.into();
    let res = save_song(song, true);
    assert!(res.is_err(), ".lrc 写失败应返回 Err（不吞错）");
    assert!(
        res.unwrap_err().contains("写 .lrc 失败"),
        "错误应含「写 .lrc 失败」前缀"
    );

    // 内嵌已写成功（主存储先落盘）
    let saved = read_song_meta(&path).expect("内嵌应已写入");
    assert_eq!(saved.lyrics, LYRIC_EDITED);
}

#[test]
fn export_lrc_failed_write_leaves_no_temp_residue() {
    // 失败路径不残留临时文件（rename 失败时 temp 由 Drop 清理）
    let tmp = TempDir::new().unwrap();
    write_tagged_flac(tmp.path(), "song.flac", "T", "A");
    fs::create_dir(tmp.path().join("song.lrc")).unwrap();
    let path = tmp.path().join("song.flac");

    let mut song = full_song(path.to_string_lossy().into_owned());
    song.lyrics = LYRIC_EDITED.into();
    assert!(save_song(song, true).is_err());

    let leftovers: Vec<_> = fs::read_dir(tmp.path())
        .unwrap()
        .filter_map(Result::ok)
        .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
        .collect();
    assert!(
        leftovers.is_empty(),
        "失败路径不得残留临时文件: {leftovers:?}"
    );
}

// ---------------------------------------------------------------------------
// 单点函数（service::lyrics）补强验证
// ---------------------------------------------------------------------------

#[test]
fn sidecar_lrc_path_contract() {
    // 命名约定冻结：同目录、去扩展名同名（design.md D1）
    assert_eq!(
        sidecar_lrc_path(Path::new("/dir/a.flac")),
        Path::new("/dir/a.lrc")
    );
    assert_eq!(
        sidecar_lrc_path(Path::new("/dir/a.mp3")),
        Path::new("/dir/a.lrc")
    );
}

#[test]
fn export_lrc_direct_call_roundtrip() {
    let tmp = TempDir::new().unwrap();
    let audio = tmp.path().join("song.flac");
    export_lrc(&audio, LYRIC_SIDECAR).expect("应成功");
    assert_eq!(
        fs::read_to_string(tmp.path().join("song.lrc")).unwrap(),
        LYRIC_SIDECAR
    );
    // 再次写（覆盖）
    export_lrc(&audio, LYRIC_EDITED).expect("应成功");
    assert_eq!(
        fs::read_to_string(tmp.path().join("song.lrc")).unwrap(),
        LYRIC_EDITED
    );
}
