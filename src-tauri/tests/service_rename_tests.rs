// MusicTag — `service/rename.rs` 改名预检与防御校验单测（rust-tests-separation 外置）。
//
// 原 `#[cfg(test)] mod tests` 内嵌块整体迁出（production `src/` 零 `#[cfg(test)]`）。
// 覆盖 `is_illegal_name`（D7 安全护栏）与 `target_exists` 的 `symlink_metadata`
// 语义（rename-sync MODIFIED：普通文件/目录/符号链接含悬空均视为已存在，
// 非 NotFound 元数据错误返回中文 Err）；改名文件 I/O 语义由既有
// `tests/rename_song.rs` 集成测试覆盖（音频 + `.lrc` 同步、撞名预检零部分状态等）。
// 被测函数经 `app_lib::service::rename::{is_illegal_name, target_exists}`（`pub`，
// rust-tests-separation 提权）。

mod common;

use app_lib::service::rename::{is_illegal_name, target_exists};
use std::fs;
use tempfile::TempDir;

#[test]
fn illegal_names_rejected() {
    // 纯逻辑校验（design.md §10.4 内联单测，无文件 I/O）
    assert!(is_illegal_name("../a.mp3"));
    assert!(is_illegal_name("a/b.mp3"));
    assert!(is_illegal_name("a\\b.mp3"));
    assert!(is_illegal_name(".."));
    assert!(!is_illegal_name("新歌.mp3"));
    assert!(!is_illegal_name("a.b.c.mp3"));
    assert!(!is_illegal_name("song.flac"));
}

#[test]
fn empty_name_is_not_illegal_but_resolved_as_dir_collision() {
    // 空串在 service 层不做特殊拦截：`dir.join("")` → 目录本身，
    // 撞名预检（target_exists）会命中「目标已存在」；前端 `setPendingRename` 已把空串归一为 null，
    // 此路径只在防御性调用时兜底。
    assert!(!is_illegal_name(""));
}

// ---------------------------------------------------------------------------
// `target_exists`：symlink_metadata 语义（rename-sync MODIFIED）
// ---------------------------------------------------------------------------

#[test]
fn target_exists_treats_regular_file_and_directory_as_existing() {
    let tmp = TempDir::new().unwrap();

    let file = tmp.path().join("song.mp3");
    fs::write(&file, b"audio").unwrap();
    assert_eq!(target_exists(&file), Ok(true), "普通文件应视为已存在");

    let dir = tmp.path().join("album");
    fs::create_dir(&dir).unwrap();
    assert_eq!(target_exists(&dir), Ok(true), "目录应视为已存在");

    assert_eq!(
        target_exists(&tmp.path().join("missing.mp3")),
        Ok(false),
        "不存在的路径应视为不存在"
    );
}

#[cfg(unix)]
#[test]
fn target_exists_treats_symlink_as_existing() {
    // 链接本身不跟随：指向存在目标的链接与悬空链接都算“已存在”。
    use std::os::unix::fs::symlink;

    let tmp = TempDir::new().unwrap();
    let existing = tmp.path().join("song.mp3");
    fs::write(&existing, b"audio").unwrap();

    let link = tmp.path().join("link.mp3");
    symlink(&existing, &link).unwrap();
    assert_eq!(
        target_exists(&link),
        Ok(true),
        "指向存在目标的符号链接应视为已存在"
    );

    let dangling = tmp.path().join("dangling.mp3");
    symlink(tmp.path().join("missing.mp3"), &dangling).unwrap();
    assert_eq!(
        target_exists(&dangling),
        Ok(true),
        "悬空符号链接应视为已存在"
    );
}

#[cfg(unix)]
#[test]
fn target_exists_propagates_non_not_found_metadata_error() {
    use app_lib::service::rename::rename_song;

    let tmp = TempDir::new().unwrap();
    // 父路径组件是普通文件 → 子路径的 symlink_metadata 返回 ENOTDIR（非 NotFound）。
    let blocker = tmp.path().join("blocker");
    fs::write(&blocker, b"not a directory").unwrap();
    let blocked_target = blocker.join("child.mp3");

    let err = target_exists(&blocked_target).expect_err("ENOTDIR 应返回 Err 而非 Ok(false)");
    assert!(
        err.contains("检查目标是否存在失败"),
        "错误应含「检查目标是否存在失败」: {err}"
    );

    // `rename_song` 必须传播预检错误，且不执行任何 rename。
    let err = rename_song(&blocked_target, "新歌.mp3").expect_err("元数据检查失败应拒绝改名");
    assert!(
        err.contains("检查目标是否存在失败"),
        "rename_song 应传播预检错误: {err}"
    );
    assert!(blocker.is_file(), "阻塞文件应保留且仍是普通文件");
    assert_eq!(
        fs::read(&blocker).unwrap(),
        b"not a directory".to_vec(),
        "阻塞文件内容不得被改动"
    );
    assert!(
        !blocker.join("新歌.mp3").exists(),
        "不得产生目标文件（未执行 rename）"
    );
}
