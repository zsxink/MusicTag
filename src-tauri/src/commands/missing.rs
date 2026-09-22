// MusicTag — 缺失字段扫描 command 薄壳。
//
// 只负责接收 IPC 参数和把同步文件扫描放入 blocking worker；扫描逻辑全部位于
// service::missing，避免 command 层出现 lofty/WalkDir/文件 I/O。

use crate::model::{MissingField, MissingScanResult};
use crate::service::missing::scan_missing as scan_missing_service;
use std::path::PathBuf;

/// 扫描目录中指定维度缺失的歌曲。
#[tauri::command]
pub async fn scan_missing(
    dir: String,
    checks: Vec<MissingField>,
) -> Result<MissingScanResult, String> {
    let dir = PathBuf::from(dir);
    tokio::task::spawn_blocking(move || scan_missing_service(&dir, &checks))
        .await
        .map_err(|error| format!("缺失字段扫描任务失败: {error}"))?
}
