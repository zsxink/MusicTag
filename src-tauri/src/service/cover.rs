// MusicTag — 封面 base64 data URL 编解码 + 嵌入压缩（design.md §10.0 / D1–D2）。
//
// 封面跨 IPC 用 base64 data URL（`data:<mime>;base64,...`）传递：
// - 读侧 `encode_cover`：lofty Picture → data URL + MIME；
// - 写侧 `decode_cover`：data URL → 原始字节 + MIME；
// - 嵌入侧 `compress_cover`（>2048 或 >5MB 等比缩至 ≤2048×2048）+ `cover_from_path`
//   （文件 → 压缩 → data URL），供 `pick_cover_file` / `read_cover_path`（v1-cover-embed）。
// `encode_cover`/`decode_cover`/`compress_cover` 不触碰文件系统，纯逻辑单测内联在本文件。

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use image::GenericImageView;

/// 组装封面 base64 data URL：`data:<mime>;base64,...`。
///
/// MIME 优先用 lofty `Picture::mime_type()`（内嵌自带声明），为空时退回
/// `image::guess_format` 按字节探测（design.md D3）。
pub fn encode_cover(picture: lofty::picture::Picture) -> (Option<String>, Option<String>) {
    let bytes = picture.data();
    let mime = picture
        .mime_type()
        .map(|m| m.as_str().to_string())
        .or_else(|| {
            image::guess_format(bytes)
                .ok()
                .map(|f| f.to_mime_type().to_string())
        });

    let Some(mime) = mime else {
        // 探测不出 MIME 时仍给 data URL，用通用 MIME 兜底。
        return (
            Some(encode_data_url(bytes, "application/octet-stream")),
            None,
        );
    };

    (Some(encode_data_url(bytes, &mime)), Some(mime))
}

/// 编码 `bytes` + `mime` → base64 data URL。
pub fn encode_data_url(bytes: &[u8], mime: &str) -> String {
    let b64 = BASE64.encode(bytes);
    format!("data:{mime};base64,{b64}")
}

/// 解码封面 base64 data URL：`data:<mime>;base64,...` → `(bytes, mime)`。
///
/// MIME 优先取 data URL 前缀；缺省用 `image::guess_format` 按字节探测
/// （与读侧 `encode_cover` 对称）。探测失败返回 `Err`（拒绝写坏封面）。
pub fn decode_cover(cover: &str) -> Result<(Vec<u8>, String), String> {
    // 剥离 `data:<mime>;base64,` 前缀（无前缀时按纯 base64 处理）。
    let (prefix, b64) = match cover.split_once(',') {
        Some((head, tail)) if head.starts_with("data:") && head.ends_with(";base64") => {
            let mime = head
                .strip_prefix("data:")
                .and_then(|m| m.strip_suffix(";base64"))
                .unwrap_or_default();
            (Some(mime.to_string()), tail)
        }
        _ => (None, cover),
    };

    let bytes = BASE64
        .decode(b64)
        .map_err(|e| format!("封面 base64 解码失败: {e}"))?;

    let mime = match prefix {
        Some(m) if !m.is_empty() && m != "application/octet-stream" => m,
        _ => image::guess_format(&bytes)
            .map(|f| f.to_mime_type().to_string())
            .map_err(|_| "封面格式无法识别".to_string())?,
    };

    Ok((bytes, mime))
}

/// 封面最大边长（PRD §5.3 / D2：压缩目标 ≤2048×2048）。
const MAX_DIM: u32 = 2048;
/// 封面最大字节数（PRD §5.3 / D2：>5MB 触发压缩）。
const MAX_BYTES: usize = 5 * 1024 * 1024;

/// 压缩封面：任一边 >2048 或 `bytes` >5MB → 等比缩至 ≤2048×2048（Lanczos3）；
/// 小图（≤2048×2048 且 ≤5MB）**不放大**、原尺寸保留原样返回。
///
/// 返回 `(压缩后 bytes, 原 mime)`。语义（D2）：
/// - 解码失败（非图片字节）→ `Err("封面格式无法识别")`（与 `decode_cover` 对称，前端不预览不嵌入）；
/// - 仅重编码失败（解码已成功）→ 回退**原 bytes**（静默保留，不阻塞嵌入）。
pub fn compress_cover(bytes: &[u8], mime: &str) -> Result<(Vec<u8>, String), String> {
    let img = image::load_from_memory(bytes)
        .map_err(|_| "封面格式无法识别".to_string())?;

    let (w, h) = img.dimensions();
    if w <= MAX_DIM && h <= MAX_DIM && bytes.len() <= MAX_BYTES {
        // 小图不放大、原尺寸保留嵌入（PRD §5.3）。
        return Ok((bytes.to_vec(), mime.to_string()));
    }

    // 原格式判定：MIME 优先，兜底按字节探测。
    let format = image::ImageFormat::from_mime_type(mime)
        .or_else(|| image::guess_format(bytes).ok());

    // 触发压缩但无法判定格式（理论不可达：解码已成功即可 guess_format）→ 原样回退。
    let Some(format) = format else {
        return Ok((bytes.to_vec(), mime.to_string()));
    };

    // 等比缩放至 ≤2048×2048（`DynamicImage::resize` 保持宽高比，保证单边 ≤2048）。
    let resized = img.resize(MAX_DIM, MAX_DIM, image::imageops::FilterType::Lanczos3);

    let mut buf = std::io::Cursor::new(Vec::new());
    match resized.write_to(&mut buf, format) {
        Ok(()) => Ok((buf.into_inner(), mime.to_string())),
        // 仅重编码失败（解码已成功，极罕见）→ 回退原 bytes，静默保留不阻塞嵌入（D2）。
        Err(_) => Ok((bytes.to_vec(), mime.to_string())),
    }
}

/// 读封面文件 → `compress_cover` → data URL（D2 编排，command 薄壳只委托）。
///
/// `std::fs::read` 失败（不存在/权限）或非图片字节 → `Err(中文原因)`。
/// MIME 先按字节探测（`image::guess_format`），再交给 `compress_cover`（小图原样返回时
/// mime 不丢）；返回的 `data_url` 即为压缩后小图；原图字节丢弃
/// （PRD §5.3 决策 A：进标签的是 ≤2048 压缩图）。
pub fn cover_from_path(path: &std::path::Path) -> Result<crate::model::CoverInput, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("读取封面文件失败: {e}"))?;
    let mime = image::guess_format(&bytes)
        .map(|f| f.to_mime_type().to_string())
        .map_err(|_| "封面格式无法识别".to_string())?;
    let (compressed, mime) = compress_cover(&bytes, &mime)?;
    Ok(crate::model::CoverInput {
        data_url: encode_data_url(&compressed, &mime),
        mime,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
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
        image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
            w,
            h,
            image::Rgb([12, 34, 56]),
        ))
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
    fn tiny_dds_bytes() -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(b"DDS ");
        // DDS_HEADER（124 字节，little-endian）
        out.extend_from_slice(&124u32.to_le_bytes()); // dwSize
        let flags: u32 = 0x1 | 0x2 | 0x4 | 0x1000; // CAPS | HEIGHT | WIDTH | PIXELFORMAT
        out.extend_from_slice(&flags.to_le_bytes());
        out.extend_from_slice(&4u32.to_le_bytes()); // dwHeight
        out.extend_from_slice(&4u32.to_le_bytes()); // dwWidth
        out.extend_from_slice(&32u32.to_le_bytes()); // dwPitchOrLinearSize
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
        // 一个 4x4 DXT1 数据块（8 字节）：color0 < color1 → 4 色表，像素全取第 4 色
        out.extend_from_slice(&[0x00, 0x00, 0xFF, 0x7F]); // color0=0x0000 color1=0x7FFF
        out.extend_from_slice(&[0xFF, 0xFF, 0xFF, 0xFF]); // 每像素 2bit 全 11
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
    fn compress_cover_bytes_over_5mb_triggers_compression() {
        // >5MB 但双维 ≤2048 → 触发压缩路径；维度已达标无法再缩，但不得报错
        let mut png = png_of_size(400, 300);
        // 塞入约 6MB 尾随字节（解码忽略，仅撑大体积触发 >5MB 分支）
        png.extend(std::iter::repeat_n(0u8, 6 * 1024 * 1024));
        let (out, mime) = compress_cover(&png, "image/png").expect(">5MB 应触发压缩不报错");
        assert_eq!(mime, "image/png");
        let img = image::load_from_memory(&out).expect("压缩结果应可解码");
        assert!(
            img.width() <= MAX_DIM && img.height() <= MAX_DIM,
            "压缩后应 ≤2048×2048"
        );
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
        // 可解码但重编码不支持（DDS 只有解码器）→ 回退原 bytes + 原 mime，静默不阻塞
        let dds = tiny_dds_bytes();
        // 先确认素材可解码（前置守卫，防止测试素材本身失效）
        image::load_from_memory(&dds).expect("DDS 素材应可解码");
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
}
