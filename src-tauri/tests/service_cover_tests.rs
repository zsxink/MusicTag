// MusicTag — `service/cover.rs` 封面 base64 data URL 编解码 + 嵌入压缩单测（rust-tests-separation 外置）。
//
// 原 `#[cfg(test)] mod tests` 内嵌块整体迁出（production `src/` 零 `#[cfg(test)]`）。
// 覆盖 design.md D2/D3/D7 语义：
// - `encode_cover` / `decode_cover` data URL 编解码（MIME 前缀优先 + 字节探测兜底）；
// - `compress_cover` 小图原样返回 / 大图等比缩至 ≤2048×2048 / >5MB 分支 / 重编码失败回退；
// - `cover_from_path` 文件 → 压缩 → data URL。
// 被测函数经 `app_lib::service::cover::`，私有 helper（png_of_size 等）复制进本文件，
// `MAX_DIM` 为生产 `pub(crate)` 常量（单源真值，防漂移）。

mod common;

use app_lib::service::cover::{
    compress_cover, cover_from_path, decode_cover, encode_cover, MAX_DIM,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use image::GenericImageView;
use lofty::picture::{MimeType, Picture, PictureType};

/// 生成一张 2x2 红色 PNG 的字节（`image` crate 编码）。
fn tiny_png_bytes() -> Vec<u8> {
    use std::io::Cursor;
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
fn decode_cover_strips_prefix_and_guesses_mime() {
    // data URL 前缀 → 前缀 MIME 优先
    let png = tiny_png_bytes();
    let data_url = format!("data:image/png;base64,{}", BASE64.encode(&png));
    let (bytes, mime) = decode_cover(&data_url).expect("应解码");
    assert_eq!(bytes, png);
    assert_eq!(mime, "image/png");

    // 无前缀 → 按纯 base64 解码 + 字节探测 MIME
    let (bytes2, mime2) = decode_cover(&BASE64.encode(&png)).expect("纯 base64 应解码");
    assert_eq!(bytes2, png);
    assert_eq!(mime2, "image/png");
}

#[test]
fn encode_cover_roundtrips_with_picture_mime() {
    // 有 MIME 声明：data URL 前缀 + mime 均来自 Picture 声明
    let png = tiny_png_bytes();
    let pic = Picture::unchecked(png.clone())
        .pic_type(PictureType::CoverFront)
        .mime_type(MimeType::Png)
        .build();
    let (data_url, mime) = encode_cover(pic);
    assert_eq!(mime.as_deref(), Some("image/png"));
    let url = data_url.expect("应有 data URL");
    assert!(url.starts_with("data:image/png;base64,"));
    let (bytes, _) = decode_cover(&url).expect("应可解码");
    assert_eq!(bytes, png);
}

#[test]
fn encode_cover_falls_back_to_byte_sniffing() {
    // 未设置 MIME 声明（`mime_type` 为 None）→ 按字节探测 image/png
    let png = tiny_png_bytes();
    let pic = Picture::unchecked(png.clone())
        .pic_type(PictureType::CoverFront)
        .build();
    let (data_url, mime) = encode_cover(pic);
    assert_eq!(mime.as_deref(), Some("image/png"));
    let url = data_url.expect("应有 data URL");
    assert!(url.starts_with("data:image/png;base64,"));
}

#[test]
fn decode_cover_bad_base64_returns_err() {
    let res = decode_cover("data:image/png;base64,@@@not-base64@@@");
    assert!(res.is_err(), "坏 base64 应返回 Err");
    assert!(res.unwrap_err().contains("base64 解码失败"));
}

#[test]
fn decode_cover_unrecognized_mime_returns_err() {
    // 字节无法识别为图片格式 → Err
    let res = decode_cover(&format!(
        "data:application/octet-stream;base64,{}",
        BASE64.encode(b"not an image")
    ));
    assert!(res.is_err(), "MIME 探测失败应返回 Err");
    assert!(res.unwrap_err().contains("封面格式无法识别"));
}

/// 生成指定尺寸的 PNG 字节（`image` crate 编码）。
fn png_of_size(w: u32, h: u32) -> Vec<u8> {
    use std::io::Cursor;
    let mut buf = Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
        w,
        h,
        image::Rgba([12, 34, 56, 255]),
    ))
    .write_to(&mut buf, image::ImageFormat::Png)
    .expect("编码测试 PNG 失败");
    buf.into_inner()
}

/// 生成指定尺寸的 JPEG 字节（RGB，`image` crate 编码）。
fn jpeg_of_size(w: u32, h: u32) -> Vec<u8> {
    use std::io::Cursor;
    let mut buf = Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(w, h, image::Rgb([12, 34, 56])))
        .write_to(&mut buf, image::ImageFormat::Jpeg)
        .expect("编码测试 JPEG 失败");
    buf.into_inner()
}

/// 生成指定尺寸的 WebP 字节（lossless 编码，`image` crate）。
fn webp_of_size(w: u32, h: u32) -> Vec<u8> {
    use std::io::Cursor;
    let mut buf = Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
        w,
        h,
        image::Rgba([12, 34, 56, 255]),
    ))
    .write_to(&mut buf, image::ImageFormat::WebP)
    .expect("编码测试 WebP 失败");
    buf.into_inner()
}

/// 构造一张可解码的 DDS 图片（DXT1，RGB，`guess_format` 识别为 Dds）。
///
/// 用作「解码成功但重编码失败 → 回退原 bytes」测试素材（D2：DDS 只解码无编码器）。
/// `w`/`h` 必须是 4 的倍数（image crate DXT1 解码要求，否则参数错误）；数据区为
/// `8 × (w/4) × (h/4)` 字节。测试用**一边 >2048** 的大 DDS（如 4096x4）才能绕过
/// `compress_cover` 的「小图原样返回」早退，真正走到 `resized.write_to(Dds)` 的
/// `Err(_)` 回退分支（CR：小 DDS 属空转测试，回退被改坏仍绿）。
fn dds_of_size(w: u32, h: u32) -> Vec<u8> {
    assert!(
        w.is_multiple_of(4) && h.is_multiple_of(4),
        "DDS 宽高须为 4 的倍数，实际 {w}x{h}"
    );
    let mut out = Vec::new();
    out.extend_from_slice(b"DDS ");
    // DDS_HEADER（124 字节，little-endian）
    out.extend_from_slice(&124u32.to_le_bytes()); // dwSize
    let flags: u32 = 0x1 | 0x2 | 0x4 | 0x1000; // CAPS | HEIGHT | WIDTH | PIXELFORMAT
    out.extend_from_slice(&flags.to_le_bytes());
    out.extend_from_slice(&h.to_le_bytes()); // dwHeight
    out.extend_from_slice(&w.to_le_bytes()); // dwWidth
    out.extend_from_slice(&(8 * (w / 4)).to_le_bytes()); // dwPitchOrLinearSize = 一行 DXT1 压缩块字节数
    out.extend_from_slice(&0u32.to_le_bytes()); // dwDepth
    out.extend_from_slice(&0u32.to_le_bytes()); // dwMipMapCount
    out.extend(std::iter::repeat_n(0u8, 44)); // dwReserved1[11]
                                              // DDS_PIXELFORMAT（32 字节）
    out.extend_from_slice(&32u32.to_le_bytes()); // dwSize
    let pf_flags: u32 = 0x4; // DDPF_FOURCC
    out.extend_from_slice(&pf_flags.to_le_bytes());
    out.extend_from_slice(b"DXT1"); // dwFourCC
    out.extend_from_slice(&0u32.to_le_bytes()); // dwRGBBitCount
    out.extend_from_slice(&0u32.to_le_bytes()); // dwRBitMask
    out.extend_from_slice(&0u32.to_le_bytes()); // dwGBitMask
    out.extend_from_slice(&0u32.to_le_bytes()); // dwBBitMask
    out.extend_from_slice(&0u32.to_le_bytes()); // dwABitMask
                                                // dwCaps / dwCaps2 / dwCaps3 / dwCaps4 / dwReserved2
    out.extend_from_slice(&0u32.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes());
    // 每个 4x4 DXT1 数据块（8 字节）：color0 < color1 → 4 色表，像素全取第 4 色
    let block = [0x00, 0x00, 0xFF, 0x7F, 0xFF, 0xFF, 0xFF, 0xFF];
    for _ in 0..(w / 4) * (h / 4) {
        out.extend_from_slice(&block);
    }
    out
}

#[test]
fn compress_cover_small_png_is_returned_unchanged() {
    // ≤2048×2048 且 ≤5MB 的小图 → 原 bytes 原样返回（不放大），mime 保持
    let png = tiny_png_bytes();
    let (out, mime) = compress_cover(&png, "image/png").expect("小图应原样返回");
    assert_eq!(out, png, "小图不放大、原尺寸保留");
    assert_eq!(mime, "image/png");
}

#[test]
fn compress_cover_large_png_is_downscaled_to_2048() {
    // >2048 一边的大图 → 等比缩至 ≤2048×2048，mime 保持 image/png
    let big = png_of_size(3000, 2000);
    let (out, mime) = compress_cover(&big, "image/png").expect("大图应压缩成功");
    assert_eq!(mime, "image/png");
    let img = image::load_from_memory(&out).expect("压缩结果应可解码");
    let (w, h) = img.dimensions();
    assert!(
        w <= MAX_DIM && h <= MAX_DIM,
        "压缩后应 ≤2048×2048，实际 {w}x{h}"
    );
    // 等比：3000x2000 → 2048x1365（单边触 2048）
    assert_eq!((w, h), (2048, 1365), "应等比缩至 2048x1365");
    assert!(out.len() < big.len(), "大 PNG 压缩后应更小");
}

#[test]
fn compress_cover_large_jpeg_is_downscaled_and_reencodes_jpeg() {
    let big = jpeg_of_size(4000, 3000);
    let (out, mime) = compress_cover(&big, "image/jpeg").expect("大 JPEG 应压缩成功");
    assert_eq!(mime, "image/jpeg");
    assert_eq!(
        image::guess_format(&out).expect("压缩结果应为 JPEG"),
        image::ImageFormat::Jpeg
    );
    let img = image::load_from_memory(&out).expect("压缩结果应可解码");
    assert!(
        img.width() <= MAX_DIM && img.height() <= MAX_DIM,
        "压缩后应 ≤2048×2048，实际 {}x{}",
        img.width(),
        img.height()
    );
}

#[test]
fn compress_cover_webp_lossless_reencodes_decodable() {
    // WebP 走 lossless 重编码（image crate 仅支持 lossless）；压缩后仍可解码且 ≤2048
    let big = webp_of_size(3000, 1500);
    let (out, mime) = compress_cover(&big, "image/webp").expect("大 WebP 应压缩成功");
    assert_eq!(mime, "image/webp");
    assert_eq!(
        image::guess_format(&out).expect("压缩结果应为 WebP"),
        image::ImageFormat::WebP
    );
    let img = image::load_from_memory(&out).expect("lossless WebP 压缩结果应可解码");
    assert!(
        img.width() <= MAX_DIM && img.height() <= MAX_DIM,
        "压缩后应 ≤2048×2048"
    );
}

#[test]
fn compress_cover_over_5mb_small_dim_png_returned_unchanged() {
    // >5MB 但双维 ≤2048（design D7 边界）→ 不放大、原尺寸保留原样返回（spec「小图不放大」无 5MB 限定）
    let mut png = png_of_size(400, 300);
    assert!(png.len() < 5 * 1024 * 1024, "400x300 PNG 本身应远小于 5MB");
    // 塞入约 6MB 尾随字节（解码忽略，仅撑大体积到 >5MB）
    png.extend(std::iter::repeat_n(0u8, 6 * 1024 * 1024));
    assert!(png.len() > 5 * 1024 * 1024, "素材体积应 >5MB");
    let (out, mime) = compress_cover(&png, "image/png").expect(">5MB 小图应原样返回不报错");
    assert_eq!(mime, "image/png");
    assert_eq!(
        out, png,
        "双维 ≤2048 的 >5MB 图应原尺寸保留，而非被放大到 2048"
    );
    let img = image::load_from_memory(&out).expect("原样返回的字节应可解码");
    assert_eq!(
        (img.width(), img.height()),
        (400, 300),
        "尺寸应保持 400x300 不被放大"
    );
}

#[test]
fn compress_cover_over_5mb_large_image_is_downscaled() {
    // spec「大图压缩」字面场景：>5MB 且维度过限的大图 → 等比缩至 ≤2048×2048。
    // 既有大图测试（3000x2000 纯色 PNG）字节数远小于 5MB，未严格覆盖「>5MB」条件；
    // 此处造一张 3000x2000 且体积 >5MB 的图（尾随字节撑大，解码忽略，与
    // compress_cover_over_5mb_small_dim_png_returned_unchanged 同一手法），
    // 断言触发压缩路径且嵌入的是压缩图。
    let mut big = png_of_size(3000, 2000);
    big.extend(std::iter::repeat_n(0u8, 6 * 1024 * 1024));
    assert!(big.len() > 5 * 1024 * 1024, "素材体积应 >5MB");
    let (out, mime) = compress_cover(&big, "image/png").expect(">5MB 大图应压缩成功");
    assert_eq!(mime, "image/png");
    let img = image::load_from_memory(&out).expect("压缩结果应可解码");
    assert!(
        img.width() <= MAX_DIM && img.height() <= MAX_DIM,
        ">5MB 大图压缩后应 ≤2048×2048，实际 {}x{}",
        img.width(),
        img.height()
    );
    assert_ne!(out, big, "压缩图不得等于原大图（含尾随字节）");
}

#[test]
fn compress_cover_non_image_bytes_returns_err() {
    // 非图片字节（无合法 magic）→ Err，不进入压缩/回退
    let res = compress_cover(b"not an image at all", "image/png");
    assert!(res.is_err(), "非图片字节应返回 Err");
    assert!(res.unwrap_err().contains("封面格式无法识别"));
}

#[test]
fn compress_cover_reencode_failure_falls_back_to_original_bytes() {
    // 可解码但重编码不支持（DDS 只有解码器）→ 回退原 bytes + 原 mime，静默不阻塞。
    // 必须用一边 >2048 的大 DDS（4096x4）：触发 resize(2048) → write_to(Dds) 必然 Err
    // → 断言回退原 bytes。若用 ≤2048 的小 DDS 会走「小图原样返回」早退，回退分支永远
    // 测不到（CR：原 4x4 素材属空转测试，回退被改坏仍绿）。
    let dds = dds_of_size(4096, 4);
    // 前置守卫：素材可解码，且确实触发压缩路径（至少一边 >2048），防止测试素材失效。
    let img = image::load_from_memory(&dds).expect("DDS 素材应可解码");
    assert!(
        img.width() > MAX_DIM || img.height() > MAX_DIM,
        "素材应至少一边 >2048 才能走到重编码分支，实际 {}x{}",
        img.width(),
        img.height()
    );
    let (out, mime) = compress_cover(&dds, "image/dds").expect("重编码失败应回退而非 Err");
    assert_eq!(out, dds, "重编码失败应回退原 bytes");
    assert_eq!(mime, "image/dds");
}

#[test]
fn compress_cover_mime_kept_for_small_and_large() {
    // mime 逐字保留：小图与压缩路径都返回原 mime 字符串
    let (_, m1) = compress_cover(&tiny_png_bytes(), "image/png").unwrap();
    assert_eq!(m1, "image/png");
    let (_, m2) = compress_cover(&png_of_size(2500, 2500), "image/png").unwrap();
    assert_eq!(m2, "image/png");
    let (_, m3) = compress_cover(&jpeg_of_size(2500, 2500), "image/jpeg").unwrap();
    assert_eq!(m3, "image/jpeg");
}

#[test]
fn cover_from_path_reads_compresses_and_builds_data_url() {
    // 临时文件 → cover_from_path → data URL 可 decode，字节 = 压缩后小图
    let dir = tempfile::tempdir().expect("临时目录");
    let p = dir.path().join("cover.png");
    let big = png_of_size(3000, 2000);
    std::fs::write(&p, &big).expect("写临时封面");
    let input = cover_from_path(&p).expect("cover_from_path 应成功");
    assert_eq!(input.mime, "image/png");
    assert!(input.data_url.starts_with("data:image/png;base64,"));
    let (bytes, mime) = decode_cover(&input.data_url).expect("data URL 应可解码");
    assert_eq!(mime, "image/png");
    let img = image::load_from_memory(&bytes).expect("压缩结果应可解码");
    assert!(
        img.width() <= MAX_DIM && img.height() <= MAX_DIM,
        "嵌入的应为压缩后小图"
    );
    assert_ne!(bytes, big, "嵌入的应是压缩图而非原图");
}

#[test]
fn cover_from_path_missing_file_returns_err() {
    let res = cover_from_path(std::path::Path::new("/nonexistent/cover.png"));
    assert!(res.is_err(), "文件不存在应返回 Err");
    assert!(res.unwrap_err().contains("读取封面文件失败"));
}

#[test]
fn cover_from_path_non_image_file_returns_err() {
    let dir = tempfile::tempdir().expect("临时目录");
    let p = dir.path().join("not_image.txt");
    std::fs::write(&p, b"hello").expect("写临时文件");
    let res = cover_from_path(&p);
    assert!(res.is_err(), "非图片文件应返回 Err");
    assert!(res.unwrap_err().contains("封面格式无法识别"));
}

#[test]
fn cover_from_path_small_image_data_url_is_original_bytes() {
    // 小图不放大：data URL 解出的字节 = 原文件字节
    let dir = tempfile::tempdir().expect("临时目录");
    let p = dir.path().join("small.png");
    let small = tiny_png_bytes();
    std::fs::write(&p, &small).expect("写临时封面");
    let input = cover_from_path(&p).expect("cover_from_path 应成功");
    let (bytes, _) = decode_cover(&input.data_url).expect("data URL 应可解码");
    assert_eq!(bytes, small, "小图应原尺寸保留嵌入");
}
