// MusicTag 配置持久化：`last_dir` 与最近成功更新检查时间共用 config.json。
//
// 纯配置读写，无 lofty/IO 业务逻辑。所有写操作通过同目录临时文件原子替换。
// 读写函数接受 `path` 参数（生产传默认路径，测试传临时路径），规避
// `dirs::config_dir()` 在测试环境返回真实系统配置目录（design.md dir-memory Risks）。

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

/// 缺失字段在旧版 config.json 中反序列化为 None。
#[derive(Default, Serialize, Deserialize)]
#[serde(default)]
struct Config {
    #[serde(skip_serializing_if = "Option::is_none")]
    last_dir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_update_check_at: Option<String>,
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
    let config = read_config(path).unwrap_or_default();
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
    let _guard = config_lock().lock().map_err(|error| error.to_string())?;
    let mut config = read_config(path).unwrap_or_default();
    config.last_dir = Some(dir.to_string());
    write_config(path, &config)
}

/// 读取最近成功检查时间。无效、缺失及未来的 RFC3339 值均视作不存在。
pub fn load_last_update_check_at(path: &Path, now: &str) -> Option<String> {
    let value = read_config(path)?.last_update_check_at?;
    let parsed = parse_timestamp(&value)?;
    let now = parse_timestamp(now)?;
    (parsed <= now).then_some(value)
}

/// 原子保存 UTC RFC3339 最近成功检查时间，保留现有 `last_dir`。
pub fn save_last_update_check_at(path: &Path, value: &str) -> Result<(), String> {
    if !value.ends_with('Z') || parse_timestamp(value).is_none() {
        return Err("更新时间必须是 UTC RFC3339 时间".to_string());
    }
    let _guard = config_lock().lock().map_err(|error| error.to_string())?;
    let mut config = read_config(path).unwrap_or_default();
    config.last_update_check_at = Some(value.to_string());
    write_config(path, &config)
}

fn config_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn read_config(path: &Path) -> Option<Config> {
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn write_config(path: &Path, config: &Config) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "配置路径缺少父目录".to_string())?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let json = serde_json::to_string(config).map_err(|e| e.to_string())?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    temp.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
    temp.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}

fn parse_timestamp(value: &str) -> Option<(i64, u32)> {
    let (date, time) = value.strip_suffix('Z')?.split_once('T')?;
    if date.len() != 10 || time.len() < 8 {
        return None;
    }
    let mut date = date.split('-');
    let year_text = date.next()?;
    let month_text = date.next()?;
    let day_text = date.next()?;
    if year_text.len() != 4 || month_text.len() != 2 || day_text.len() != 2 {
        return None;
    }
    let year: i64 = year_text.parse().ok()?;
    let month: i64 = month_text.parse().ok()?;
    let day: i64 = day_text.parse().ok()?;
    if date.next().is_some() || !(1..=12).contains(&month) {
        return None;
    }
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days_in_month = match month {
        2 if leap => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    };
    if !(1..=days_in_month).contains(&day) {
        return None;
    }
    let (clock, fraction) = match time.split_once('.') {
        Some((clock, fraction)) if !fraction.is_empty() => (clock, fraction),
        Some(_) => return None,
        None => (time, ""),
    };
    if clock.len() != 8 || fraction.len() > 9 {
        return None;
    }
    let mut clock = clock.split(':');
    let hour_text = clock.next()?;
    let minute_text = clock.next()?;
    let second_text = clock.next()?;
    if hour_text.len() != 2 || minute_text.len() != 2 || second_text.len() != 2 {
        return None;
    }
    let hour: i64 = hour_text.parse().ok()?;
    let minute: i64 = minute_text.parse().ok()?;
    let second: i64 = second_text.parse().ok()?;
    if clock.next().is_some()
        || !(0..=23).contains(&hour)
        || !(0..=59).contains(&minute)
        || !(0..=59).contains(&second)
    {
        return None;
    }
    if !fraction.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let fraction_nanos = if fraction.is_empty() {
        0
    } else {
        let padded = format!("{fraction:0<9}");
        padded.parse().ok()?
    };
    let mut y = year;
    let m = month;
    y -= i64::from(m <= 2);
    let era = y.div_euclid(400);
    let year_of_era = y - era * 400;
    let adjusted_month = m + if m > 2 { -3 } else { 9 };
    let day_of_year = (153 * adjusted_month + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    let seconds = (((era * 146097 + day_of_era) * 24 + hour) * 60 + minute) * 60 + second;
    Some((seconds, fraction_nanos))
}
