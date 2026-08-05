// MusicTag — `commands/cover.rs` command 薄壳单测（rust-tests-separation 外置）。
//
// 覆盖 `read_cover_path`（拖拽路径 → service 委托）：
// - 不存在路径 → Err「读取封面文件失败」；
// - 合法 PNG → data URL + mime（薄壳对 service 的委托正确性）；
// - 非图片文件 → Err「封面格式无法识别」。
// 访问被测函数经 `app_lib::commands::cover::read_cover_path`（Cargo.toml `[lib] name = "app_lib"`）。

mod common;

use app_lib::commands::cover::read_cover_path;
use std::io::Cursor;

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
