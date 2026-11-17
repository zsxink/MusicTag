// MusicTag — `commands/cover.rs` command 薄壳单测（rust-tests-separation 外置）。
//
// 覆盖：
// - `read_cover_path`（拖拽路径 → service 委托）：
//   - 不存在路径 → Err「读取封面文件失败」；
//   - 合法 PNG → data URL + mime（薄壳对 service 的委托正确性）；
//   - 非图片文件 → Err「封面格式无法识别」。
// - `cover_input_for_selection`（`pick_cover_file` 的选择结果映射，rfd 对话框无头不可测）：
//   - 取消（None）→ `Ok(None)`，不是错误；
//   - 选中非图片 → 中文 `Err`，不再被 `.ok()` 吞成 `None`（rust-review-hardening §4.5）；
//   - 选中合法 PNG → `Ok(Some(..))`，mime 与 data URL 正确。
// 访问被测函数经 `app_lib::commands::cover::{read_cover_path, cover_input_for_selection}`
// （Cargo.toml `[lib] name = "app_lib"`）。

mod common;

use app_lib::commands::cover::{cover_input_for_selection, read_cover_path};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use std::io::Cursor;
use std::path::PathBuf;

/// 生成一张 2x2 红色 PNG 的字节（`image` crate 编码，与 common::tiny_png_bytes 同源）。
fn tiny_png_bytes() -> Vec<u8> {
    let mut buf = Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
        2,
        2,
        image::Rgba([255, 0, 0, 255]),
    ))
    .write_to(&mut buf, image::ImageFormat::Png)
    .expect("编码测试 PNG 失败");
    buf.into_inner()
}

#[test]
fn read_cover_path_missing_path_returns_err() {
    let res = read_cover_path("/nonexistent/cover.png".to_string());
    assert!(res.is_err(), "不存在的路径应返回 Err");
    assert!(res.unwrap_err().contains("读取封面文件失败"));
}

#[test]
fn read_cover_path_valid_png_returns_cover_input() {
    // 临时文件 → data URL + mime（薄壳对 service 的委托正确性）
    let dir = tempfile::tempdir().expect("临时目录");
    let p = dir.path().join("cover.png");
    let png = tiny_png_bytes();
    std::fs::write(&p, &png).expect("写临时封面");
    let input = read_cover_path(p.to_string_lossy().into_owned()).expect("应成功");
    assert_eq!(input.mime, "image/png");
    assert!(input.data_url.starts_with("data:image/png;base64,"));
}

#[test]
fn read_cover_path_non_image_returns_err() {
    let dir = tempfile::tempdir().expect("临时目录");
    let p = dir.path().join("not_image.txt");
    std::fs::write(&p, b"hello").expect("写临时文件");
    let res = read_cover_path(p.to_string_lossy().into_owned());
    assert!(res.is_err(), "非图片文件应返回 Err");
    assert!(res.unwrap_err().contains("封面格式无法识别"));
}

#[test]
fn cover_input_for_selection_none_returns_ok_none() {
    // 用户取消文件选择器：`None` 是正常选择，必须映射为 `Ok(None)` 而非错误。
    let res = cover_input_for_selection(None);
    assert!(res.is_ok(), "取消选择应返回 Ok(None)，实际: {res:?}");
    assert!(res.unwrap().is_none(), "取消选择应返回 None");
}

#[test]
fn cover_input_for_selection_non_image_returns_chinese_err() {
    // 选中非图片：`cover_from_path` 的中文错误须原样传播，不能被 `.ok()` 吞成 `Ok(None)`。
    let dir = tempfile::tempdir().expect("临时目录");
    let p = dir.path().join("not_image.txt");
    std::fs::write(&p, b"hello").expect("写临时文件");
    let res = cover_input_for_selection(Some(PathBuf::from(p)));
    assert!(res.is_err(), "非图片文件应返回 Err 而非 Ok(None)");
    assert!(
        res.unwrap_err().contains("封面格式无法识别"),
        "错误信息应为中文原因"
    );
}

#[test]
fn cover_input_for_selection_valid_png_returns_cover_input() {
    let dir = tempfile::tempdir().expect("临时目录");
    let p = dir.path().join("cover.png");
    std::fs::write(&p, tiny_png_bytes()).expect("写临时封面");
    let input = cover_input_for_selection(Some(PathBuf::from(p)))
        .expect("合法 PNG 应返回 Ok(Some(..))")
        .expect("合法 PNG 不应映射为 None");
    assert_eq!(input.mime, "image/png");
    let prefix = "data:image/png;base64,";
    let encoded = input
        .data_url
        .strip_prefix(prefix)
        .unwrap_or_else(|| panic!("data URL 应以 {prefix} 开头，实际: {}", input.data_url));
    let decoded = BASE64
        .decode(encoded)
        .expect("data URL 载荷应为合法 base64");
    assert!(!decoded.is_empty(), "解码后的封面字节不应为空");
    assert_eq!(
        image::guess_format(&decoded).expect("解码字节应为可识别图片"),
        image::ImageFormat::Png
    );
}
