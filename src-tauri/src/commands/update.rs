// MusicTag — 更新 command 薄壳：检查和 URL 校验委托 service。

use crate::service::update::{self, UpdateCheckResult};
use tauri_plugin_opener::OpenerExt;

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
