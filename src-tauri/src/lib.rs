// MusicTag — Tauri 2 应用壳入口。
//
// 本变更（v1-skeleton-tauri）只铺应用壳：`invoke_handler` 为空壳，
// 不注册任何业务 command（list_songs/open_song/save_song/... 由后续
// v1-folder-list 起逐个 `tauri::generate_handler!` 追加）。

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 空壳：后续子变更在此追加 `tauri::generate_handler![...]`
        .invoke_handler(tauri::generate_handler![])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
