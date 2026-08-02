// MusicTag — Tauri 2 应用壳入口。
//
// 壳内注册业务 command：
// - `pick_folder` / `list_songs`（v1-folder-list）
// - 后续子变更（v1-song-read 起）在此逐个追加 `tauri::generate_handler![...]`。

mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::pick_folder,
            commands::list_songs,
            commands::open_song,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
