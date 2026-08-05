// MusicTag — 封面 base64 data URL 编解码 + 嵌入压缩（design.md §10.0 / D1–D2）。
//
// 封面跨 IPC 用 base64 data URL（`data:<mime>;base64,...`）传递：
// - 读侧 `encode_cover`：lofty Picture → data URL + MIME；
// - 写侧 `decode_cover`：data URL → 原始字节 + MIME；
// - 嵌入侧 `compress_cover`（任一边 >2048 等比缩至 ≤2048×2048；双维 ≤2048 的图无论体积原样返回）+ `cover_from_path`
//   （文件 → 压缩 → data URL），供 `pick_cover_file` / `read_cover_path`（v1-cover-embed）。
// `encode_cover`/`decode_cover`/`compress_cover` 不触碰文件系统；单测外置
// `src-tauri/tests/service_cover_tests.rs`（rust-tests-separation：`src/` 零 `#[cfg(test)]`）。

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
///
/// `pub`：供 `src-tauri/tests/service_cover_tests.rs` 锁定压缩边界断言
/// （rust-tests-separation 单测外置；集成测试是独立 crate，仅 `pub` 可见，
/// design.md 原 `pub(crate)` 方案经实测 E0603 不可行，改为 `pub`）。
pub const MAX_DIM: u32 = 2048;

/// 压缩封面：任一边 >2048 → 等比缩至 ≤2048×2048（Lanczos3）；
/// 双维 ≤2048 的图（无论体积，含 >5MB）**不放大**、原尺寸保留原样返回
/// （spec「小图不放大」无 5MB 限定；design D7「>5MB 触发但双维 ≤2048 → 原样返回」）。
///
/// 返回 `(压缩后 bytes, 原 mime)`。语义（D2）：
/// - 解码失败（非图片字节）→ `Err("封面格式无法识别")`（与 `decode_cover` 对称，前端不预览不嵌入）；
/// - 仅重编码失败（解码已成功）→ 回退**原 bytes**（静默保留，不阻塞嵌入）。
pub fn compress_cover(bytes: &[u8], mime: &str) -> Result<(Vec<u8>, String), String> {
    let img = image::load_from_memory(bytes).map_err(|_| "封面格式无法识别".to_string())?;

    let (w, h) = img.dimensions();
    if w <= MAX_DIM && h <= MAX_DIM {
        // 双维 ≤2048 不放大、原尺寸保留嵌入（spec「小图不放大」）；>5MB 但维度已达标
        // 无法再缩（等比目标已满足），同样原样返回（design D7）。
        return Ok((bytes.to_vec(), mime.to_string()));
    }

    // 原格式判定：MIME 优先，兜底按字节探测。
    let format =
        image::ImageFormat::from_mime_type(mime).or_else(|| image::guess_format(bytes).ok());

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

