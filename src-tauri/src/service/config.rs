// MusicTag — 配置持久化（dir-memory）：`last_dir` 单字段 config.json。
//
// 纯配置读写，无 lofty/IO 业务逻辑：
// - `default_config_path`：`dirs::config_dir()/musictag/config.json`（无 config_dir → `./`）；
// - `load_last_dir`：缺失/损坏/目录已删 → `None`（静默降级，不 panic）；
// - `save_last_dir`：原子写（同目录临时文件 + rename 同卷替换），失败返回 `Err`。
// 读写函数接受 `path` 参数（生产传默认路径，测试传临时路径），规避
// `dirs::config_dir()` 在测试环境返回真实系统配置目录（design.md dir-memory Risks）。

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

/// 序列化结构：仅 `last_dir` 单字段（spec「不保存编辑状态」）；
/// 缺字段反序列化为 `None`（Option 默认值），与损坏 JSON 同归静默降级。
#[derive(Serialize, Deserialize)]
struct Config {
    last_dir: Option<String>,
}

/// 平台配置目录下 `musictag/config.json`；无 config_dir 时回退当前目录。
pub fn default_config_path() -> PathBuf {
    match dirs::config_dir() {
        Some(dir) => dir.join("musictag").join("config.json"),
        None => PathBuf::from(".").join("config.json"),
    }
}

/// 读取持久化的 `last_dir`：配置文件缺失/JSON 损坏/字段缺失/目录已删 → `None`。
///
/// `last_dir` 非空且 `Path::new(&last_dir).is_dir()` 才返回 `Some`——目录已删降级
/// （spec「目录已删降级」），同时保护 `get_last_dir` 与 `pick_folder` 的起始定位
/// 都不会打开不存在的目录。
pub fn load_last_dir(path: &Path) -> Option<String> {
    let raw = fs::read_to_string(path).ok()?;
    let config: Config = serde_json::from_str(&raw).ok()?;
    let dir = config.last_dir.filter(|d| !d.is_empty())?;
    if Path::new(&dir).is_dir() {
        Some(dir)
    } else {
        None
    }
}

/// 原子写 `last_dir`（临时文件 + rename 同卷替换）；失败返回 `Err`。
///
/// 首次运行 `musictag/` 目录尚不存在，先 `fs::create_dir_all(parent)` 再写；
/// 临时文件放同一父目录保证同卷，`rename` 原子替换（复用 fs_atomic.rs 的
/// tempfile+persist 模式）。命令层 fire-and-forget 静默吞掉 `Err`，不 panic。
pub fn save_last_dir(path: &Path, dir: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "配置路径缺少父目录".to_string())?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;

    let config = Config {
        last_dir: Some(dir.to_string()),
    };
    let json = serde_json::to_string(&config).map_err(|e| e.to_string())?;

    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    temp.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
    temp.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}
