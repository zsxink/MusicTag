// MusicTag — `service/rename.rs` 改名防御校验单测（rust-tests-separation 外置）。
//
// 原 `#[cfg(test)] mod tests` 内嵌块整体迁出（production `src/` 零 `#[cfg(test)]`）。
// 仅覆盖纯逻辑 `is_illegal_name`（D7 安全护栏）；改名文件 I/O 语义由既有
// `tests/rename_song.rs` 集成测试覆盖（音频 + `.lrc` 同步、撞名预检零部分状态等）。
// 被测函数经 `app_lib::service::rename::is_illegal_name`（`pub`，rust-tests-separation 提权）。

mod common;

use app_lib::service::rename::is_illegal_name;

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
    // 撞名预检（exists）会命中「目标已存在」；前端 `setPendingRename` 已把空串归一为 null，
    // 此路径只在防御性调用时兜底。
    assert!(!is_illegal_name(""));
}
