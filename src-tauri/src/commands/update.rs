// MusicTag — 更新 command 薄壳：检查和 URL 校验委托 service。

use crate::service::config;
use crate::service::update::{self, UpdateCheckResult};
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
pub fn get_last_update_check_at(now: String) -> Option<String> {
    config::load_last_update_check_at(&config::default_config_path(), &now)
}

#[tauri::command]
pub fn save_last_update_check_at(value: String) -> Result<(), String> {
    config::save_last_update_check_at(&config::default_config_path(), &value)
}

#[tauri::command]
pub async fn check_for_update() -> Result<UpdateCheckResult, String> {
    update::check_for_update().await
}

#[tauri::command]
pub fn open_release_page(app: tauri::AppHandle, url: String) -> Result<(), String> {
    update::open_release_page(&url, |safe_url| {
        app.opener()
            .open_url(safe_url, None::<&str>)
            .map_err(|error| error.to_string())
    })
}
