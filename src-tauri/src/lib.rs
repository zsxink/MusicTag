// MusicTag — Tauri 2 应用壳入口。
//
// 壳内注册业务 command：
// - `pick_folder` / `list_songs`（v1-folder-list）
// - `open_song` / `save_song`（v1-song-read / v1-song-save）
// - `pick_cover_file` / `read_cover_path`（v1-cover-embed）
// - `rename_song`（v1-rename-sync，音频 + `.lrc` 改名）
// - `search_song` / `fetch_lyric` / `download_cover`（v1-search-backend，五源并发搜索）
// - `search_source`（v1-search-fixes，单源搜索：C2 换源绕过聚合去重）
// 后续子变更在此逐个追加 `tauri::generate_handler![...]`。
//
// 模块声明必须 `pub`：`src-tauri/tests/` 集成测试经 `app_lib::` 访问
// commands/service（design.md §10 分层规范）。

pub mod commands;
pub mod model;
pub mod service;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::folder::pick_folder,
            commands::folder::list_songs,
            commands::song::open_song,
            commands::song::save_song,
            commands::song::rename_song,
            commands::cover::pick_cover_file,
            commands::cover::read_cover_path,
            commands::search::search_song,
            commands::search::search_source,
            commands::search::fetch_lyric,
            commands::search::download_cover,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
