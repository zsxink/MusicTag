// MusicTag — 文件夹/列表 command 薄壳（design.md §10 分层规范）。
//
// 只做参数接收与对 service 层委托，不含 lofty/IO 逻辑：
// - `pick_folder` → rfd 原生文件夹选择器；
// - `list_songs` → `meta::is_audio_file` 过滤 + `reader::read_summary` 读 title/artist。
// `#[tauri::command]` 与 Tauri command 字符串契约零改动。

use crate::model::SongSummary;
use crate::service::meta::is_audio_file;
use crate::service::reader::read_summary;
use walkdir::WalkDir;

/// 打开原生文件夹选择器。取消返回 `None`，否则返回目录绝对路径。
#[tauri::command]
pub fn pick_folder() -> Option<String> {
    rfd::FileDialog::new()
        .pick_folder()
        .map(|dir| dir.to_string_lossy().into_owned())
}

/// 深度遍历 `dir` 收集全部 FLAC/MP3，返回只读列表项。
#[tauri::command]
pub fn list_songs(dir: String) -> Vec<SongSummary> {
    WalkDir::new(&dir)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file() && is_audio_file(entry.path()))
        .map(|entry| read_summary(entry.path()))
        .collect()
}
