// MusicTag — 单曲读/存/改名 command 薄壳（design.md §10 分层规范）。
//
// 只做参数接收与对 service 层委托，不含 lofty/IO 逻辑：
// - `open_song` → `reader::read_song_meta`（读失败 → Err，前端坏标签只读）；
// - `save_song` → `writer::save_song`（probe→clear→apply_meta→write_atomic）；
// - `rename_song` → `service::rename::rename_song`（音频 + `.lrc` 改名，独立动作）。
// `#[tauri::command]` 与 Tauri command 字符串契约零改动。

use crate::model::Song;
use crate::service::reader::read_song_meta;
use std::path::Path;

/// 读取单曲完整标签并返回（open_song command）。
///
/// 入参为 `String` 与 `list_songs` 一致（列表项 `path` 直接透传），Tauri 自动转 PathBuf。
#[tauri::command]
pub fn open_song(path: String) -> Result<Song, String> {
    read_song_meta(Path::new(&path))
}

/// 保存当前编辑表单，全量覆盖写回原路径（语义见 `service::writer::save_song`）。
///
/// `export_lrc`（D3）：复选框 opt-in 同步写同目录同名 `.lrc`，前端 `exportLrc`
/// 经 Tauri camelCase↔snake_case 自动映射到此参数。
#[tauri::command]
pub fn save_song(song: Song, export_lrc: bool) -> Result<(), String> {
    crate::service::writer::save_song(song, export_lrc)
}

/// 改文件名（独立动作，FR-5.5）：音频 + 同名 `.lrc` 一并改名（语义见
/// `service::rename::rename_song`）。撞名拒绝覆盖；`.lrc` 纯扩展名变化不动（FR-4.6a）。
///
/// `new_name` 参数由前端计算（`replaceFileName`），Rust 侧只按 name 改名不返回新路径
/// （design.md D4 契约：`rename_song(path, new_name) -> Result<(), String>`）。
#[tauri::command]
pub fn rename_song(path: String, new_name: String) -> Result<(), String> {
    crate::service::rename::rename_song(Path::new(&path), &new_name)
}
