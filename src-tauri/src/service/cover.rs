// MusicTag — 封面 base64 data URL 编解码 + 嵌入压缩 + 内嵌原图导出
// （design.md §10.0 / D1–D2，export-embedded-cover §3）。
//
// 封面跨 IPC 用 base64 data URL（`data:<mime>;base64,...`）传递：
// - 读侧 `encode_cover`：lofty Picture → data URL + MIME；
// - 写侧 `decode_cover`：data URL → 原始字节 + MIME；
// - 嵌入侧 `compress_cover`（任一边 >2048 等比缩至 ≤2048×2048；双维 ≤2048 的图无论体积原样返回）+ `cover_from_path`
//   （文件 → 压缩 → data URL），供 `pick_cover_file` / `read_cover_path`（v1-cover-embed）；
// - 导出侧 `export_cover_bytes` / `cover_extension_for` / `default_cover_file_name` / `write_cover_to`
//   （标签内嵌**原始字节**出盘，**不过 `compress_cover`**，供 `pick_cover_save_path` / `export_cover`）。
// `encode_cover`/`decode_cover`/`compress_cover` 不触碰文件系统；单测外置
// `src-tauri/tests/service_cover_tests.rs`（rust-tests-separation：`src/` 生产代码零 cfg(test)）。

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use image::{GenericImageView, ImageFormat};
use lofty::prelude::TaggedFileExt;
use lofty::probe::Probe;

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

/// 读单曲标签内**第一个 front cover 的原始字节** + 其声明 MIME（export-embedded-cover）。
///
/// 与嵌入路径的关键差别：**不经 `compress_cover`**，导出的是 `Picture::data()` 原样字节
/// （spec「非 ≤2048 压缩预览图」）。取图一律经 `reader::first_embedded_picture`，
/// 以复用其 APE 原生封面回退——否则 APE 文件会被误判为「没有内嵌封面」。
///
/// 全程只读（`Probe::open(..).read()` + `File::open`），绝不触碰标签写盘路径。
pub fn export_cover_bytes(
    song_path: &std::path::Path,
) -> Result<(Vec<u8>, Option<String>), String> {
    let tagged_file = Probe::open(song_path)
        .and_then(|probed| probed.read())
        .map_err(|e| format!("读取标签失败: {e}"))?;

    let picture =
        crate::service::reader::first_embedded_picture(song_path, tagged_file.primary_tag())
            .ok_or_else(|| "该歌曲没有内嵌封面".to_string())?;

    Ok((
        picture.data().to_vec(),
        picture.mime_type().map(|m| m.as_str().to_string()),
    ))
}

/// 按图片 MIME（缺省按字节探测）推断存盘对话框用的扩展名（spec S3）。
///
/// 判定顺序与 `encode_cover` 一致：先 `Picture::mime_type()`，为空才 `guess_format(bytes)`。
/// 判不出（未知 mime + 非图片字节，如 `application/octet-stream`）统一兜底 `"jpg"`。
///
/// `ImageFormat` → 扩展名的表**手写**：`image` 0.25.10 只有 `extensions_str()`
/// （会给出 `["jpg", "jpeg"]` 这种多扩展名切片），没有可直接用的单扩展名方法，
/// 而存盘对话框的过滤器要的是单一确定扩展名（spec jpeg → `.jpg`）。
pub fn cover_extension_for(mime: Option<&str>, bytes: &[u8]) -> &'static str {
    match format_of(mime, bytes) {
        Some(ImageFormat::Jpeg) => "jpg",
        Some(ImageFormat::Png) => "png",
        Some(ImageFormat::Gif) => "gif",
        Some(ImageFormat::WebP) => "webp",
        Some(ImageFormat::Tiff) => "tiff",
        Some(ImageFormat::Bmp) => "bmp",
        Some(ImageFormat::Tga) => "tga",
        Some(ImageFormat::Ico) => "ico",
        Some(ImageFormat::Pnm) => "pnm",
        Some(ImageFormat::Hdr) => "hdr",
        Some(ImageFormat::OpenExr) => "exr",
        Some(ImageFormat::Avif) => "avif",
        Some(ImageFormat::Qoi) => "qoi",
        Some(ImageFormat::Dds) => "dds",
        // 兜底 `.jpg`：`Farbefeld` 等冷门格式与判不出格式的情况按 spec 走 jpg。
        _ => "jpg",
    }
}

/// 图片格式判定：MIME 优先，判不出才按字节嗅探。与 `encode_cover` 同序（design.md §3.3）。
///
/// 单独成函数而非内联进 `cover_extension_for`，是为了让 `#[non_exhaustive]` 的
/// `ImageFormat` 只在一个 `match` 里被解构——image 后续新增变体时编译器只指向这一处。
fn format_of(mime: Option<&str>, bytes: &[u8]) -> Option<ImageFormat> {
    mime.and_then(ImageFormat::from_mime_type)
        .or_else(|| image::guess_format(bytes).ok())
}

/// 存盘对话框的默认文件名：音频文件名去扩展名 + 推断出的图片扩展名（spec S3）。
///
/// stem 为空（如路径以分隔符结尾）→ 兜底 `"cover"`，只影响默认名，不阻断流程。
pub fn default_cover_file_name(
    audio_path: &std::path::Path,
    mime: Option<&str>,
    bytes: &[u8],
) -> String {
    let ext = cover_extension_for(mime, bytes);
    let stem = audio_path
        .file_stem()
        .map(|stem| stem.to_string_lossy())
        .unwrap_or_default();
    let stem = if stem.is_empty() { "cover" } else { &stem };
    format!("{stem}.{ext}")
}

/// 把导出字节写到 `dest_path`：直接 `fs::write`，**不做原子替换、不做备份、
/// 不做撞名保护**（design.md §3.4：目标是用户在存盘对话框里选定的新路径，
/// 覆盖与否是用户显式授权；产品约束本就是「直接写盘、无备份、无撤销」）。
/// 写失败 → `Err("导出封面失败: {e}")`，不假报成功。
pub fn write_cover_to(dest_path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    std::fs::write(dest_path, bytes).map_err(|e| format!("导出封面失败: {e}"))
}
