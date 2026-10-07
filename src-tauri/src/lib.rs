// MusicTag — Tauri 2 应用壳入口。
//
// 壳内注册业务 command：
// - `pick_folder` / `list_songs`（v1-folder-list）
// - `watch_folder`（issue-123-auto-refresh，当前目录及后代变动通知）
// - `open_song` / `save_song`（v1-song-read / v1-song-save）
// - `pick_cover_file` / `read_cover_path`（v1-cover-embed）
// - `pick_cover_save_path` / `export_cover`（export-embedded-cover，内嵌封面原图只读导出）
// - `rename_song`（v1-rename-sync，音频 + `.lrc` 改名）
// - `search_song` / `fetch_lyric` / `download_cover`（v1-search-backend，五源并发搜索）
// - `search_source`（v1-search-fixes，单源搜索：C2 换源绕过聚合去重）
// - `get_last_dir` / `save_last_dir`（dir-memory，config.json 记住上次打开目录）
// - `scan_missing`（missing-fields-filter，按需只读扫描缺失维度）
// - `check_for_update` / `open_release_page`（issue-158，正式版检查与详情链接）
// 后续子变更在此逐个追加 `tauri::generate_handler![...]`。
//
// 模块声明必须 `pub`：`src-tauri/tests/` 集成测试经 `app_lib::` 访问
// commands/service（design.md §10 分层规范）。

pub mod commands;
pub mod model;
pub mod service;

#[cfg(desktop)]
use tauri::Emitter;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .manage(service::folder_watch::FolderWatch::default())
        .invoke_handler(tauri::generate_handler![
            commands::folder::pick_folder,
            commands::folder::list_songs,
            commands::folder::watch_folder,
            commands::folder::get_last_dir,
            commands::folder::save_last_dir,
            commands::missing::scan_missing,
            commands::song::open_song,
            commands::song::save_song,
            commands::song::rename_song,
            commands::cover::pick_cover_file,
            commands::cover::read_cover_path,
            commands::cover::pick_cover_save_path,
            commands::cover::export_cover,
            commands::search::search_song,
            commands::search::search_source,
            commands::search::fetch_lyric,
            commands::search::download_cover,
            commands::update::check_for_update,
            commands::update::open_release_page,
        ]);

    #[cfg(desktop)]
    let builder = builder
        .menu(|app| {
            use tauri::menu::{Menu, MenuItem, Submenu, HELP_SUBMENU_ID};

            // 保留系统编辑/窗口菜单（macOS 还需要首个应用菜单），替换帮助入口。
            let menu = Menu::default(app)?;
            if let Some(help) = menu.get(HELP_SUBMENU_ID) {
                menu.remove(&help)?;
            }
            let check =
                MenuItem::with_id(app, "check-for-update", "检查更新…", true, None::<&str>)?;
            let about = MenuItem::with_id(app, "show-about", "关于", true, None::<&str>)?;
            let help =
                Submenu::with_id_and_items(app, HELP_SUBMENU_ID, "帮助", true, &[&check, &about])?;
            menu.append(&help)?;
            Ok(menu)
        })
        .on_menu_event(|app, event| {
            let action = match event.id().as_ref() {
                "check-for-update" => "check-for-update",
                "show-about" => "show-about",
                _ => return,
            };
            let _ = app.emit("update-menu-action", action);
        });

    builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                app.state::<service::folder_watch::FolderWatch>().shutdown();
            }
        });
}
