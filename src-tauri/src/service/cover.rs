// MusicTag — 封面 base64 data URL 编解码（纯逻辑，无文件系统操作）。
//
// 封面跨 IPC 用 base64 data URL（`data:<mime>;base64,...`）传递（design.md D3/D4）：
// - 读侧 `encode_cover`：lofty Picture → data URL + MIME；
// - 写侧 `decode_cover`：data URL → 原始字节 + MIME。
// 本模块不触碰文件系统，纯逻辑单测内联在本文件。

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};

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

#[cfg(test)]
mod tests {
    use super::*;
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
}
