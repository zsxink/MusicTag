// MusicTag — `service/config.rs` 配置读写单测（dir-memory）。
//
// 覆盖 spec「目录记忆持久化」：
// - 读写往返（保存后读取返回相同目录）；
// - 缺失 → None（配置文件不存在）；
// - 损坏 → None（JSON 损坏 / 字段缺失）；
// - 目录已删 → None（last_dir 指向目录已不存在）；
// - 覆盖更新（后一次保存覆盖前一次）。
// config.rs 读写函数接受 path 参数，测试用临时目录，不触碰真实系统配置目录
//（design.md dir-memory「dirs::config_dir() 在测试环境返回真实配置目录」规避）。

use app_lib::service::config::{load_last_dir, save_last_dir};
use std::fs;
use std::path::{Path, PathBuf};
use tempfile::tempdir;

/// 在临时根下拼 `musictag/config.json`（贴近 `default_config_path` 的目录形态）。
fn cfg_path(root: &Path) -> PathBuf {
    root.join("musictag").join("config.json")
}

/// 建一个真实存在的音乐目录，供 load 的 `is_dir()` 校验通过。
fn make_music_dir(root: &Path, name: &str) -> PathBuf {
    let dir = root.join(name);
    fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn read_write_roundtrip() {
    let tmp = tempdir().unwrap();
    let dir = make_music_dir(tmp.path(), "music");

    save_last_dir(&cfg_path(tmp.path()), dir.to_str().unwrap()).unwrap();
    assert_eq!(
        load_last_dir(&cfg_path(tmp.path())),
        Some(dir.to_string_lossy().into_owned())
    );
}

#[test]
fn missing_config_returns_none() {
    let tmp = tempdir().unwrap();
    assert_eq!(load_last_dir(&cfg_path(tmp.path())), None);
}

#[test]
fn corrupt_json_returns_none() {
    let tmp = tempdir().unwrap();
    let cfg = cfg_path(tmp.path());
    fs::create_dir_all(cfg.parent().unwrap()).unwrap();
    fs::write(&cfg, "not-json{{{").unwrap();
    assert_eq!(load_last_dir(&cfg), None);
}

#[test]
fn missing_last_dir_field_returns_none() {
    // 字段缺失（`{}`）→ last_dir=None → load 返回 None（design「JSON 损坏或字段缺失 → None」）
    let tmp = tempdir().unwrap();
    let cfg = cfg_path(tmp.path());
    fs::create_dir_all(cfg.parent().unwrap()).unwrap();
    fs::write(&cfg, "{}").unwrap();
    assert_eq!(load_last_dir(&cfg), None);
}

#[test]
fn deleted_dir_returns_none() {
    let tmp = tempdir().unwrap();
    let dir = make_music_dir(tmp.path(), "music");
    let cfg = cfg_path(tmp.path());
    save_last_dir(&cfg, dir.to_str().unwrap()).unwrap();

    fs::remove_dir_all(&dir).unwrap();
    assert_eq!(load_last_dir(&cfg), None);
}

#[test]
fn overwrite_updates_last_dir() {
    let tmp = tempdir().unwrap();
    let dir1 = make_music_dir(tmp.path(), "music-a");
    let dir2 = make_music_dir(tmp.path(), "music-b");
    let cfg = cfg_path(tmp.path());

    save_last_dir(&cfg, dir1.to_str().unwrap()).unwrap();
    save_last_dir(&cfg, dir2.to_str().unwrap()).unwrap();

    assert_eq!(load_last_dir(&cfg), Some(dir2.to_string_lossy().into_owned()));
}

#[test]
fn save_failure_reports_err() {
    // 目标父目录不可写（父目录本身是普通文件）→ save 返回 Err
    //（fire-and-forget 静默吞掉的前提，命令层不 panic）。
    let tmp = tempdir().unwrap();
    let blocker = tmp.path().join("blocker");
    fs::write(&blocker, "file").unwrap();
    let cfg = blocker.join("musictag").join("config.json");
    assert!(save_last_dir(&cfg, tmp.path().to_str().unwrap()).is_err());
}

#[test]
fn empty_string_last_dir_returns_none() {
    // 边界：last_dir 字段为 `""`（空串）→ 同缺失/损坏，load 返回 None。
    // load_last_dir 以 `.filter(|d| !d.is_empty())` 过滤空串（防空路径打开当前目录）。
    let tmp = tempdir().unwrap();
    let cfg = cfg_path(tmp.path());
    fs::create_dir_all(cfg.parent().unwrap()).unwrap();
    fs::write(&cfg, r#"{"last_dir":""}"#).unwrap();
    assert_eq!(load_last_dir(&cfg), None);
}

#[test]
fn config_json_contains_only_last_dir_field() {
    // spec「不保存编辑状态」场景「仅目录」：检查 config.json 内容——只含 `last_dir` 单字段，
    // 不持久化选中歌曲/编辑草稿/搜索候选。
    let tmp = tempdir().unwrap();
    let dir = make_music_dir(tmp.path(), "music");
    let cfg = cfg_path(tmp.path());

    save_last_dir(&cfg, dir.to_str().unwrap()).unwrap();

    let raw = fs::read_to_string(&cfg).unwrap();
    let value: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let obj = value.as_object().expect("config.json 应为 JSON 对象");
    assert_eq!(obj.len(), 1, "config.json 应仅含 last_dir 单字段");
    assert!(obj.contains_key("last_dir"));
    assert_eq!(obj["last_dir"], dir.to_str().unwrap());
}
