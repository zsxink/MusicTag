// MusicTag — 封面选择/拖拽 command 薄壳（design.md §10 分层规范，v1-cover-embed）。
//
// 只做参数接收与对 service 层委托，不含压缩/IO 逻辑（都在 `service::cover`）：
// - `pick_cover_file` → rfd 原生文件对话框（jpg/png/webp 过滤器），选中 → `cover_from_path`；
// - `read_cover_path` → 拖拽路径 → `cover_from_path`（读 + 压缩 + data URL）。
// 无独立 `embed_cover`：封面一律并入 `save_song` 写盘（design.md §10.3）。
//
// `pick_cover_file` 是同步 command（同 `pick_folder` 既有模式：macOS 对话框须主线程）。

use crate::model::CoverInput;
use crate::service::cover::cover_from_path;
use std::path::Path;

/// 打开原生封面文件选择器（jpg/png/webp）。取消返回 `None`，否则返回压缩后 data URL + mime。
#[tauri::command]
pub fn pick_cover_file() -> Option<CoverInput> {
    rfd::FileDialog::new()
        .add_filter("图片", &["jpg", "jpeg", "png", "webp"])
        .pick_file()
        .and_then(|path| cover_from_path(&path).ok())
}

/// 读取拖拽路径的封面文件：读文件 → 压缩 → data URL。读失败/非图片 → `Err(中文原因)`。
#[tauri::command]
pub fn read_cover_path(path: String) -> Result<CoverInput, String> {
    cover_from_path(Path::new(&path))
}

#[cfg(test)]
mod tests {
    use super::*;

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
        // 2x2 红色 PNG（与 service 层同一编码路径）
        let png = {
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
        };
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
}
