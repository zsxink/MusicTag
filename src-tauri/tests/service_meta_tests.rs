// MusicTag — `service/meta.rs` 字段映射与格式分支单测（rust-tests-separation 外置）。
//
// 原 `#[cfg(test)] mod tests` 内嵌块整体迁出（production `src/` 零 `#[cfg(test)]`）。
// 覆盖 design.md D2–D5：
// - `split_track_pair` TRCK 合串兜底拆分；
// - `is_audio_file` 扩展名过滤（六格式白名单，大小写不敏感）。
// 被测函数经 `app_lib::service::meta::`（Cargo.toml `[lib] name = "app_lib"`）。

mod common;

use app_lib::service::meta::{is_audio_file, split_track_pair};
use std::path::Path;

#[test]
fn split_track_pair_fallback() {
    // 模拟 TRCK 合串 `03/12` 兜底拆分（lofty 读侧已拆，兜底逻辑单测）
    assert_eq!(
        split_track_pair("03/12", ""),
        ("03".to_string(), "12".to_string())
    );
    // track_total 已有值时保留
    assert_eq!(
        split_track_pair("03", "12"),
        ("03".to_string(), "12".to_string())
    );
    // 无 `/` 时 track_total 为空
    assert_eq!(
        split_track_pair("05", ""),
        ("05".to_string(), String::new())
    );
}

#[test]
fn is_audio_file_accepts_case_insensitive_flac_mp3() {
    assert!(is_audio_file(Path::new("song.flac")));
    assert!(is_audio_file(Path::new("song.FLAC")));
    assert!(is_audio_file(Path::new("song.mp3")));
    assert!(is_audio_file(Path::new("song.MP3")));
}

/// 白名单六格式全部放行（PRD FR-1 / design D1、D3）。
///
/// `.mp4` 与 `.m4a` 同为 MP4 容器，一并纳入以免用户需改名才能编辑（D3）。
#[test]
fn is_audio_file_accepts_case_insensitive_ape_wav_m4a_mp4() {
    assert!(is_audio_file(Path::new("song.ape")));
    assert!(is_audio_file(Path::new("song.APE")));
    assert!(is_audio_file(Path::new("song.wav")));
    assert!(is_audio_file(Path::new("song.WAV")));
    assert!(is_audio_file(Path::new("song.m4a")));
    assert!(is_audio_file(Path::new("song.M4A")));
    assert!(is_audio_file(Path::new("song.mp4")));
    assert!(is_audio_file(Path::new("song.MP4")));
}

/// 放开新格式不得放宽到非音频：`.jpeg` 等图片与无扩展名仍拒绝。
#[test]
fn is_audio_file_still_rejects_non_audio() {
    assert!(!is_audio_file(Path::new("song.txt")));
    assert!(!is_audio_file(Path::new("cover.jpg")));
    assert!(!is_audio_file(Path::new("cover.jpeg")));
    assert!(!is_audio_file(Path::new("noext")));
    assert!(!is_audio_file(Path::new("a.invalid")));
}
