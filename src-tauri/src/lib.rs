// MusicTag — Tauri 2 应用壳入口。

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
        .manage(MenuState::default())
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
            commands::update::get_last_update_check_at,
            commands::update::save_last_update_check_at,
            commands::menu::sync_menu_state,
        ]);

    #[cfg(desktop)]
    let builder = builder.menu(build_menu).on_menu_event(|app, event| {
        let Some(action) = action_for_menu_id(event.id().as_ref()) else {
            return;
        };
        if !app.state::<MenuState>().is_enabled(action) {
            return;
        }
        match action {
            "close-window" => {
                if let Some(window) = app.webview_windows().values().next() {
                    let _ = window.close();
                }
            }
            "quit" => app.exit(0),
            "show-about" => {
                let _ = app.emit("app-menu-action", action);
            }
            #[cfg(debug_assertions)]
            "toggle-devtools" => {
                if let Some(window) = app.webview_windows().values().next() {
                    if window.is_devtools_open() {
                        let _ = window.close_devtools();
                    } else {
                        let _ = window.open_devtools();
                    }
                }
            }
            _ => {
                let _ = app.emit("app-menu-action", action);
            }
        }
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

pub struct MenuState(std::sync::Mutex<std::collections::HashMap<String, bool>>);

impl Default for MenuState {
    fn default() -> Self {
        let mut enabled = std::collections::HashMap::new();
        for id in [
            "open-folder",
            "close-window",
            "quit",
            "undo",
            "redo",
            "cut",
            "copy",
            "paste",
            "select-all",
            "toggle-theme",
            "reload",
            "toggle-devtools",
            "check-for-update",
        ] {
            enabled.insert(id.to_string(), true);
        }
        enabled.insert("save".to_string(), false);
        enabled.insert("rescan-folder".to_string(), false);
        enabled.insert("show-about".to_string(), false);
        Self(std::sync::Mutex::new(enabled))
    }
}

impl MenuState {
    pub fn is_enabled(&self, id: &str) -> bool {
        self.0
            .lock()
            .ok()
            .and_then(|state| state.get(id).copied())
            .unwrap_or(false)
    }

    pub fn snapshot(&self) -> std::collections::HashMap<String, bool> {
        self.0.lock().map(|state| state.clone()).unwrap_or_default()
    }
}

#[cfg(desktop)]
pub(crate) fn build_menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    build_menu_with_states(app, &std::collections::HashMap::new())
}

#[cfg(desktop)]
pub(crate) fn build_menu_with_states(
    app: &tauri::AppHandle,
    states: &std::collections::HashMap<String, (bool, bool)>,
) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{Menu, PredefinedMenuItem, Submenu};
    let menu = Menu::new(app)?;
    let item = |id, label, default| {
        let (enabled, visible) = states.get(id).copied().unwrap_or((default, true));
        menu_item(app, id, label, enabled && visible)
    };
    #[cfg(target_os = "macos")]
    {
        let app_menu = Submenu::with_id_and_items(
            app,
            "application",
            "MusicTag",
            true,
            &[
                &item("show-about", "关于", false)?,
                &PredefinedMenuItem::services(app, Some("Services"))?,
                &PredefinedMenuItem::hide(app, Some("Hide"))?,
                &PredefinedMenuItem::quit(app, Some("Quit"))?,
            ],
        )?;
        menu.append(&app_menu)?;
    }
    let file = Submenu::with_id_and_items(
        app,
        "file",
        "文件",
        true,
        &[
            &item("open-folder", "打开文件夹…", true)?,
            &item("save", "保存", false)?,
            &item("rescan-folder", "重新扫描当前文件夹", false)?,
            &item("close-window", "关闭窗口", true)?,
            &item("quit", "退出", true)?,
        ],
    )?;
    let edit = Submenu::with_id_and_items(
        app,
        "edit",
        "编辑",
        true,
        &[
            &PredefinedMenuItem::undo(app, Some("撤销"))?,
            &PredefinedMenuItem::redo(app, Some("重做"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some("剪切"))?,
            &PredefinedMenuItem::copy(app, Some("复制"))?,
            &PredefinedMenuItem::paste(app, Some("粘贴"))?,
            &PredefinedMenuItem::select_all(app, Some("全选"))?,
        ],
    )?;
    let view = Submenu::with_id_and_items(
        app,
        "view",
        "视图",
        true,
        &[
            &item("toggle-theme", "切换主题", true)?,
            &item("reload", "重新加载", true)?,
            #[cfg(debug_assertions)]
            &item("toggle-devtools", "开发者工具", true)?,
        ],
    )?;
    let help = Submenu::with_id_and_items(
        app,
        "help",
        "帮助",
        true,
        &[
            &item("check-for-update", "检查更新…", true)?,
            #[cfg(not(target_os = "macos"))]
            &item("show-about", "关于", false)?,
        ],
    )?;
    menu.append(&file)?;
    menu.append(&edit)?;
    menu.append(&view)?;
    menu.append(&help)?;
    Ok(menu)
}

#[cfg(desktop)]
fn menu_item(
    app: &tauri::AppHandle,
    id: &'static str,
    label: &'static str,
    enabled: bool,
) -> tauri::Result<tauri::menu::MenuItem<tauri::Wry>> {
    tauri::menu::MenuItem::with_id(app, id, label, enabled, None::<&str>)
}

pub fn action_for_menu_id(id: &str) -> Option<&'static str> {
    match id {
        "open-folder" => Some("open-folder"),
        "save" => Some("save"),
        "rescan-folder" => Some("rescan-folder"),
        "close-window" => Some("close-window"),
        "quit" => Some("quit"),
        "toggle-theme" => Some("toggle-theme"),
        "reload" => Some("reload"),
        "toggle-devtools" => Some("toggle-devtools"),
        "check-for-update" => Some("check-for-update"),
        "show-about" => Some("show-about"),
        _ => None,
    }
}
