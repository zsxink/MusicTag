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
