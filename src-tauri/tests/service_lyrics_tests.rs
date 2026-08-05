// MusicTag — `service/lyrics.rs` 侧载 `.lrc` 读写单测（rust-tests-separation 外置）。
//
// 原 `#[cfg(test)] mod tests` 内嵌块整体迁出（production `src/` 零 `#[cfg(test)]`）。
// 覆盖 design.md D1/D5/D10 语义：
// - `.lrc` 路径 = 音频 `with_extension("lrc")`（含无扩展名 / 多后缀边界）；
// - 读取 UTF-8 lossy（存量 GBK 不 panic）；文件不存在 → None；
// - 写回始终 UTF-8，空歌词 no-op（不生成空 `.lrc`）；原子写（临时文件 + rename）。
// 被测函数经 `app_lib::service::lyrics::`（Cargo.toml `[lib] name = "app_lib"`）。

mod common;

use app_lib::service::lyrics::{export_lrc, read_sidecar_lrc, sidecar_lrc_path};
use std::fs;
use std::path::{Path, PathBuf};

#[test]
fn sidecar_path_removes_extension() {
    // 常规 FLAC/MP3 → 同目录去扩展名同名
    assert_eq!(
        sidecar_lrc_path(Path::new("/dir/song.flac")),
        PathBuf::from("/dir/song.lrc")
    );
    assert_eq!(
        sidecar_lrc_path(Path::new("/dir/song.mp3")),
        PathBuf::from("/dir/song.lrc")
    );
    // 无扩展名 → 追加 `.lrc`
    assert_eq!(
        sidecar_lrc_path(Path::new("/dir/noext")),
        PathBuf::from("/dir/noext.lrc")
    );
    // 多后缀 → 只换最后一个扩展名
    assert_eq!(
        sidecar_lrc_path(Path::new("/dir/a.b.mp3")),
        PathBuf::from("/dir/a.b.lrc")
    );
}

#[test]
fn read_missing_sidecar_returns_none() {
    let tmp = tempfile::TempDir::new().unwrap();
    assert_eq!(read_sidecar_lrc(&tmp.path().join("nope.flac")), None);
}

#[test]
fn read_sidecar_utf8_roundtrip() {
    let tmp = tempfile::TempDir::new().unwrap();
    let audio = tmp.path().join("song.flac");
    fs::write(
        tmp.path().join("song.lrc"),
        "[00:00.00]第一行\n[00:10.00]第二行",
    )
    .unwrap();
    assert_eq!(
        read_sidecar_lrc(&audio).as_deref(),
        Some("[00:00.00]第一行\n[00:10.00]第二行")
    );
}

#[test]
fn read_sidecar_lossy_for_non_utf8() {
    // GBK 编码字节（非 UTF-8）→ lossy 读入不 panic、坏字节降级为替换符
    let tmp = tempfile::TempDir::new().unwrap();
    let audio = tmp.path().join("song.flac");
    fs::write(tmp.path().join("song.lrc"), b"[00:00.00]\xC4\xE3\xBA\xC3").unwrap();
    let text = read_sidecar_lrc(&audio).expect("非 UTF-8 也应可读");
    assert!(text.contains('\u{FFFD}'), "坏字节应降级为替换符: {text}");
}

#[test]
fn export_empty_lyrics_is_noop() {
    let tmp = tempfile::TempDir::new().unwrap();
    let audio = tmp.path().join("song.flac");
    export_lrc(&audio, "").expect("空歌词应为 Ok（忽略复选框）");
    assert!(
        !tmp.path().join("song.lrc").exists(),
        "空歌词不得生成空 .lrc"
    );
}

#[test]
fn export_writes_atomic_lrc_without_temp_residue() {
    let tmp = tempfile::TempDir::new().unwrap();
    let audio = tmp.path().join("song.flac");
    export_lrc(&audio, "[00:00.00]歌词").expect("应成功");
    assert_eq!(
        fs::read_to_string(tmp.path().join("song.lrc")).unwrap(),
        "[00:00.00]歌词"
    );
    // 无 .tmp 残留
    let leftovers: Vec<_> = fs::read_dir(tmp.path())
        .unwrap()
        .filter_map(Result::ok)
        .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
        .collect();
    assert!(leftovers.is_empty(), "临时文件应被清理: {leftovers:?}");
}

#[test]
fn export_overwrites_existing_lrc() {
    let tmp = tempfile::TempDir::new().unwrap();
    let audio = tmp.path().join("song.flac");
    fs::write(tmp.path().join("song.lrc"), "旧内容").unwrap();
    export_lrc(&audio, "新内容").expect("应成功");
    assert_eq!(
        fs::read_to_string(tmp.path().join("song.lrc")).unwrap(),
        "新内容"
    );
}
