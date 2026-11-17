// MusicTag — 封面选择/拖拽/导出 command 薄壳（design.md §10 分层规范，v1-cover-embed /
// export-embedded-cover）。
//
// 只做参数接收与对 service 层委托，不含压缩/IO 逻辑（都在 `service::cover`）：
// - `pick_cover_file` → rfd 原生文件对话框（jpg/png/webp 过滤器），选中 → `cover_input_for_selection`
//   → `cover_from_path`；取消 `Ok(None)`，选中后读/识别/压缩失败原样返回中文 `Err`（不再 `.ok()`
//   把失败伪装成取消，见 rust-review-hardening §4.5）；
// - `read_cover_path` → 拖拽路径 → `cover_from_path`（读 + 压缩 + data URL）；
// - `pick_cover_save_path` → rfd 原生存盘对话框取导出目标路径（**只取路径，不写盘**）；
// - `export_cover` → 纯写盘，无任何 UI（前端在拿到路径后才调）。
// 无独立 `embed_cover`：封面一律并入 `save_song` 写盘（design.md §10.3）。
//
// `pick_cover_file` / `pick_cover_save_path` 是同步 command（同 `pick_folder` 既有模式：
// macOS 原生对话框须主线程，套 `spawn_blocking` 会让 `NSSavePanel` 在 worker 线程构造而崩）。

use crate::model::CoverInput;
use crate::service::cover::{
    cover_extension_for, cover_from_path, default_cover_file_name, export_cover_bytes,
    write_cover_to,
};
use std::path::{Path, PathBuf};

/// 打开原生封面文件选择器（jpg/png/webp）。
///
/// 取消 → `Ok(None)`；选中 → 读文件/格式识别/压缩，任一步失败原样返回中文 `Err`（不伪装成取消）。
#[tauri::command]
pub fn pick_cover_file() -> Result<Option<CoverInput>, String> {
    cover_input_for_selection(
        rfd::FileDialog::new()
            .add_filter("图片", &["jpg", "jpeg", "png", "webp"])
            .pick_file(),
    )
}

/// 「对话框选择结果 → command 结果」映射，rfd 对话框无头不可测，故独立成 helper 供测试直接覆盖。
///
/// `None`（取消）→ `Ok(None)`；`Some(path)` → `cover_from_path` 的 `Result` 原样传播
/// （读失败/格式无法识别/压缩失败均为既有中文 `Err`）。
pub fn cover_input_for_selection(selection: Option<PathBuf>) -> Result<Option<CoverInput>, String> {
    selection.map(|path| cover_from_path(&path)).transpose()
}

/// 读取拖拽路径的封面文件：读文件 → 压缩 → data URL。读失败/非图片 → `Err(中文原因)`。
#[tauri::command]
pub fn read_cover_path(path: String) -> Result<CoverInput, String> {
    cover_from_path(Path::new(&path))
}

/// 弹出原生存盘对话框，取内嵌封面导出的目标路径；**不写任何文件**（export-embedded-cover）。
///
/// 读标签只为算默认文件名与过滤器扩展名；读失败/无内嵌封面 → `Err(中文原因)` 且**不弹框**
/// （无封面时导出本就不该发生）。取消 → `Ok(None)`（取消是正常选择而非错误）。
///
/// 同步 command：macOS 原生对话框须主线程（同 `pick_cover_file` / `pick_folder`）。
#[tauri::command]
pub fn pick_cover_save_path(song_path: String) -> Result<Option<String>, String> {
    let song = Path::new(&song_path);
    let (bytes, mime) = export_cover_bytes(song)?;

    let ext = cover_extension_for(mime.as_deref(), &bytes);
    let default_name = default_cover_file_name(song, mime.as_deref(), &bytes);

    // 默认目录 = 源音频所在目录（「整理封面时取回原图」的自用场景）；用户可在框内改。
    let mut dialog = rfd::FileDialog::new()
        .set_title("导出封面")
        .set_file_name(&default_name)
        .add_filter(ext, &[ext]);
    if let Some(parent) = song
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        dialog = dialog.set_directory(parent);
    }

    Ok(dialog
        .save_file()
        .map(|dest| dest.to_string_lossy().into_owned()))
}

/// 把标签内封面（优先第一个 `CoverFront`，无则第一张；通用标签完全无图时再回退
/// APE 原生 `Cover Art (Front)`）的**原始字节**写到 `dest_path`（纯写盘，无 UI）。
///
/// 只读保证：全程只 `Probe::open(..).read()` + `File::open`，唯一写入是 `fs::write(dest_path, ..)`，
/// 绝不调 `Tag::save_to` / `write_atomic` / `save_song`。不重算扩展名、不校验 `dest_path`
/// 扩展名——用户在存盘框里改名改扩展名是用户的决定。
#[tauri::command]
pub fn export_cover(song_path: String, dest_path: String) -> Result<(), String> {
    let (bytes, _) = export_cover_bytes(Path::new(&song_path))?;
    write_cover_to(Path::new(&dest_path), &bytes)
}
