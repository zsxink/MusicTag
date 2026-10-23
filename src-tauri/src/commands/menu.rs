use serde::Deserialize;
use std::collections::HashMap;
use tauri::Manager;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuItemState {
    pub id: String,
    pub enabled: bool,
    pub visible: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MenuStateSnapshot {
    pub items: Vec<MenuItemState>,
}

pub const ACTION_IDS: &[&str] = &[
    "open-folder",
    "save",
    "rescan-folder",
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
    "show-about",
];

pub fn known_action(id: &str) -> bool {
    ACTION_IDS.contains(&id)
}

pub fn apply_snapshot<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    snapshot: MenuStateSnapshot,
) -> Result<(), String> {
    let mut next = HashMap::new();
    for item in snapshot.items {
        if !known_action(&item.id) {
            return Err(format!("未知菜单 action: {}", item.id));
        }
        if next.contains_key(&item.id) {
            return Err(format!("重复菜单 action: {}", item.id));
        }
        next.insert(item.id.clone(), item);
    }

    let state = app.state::<crate::MenuState>();
    let current = state.0.lock().map_err(|error| error.to_string())?.clone();
    let mut effective = current
        .into_iter()
        .map(|(id, enabled)| {
            (
                id.clone(),
                MenuItemState {
                    id,
                    enabled,
                    visible: true,
                },
            )
        })
        .collect::<HashMap<_, _>>();
    effective.extend(next);

    #[cfg(desktop)]
    if app.menu().is_some() {
        let replacement = build_menu(app, &effective)?;
        replacement
            .set_as_app_menu()
            .map_err(|error| error.to_string())?;
        app.set_menu(replacement)
            .map_err(|error| error.to_string())?;
    }

    let mut enabled = state.0.lock().map_err(|error| error.to_string())?;
    *enabled = effective
        .iter()
        .map(|(id, item)| (id.clone(), item.enabled && item.visible))
        .collect();
    Ok(())
}

#[cfg(desktop)]
fn build_menu<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    states: &HashMap<String, MenuItemState>,
) -> Result<tauri::menu::Menu<R>, String> {
    use tauri::menu::{Menu, PredefinedMenuItem, Submenu};
    let menu = Menu::new(app).map_err(|error| error.to_string())?;
    let app_item = |id: &'static str, label: &'static str| -> Result<_, String> {
        let state = states.get(id);
        let enabled = state.map_or(id != "show-about", |state| state.enabled && state.visible);
        let visible = state.map_or(true, |state| state.visible);
        if !visible {
            return Ok(None);
        }
        tauri::menu::MenuItem::with_id(app, id, label, enabled, None::<&str>)
            .map(Some)
            .map_err(|error| error.to_string())
    };
    #[cfg(target_os = "macos")]
    {
        let mut app_items: Vec<Box<dyn tauri::menu::IsMenuItem<R>>> = Vec::new();
        if let Some(about) = app_item("show-about", "关于")? {
            app_items.push(Box::new(about));
        }
        app_items.push(Box::new(
            PredefinedMenuItem::services(app, Some("Services"))
                .map_err(|error| error.to_string())?,
        ));
        app_items.push(Box::new(
            PredefinedMenuItem::hide(app, Some("Hide")).map_err(|error| error.to_string())?,
        ));
        app_items.push(Box::new(
            PredefinedMenuItem::quit(app, Some("Quit")).map_err(|error| error.to_string())?,
        ));
        let app_menu = Submenu::with_id_and_items(
            app,
            "application",
            "MusicTag",
            true,
            &app_items
                .iter()
                .map(|item| item.as_ref())
                .collect::<Vec<_>>(),
        )
        .map_err(|error| error.to_string())?;
        menu.append(&app_menu).map_err(|error| error.to_string())?;
    }
    let menu_item = |id: &'static str, label: &'static str, default: bool| -> Result<_, String> {
        let state = states.get(id);
        let enabled = state.map_or(default, |state| state.enabled && state.visible);
        let visible = state.map_or(true, |state| state.visible);
        if !visible {
            return Ok(None);
        }
        tauri::menu::MenuItem::with_id(app, id, label, enabled, None::<&str>)
            .map(Some)
            .map_err(|error| error.to_string())
    };
    let mut file_items = Vec::new();
    for (id, label, default) in [
        ("open-folder", "打开文件夹…", true),
        ("save", "保存", false),
        ("rescan-folder", "重新扫描当前文件夹", false),
        ("close-window", "关闭窗口", true),
        ("quit", "退出", true),
    ] {
        if let Some(value) = menu_item(id, label, default)? {
            file_items.push(value);
        }
    }
    let file = Submenu::with_id_and_items(
        app,
        "file",
        "文件",
        true,
        &file_items
            .iter()
            .map(|value| value as &dyn tauri::menu::IsMenuItem<R>)
            .collect::<Vec<_>>(),
    )
    .map_err(|error| error.to_string())?;
    let edit = Submenu::with_id_and_items(
        app,
        "edit",
        "编辑",
        true,
        &[
            &PredefinedMenuItem::undo(app, Some("撤销")).map_err(|error| error.to_string())?,
            &PredefinedMenuItem::redo(app, Some("重做")).map_err(|error| error.to_string())?,
            &PredefinedMenuItem::separator(app).map_err(|error| error.to_string())?,
            &PredefinedMenuItem::cut(app, Some("剪切")).map_err(|error| error.to_string())?,
            &PredefinedMenuItem::copy(app, Some("复制")).map_err(|error| error.to_string())?,
            &PredefinedMenuItem::paste(app, Some("粘贴")).map_err(|error| error.to_string())?,
            &PredefinedMenuItem::select_all(app, Some("全选"))
                .map_err(|error| error.to_string())?,
        ],
    )
    .map_err(|error| error.to_string())?;
    let mut view_items = Vec::new();
    for (id, label, default) in [
        ("toggle-theme", "切换主题", true),
        ("reload", "重新加载", true),
    ] {
        if let Some(value) = menu_item(id, label, default)? {
            view_items.push(value);
        }
    }
    #[cfg(debug_assertions)]
    if let Some(value) = menu_item("toggle-devtools", "开发者工具", true)? {
        view_items.push(value);
    }
    let view = Submenu::with_id_and_items(
        app,
        "view",
        "视图",
        true,
        &view_items
            .iter()
            .map(|value| value as &dyn tauri::menu::IsMenuItem<R>)
            .collect::<Vec<_>>(),
    )
    .map_err(|error| error.to_string())?;
    let mut help_items = Vec::new();
    if let Some(value) = menu_item("check-for-update", "检查更新…", true)? {
        help_items.push(value);
    }
    #[cfg(not(target_os = "macos"))]
    if let Some(value) = menu_item("show-about", "关于", false)? {
        help_items.push(value);
    }
    let help = Submenu::with_id_and_items(
        app,
        "help",
        "帮助",
        true,
        &help_items
            .iter()
            .map(|value| value as &dyn tauri::menu::IsMenuItem<R>)
            .collect::<Vec<_>>(),
    )
    .map_err(|error| error.to_string())?;
    menu.append(&file).map_err(|error| error.to_string())?;
    menu.append(&edit).map_err(|error| error.to_string())?;
    menu.append(&view).map_err(|error| error.to_string())?;
    menu.append(&help).map_err(|error| error.to_string())?;
    Ok(menu)
}

#[tauri::command]
pub fn sync_menu_state(app: tauri::AppHandle, snapshot: MenuStateSnapshot) -> Result<(), String> {
    apply_snapshot(&app, snapshot)
}
