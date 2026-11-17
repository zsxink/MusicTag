// MusicTag — v1-rename-sync 文件名改名（音频 + 同名 `.lrc` 同步）集成测试（file I/O：TempDir）。
//
// 覆盖 design.md D1/D2/D7 与 FR-4.6/4.6a/4.7、FR-5.6 语义：
// - 音频 + 同名 `.lrc` 一并改名；
// - 无 `.lrc` 仅音频改名；
// - 纯扩展名变化 `.lrc` 不动（FR-4.6a）；
// - 撞名预检拒绝（音频 / `.lrc`），任何 rename 之前完成，零部分状态（D1）；
// - `.lrc` 先改名、音频后改名（D2 失败自愈）；失败返回中文 Err，原文件保留可重试；
// - `new_name` 防御校验（D7）：含 `/`、`\`、`..` → Err「文件名不合法」。
// 访问被测函数经 `app_lib::service::rename::rename_song` 与
// `app_lib::commands::song::rename_song`（Cargo.toml `[lib] name = "app_lib"`）。

mod common;

use common::{write_tagged_flac, write_tagged_mp3};
use std::fs;
use tempfile::TempDir;

use app_lib::service::rename::rename_song;

// ---------------------------------------------------------------------------
// 改名成功路径（FR-4.6 / FR-4.6a）
// ---------------------------------------------------------------------------

#[test]
fn rename_audio_and_sidecar_lrc_together() {
    let tmp = TempDir::new().unwrap();
    write_tagged_mp3(tmp.path(), "song.mp3", "T", "A");
    fs::write(tmp.path().join("song.lrc"), "[00:00.00]歌词").unwrap();

    rename_song(&tmp.path().join("song.mp3"), "新歌.mp3").expect("音频 + .lrc 一并改名应成功");

    assert!(!tmp.path().join("song.mp3").exists(), "旧音频应已移走");
    assert!(!tmp.path().join("song.lrc").exists(), "旧 .lrc 应已移走");
    assert!(tmp.path().join("新歌.mp3").exists(), "新音频应存在");
    assert!(tmp.path().join("新歌.lrc").exists(), "新 .lrc 应存在");
    assert_eq!(
        fs::read_to_string(tmp.path().join("新歌.lrc")).unwrap(),
        "[00:00.00]歌词",
        ".lrc 内容应原样跟随改名"
    );
}

#[test]
fn rename_audio_without_lrc_moves_audio_only() {
    let tmp = TempDir::new().unwrap();
    write_tagged_flac(tmp.path(), "song.flac", "T", "A");

    rename_song(&tmp.path().join("song.flac"), "新歌.flac").expect("无 .lrc 仅音频改名应成功");

    assert!(!tmp.path().join("song.flac").exists(), "旧音频应已移走");
    assert!(tmp.path().join("新歌.flac").exists(), "新音频应存在");
    // 无 .lrc 场景不应产生任何 .lrc
    assert!(!tmp.path().join("新歌.lrc").exists(), "不得凭空生成 .lrc");
}

#[test]
fn rename_extension_change_leaves_lrc_untouched() {
    // FR-4.6a：主干相同（song）→ `.lrc` 仍为 song.lrc，不随之改名
    let tmp = TempDir::new().unwrap();
    write_tagged_mp3(tmp.path(), "song.mp3", "T", "A");
    fs::write(tmp.path().join("song.lrc"), "[00:00.00]歌词").unwrap();

    rename_song(&tmp.path().join("song.mp3"), "song.flac").expect("纯扩展名变化应成功");

    assert!(
        !tmp.path().join("song.mp3").exists(),
        "旧扩展名音频应已移走"
    );
    assert!(tmp.path().join("song.flac").exists(), "新扩展名音频应存在");
    assert_eq!(
        fs::read_to_string(tmp.path().join("song.lrc")).unwrap(),
        "[00:00.00]歌词",
        ".lrc 应仍为原主干名，不被改动"
    );
}

// ---------------------------------------------------------------------------
// 撞名拒绝（FR-4.7，D1 预检先行 → 零部分状态）
// ---------------------------------------------------------------------------

#[test]
fn rename_audio_collision_rejected_no_partial_state() {
    let tmp = TempDir::new().unwrap();
    write_tagged_mp3(tmp.path(), "song.mp3", "T", "A");
    write_tagged_mp3(tmp.path(), "target.mp3", "T", "A");

    let err =
        rename_song(&tmp.path().join("song.mp3"), "target.mp3").expect_err("音频撞名应被拒绝");

    assert!(err.contains("目标已存在"), "错误应含「目标已存在」: {err}");
    assert!(tmp.path().join("song.mp3").exists(), "原文件应保留");
    assert!(tmp.path().join("target.mp3").exists(), "目标文件应未被覆盖");
}

#[test]
fn rename_lrc_collision_rejected_before_any_rename() {
    let tmp = TempDir::new().unwrap();
    write_tagged_mp3(tmp.path(), "song.mp3", "T", "A");
    fs::write(tmp.path().join("song.lrc"), "[00:00.00]旧歌词").unwrap();
    fs::write(tmp.path().join("新歌.lrc"), "[00:00.00]占用").unwrap();

    let err = rename_song(&tmp.path().join("song.mp3"), "新歌.mp3").expect_err(".lrc 撞名应被拒绝");

    assert!(err.contains("目标已存在"), "错误应含「目标已存在」: {err}");
    // D1 预检先行：任何 rename 未执行 → 零部分状态
    assert!(tmp.path().join("song.mp3").exists(), "音频不得被移动");
    assert!(tmp.path().join("song.lrc").exists(), "旧 .lrc 不得被移动");
    assert_eq!(
        fs::read_to_string(tmp.path().join("新歌.lrc")).unwrap(),
        "[00:00.00]占用",
        "目标 .lrc 不得被覆盖"
    );
}

#[test]
fn rename_to_lrc_suffix_rejected_no_data_loss() {
    // CR（v1-cover-embed 回归）：目标名以 `.lrc` 结尾（如「新歌.lrc」）时
    // new_path == new_lrc（sidecar_lrc_path 对已 `.lrc` 结尾的名字返回自身）。
    // 若放行，`.lrc` 先 rename 落位到 new_path、音频再 rename 会在 POSIX 下
    // 静默覆盖歌词（FR-4.7 数据丢失）。应在任何 rename 之前拒绝（D1 零部分状态），
    // 两个原文件均原样保留。
    let tmp = TempDir::new().unwrap();
    write_tagged_mp3(tmp.path(), "song.mp3", "T", "A");
    fs::write(tmp.path().join("song.lrc"), "[00:00.00]歌词").unwrap();

    let err =
        rename_song(&tmp.path().join("song.mp3"), "新歌.lrc").expect_err(".lrc 结尾目标名应被拒绝");

    assert!(err.contains("目标已存在"), "错误应含「目标已存在」: {err}");
    assert!(tmp.path().join("song.mp3").exists(), "原音频应保留");
    assert_eq!(
        fs::read_to_string(tmp.path().join("song.lrc")).unwrap(),
        "[00:00.00]歌词",
        "原 .lrc 内容应原样保留，不得被音频字节覆盖"
    );
    assert!(!tmp.path().join("新歌.lrc").exists(), "不得生成目标文件");
}

#[test]
fn rename_to_multi_suffix_lrc_rejected() {
    // 多后缀变体：`song.mp3` → `song.mp3.lrc`（stem 变化 + 目标以 `.lrc` 结尾），
    // 同样 new_path == new_lrc，必须在任何 rename 之前拒绝。
    let tmp = TempDir::new().unwrap();
    write_tagged_mp3(tmp.path(), "song.mp3", "T", "A");
    fs::write(tmp.path().join("song.lrc"), "[00:00.00]歌词").unwrap();

    let err = rename_song(&tmp.path().join("song.mp3"), "song.mp3.lrc")
        .expect_err(".lrc 结尾目标名应被拒绝");

    assert!(err.contains("目标已存在"), "错误应含「目标已存在」: {err}");
    assert!(tmp.path().join("song.mp3").exists(), "原音频应保留");
    assert_eq!(
        fs::read_to_string(tmp.path().join("song.lrc")).unwrap(),
        "[00:00.00]歌词",
        "原 .lrc 内容应原样保留"
    );
    assert!(
        !tmp.path().join("song.mp3.lrc").exists(),
        "不得生成目标文件"
    );
}

// ---------------------------------------------------------------------------
// 悬空符号链接与目录撞名（rename-sync MODIFIED：symlink_metadata 预检）
// ---------------------------------------------------------------------------

#[cfg(unix)]
#[test]
fn rename_rejects_dangling_symlink_audio_target() {
    // 目标名是指向不存在路径的符号链接：`Path::exists()` 会跟随链接返回 false，
    // 放行后 `fs::rename` 会替换该链接。symlink_metadata 预检必须判定为撞名。
    use std::os::unix::fs::symlink;

    let tmp = TempDir::new().unwrap();
    write_tagged_mp3(tmp.path(), "song.mp3", "T", "A");
    let dangling_target = tmp.path().join("target.mp3");
    symlink("不存在的目标.mp3", &dangling_target).unwrap();

    let err = rename_song(&tmp.path().join("song.mp3"), "target.mp3")
        .expect_err("悬空 symlink 音频目标应判定为撞名");

    assert!(err.contains("目标已存在"), "错误应含「目标已存在」: {err}");
    assert!(tmp.path().join("song.mp3").exists(), "原音频应保留");
    let meta = fs::symlink_metadata(&dangling_target).expect("悬空链接应保留");
    assert!(meta.file_type().is_symlink(), "目标应仍是符号链接");
    assert_eq!(
        fs::read_link(&dangling_target).unwrap(),
        std::path::Path::new("不存在的目标.mp3"),
        "链接指向不得被改写"
    );
}

#[cfg(unix)]
#[test]
fn rename_rejects_dangling_symlink_lrc_target() {
    // `.lrc` 目标名是悬空符号链接：预检在任何 rename 之前拒绝，
    // 原音频与旧 `.lrc` 均不动，链接本身保留。
    use std::os::unix::fs::symlink;

    let tmp = TempDir::new().unwrap();
    write_tagged_mp3(tmp.path(), "song.mp3", "T", "A");
    fs::write(tmp.path().join("song.lrc"), "[00:00.00]歌词").unwrap();
    let dangling_lrc = tmp.path().join("新歌.lrc");
    symlink("不存在的歌词.lrc", &dangling_lrc).unwrap();

    let err = rename_song(&tmp.path().join("song.mp3"), "新歌.mp3")
        .expect_err("悬空 symlink 的 .lrc 目标应判定为撞名");

    assert!(err.contains("目标已存在"), "错误应含「目标已存在」: {err}");
    assert!(tmp.path().join("song.mp3").exists(), "原音频不得被移动");
    assert_eq!(
        fs::read_to_string(tmp.path().join("song.lrc")).unwrap(),
        "[00:00.00]歌词",
        "旧 .lrc 内容不得被改动"
    );
    let meta = fs::symlink_metadata(&dangling_lrc).expect("悬空 .lrc 链接应保留");
    assert!(meta.file_type().is_symlink(), "目标 .lrc 应仍是符号链接");
    assert_eq!(
        fs::read_link(&dangling_lrc).unwrap(),
        std::path::Path::new("不存在的歌词.lrc"),
        "链接指向不得被改写"
    );
    assert!(!tmp.path().join("新歌.mp3").exists(), "不得产生新音频");
}

#[test]
fn rename_rejects_directory_audio_target() {
    // 目标名是目录：symlink_metadata 返回 Ok → 统一视为“已存在”，
    // 必须在任何 rename 之前拒绝（跨平台）。
    let tmp = TempDir::new().unwrap();
    write_tagged_mp3(tmp.path(), "song.mp3", "T", "A");
    let target_dir = tmp.path().join("target.mp3");
    fs::create_dir(&target_dir).unwrap();

    let err = rename_song(&tmp.path().join("song.mp3"), "target.mp3")
        .expect_err("目录音频目标应判定为撞名");

    assert!(err.contains("目标已存在"), "错误应含「目标已存在」: {err}");
    assert!(tmp.path().join("song.mp3").exists(), "原音频应保留");
    assert!(target_dir.is_dir(), "目标目录不得被替换");
    assert!(
        fs::read_dir(&target_dir).unwrap().next().is_none(),
        "目标目录应保持为空"
    );
}

// ---------------------------------------------------------------------------
// 防御校验（D7）与失败路径（FR-5.6：返回错误、原文件保留可重试）
// ---------------------------------------------------------------------------

#[test]
fn rename_rejects_illegal_name_escape() {
    let tmp = TempDir::new().unwrap();
    write_tagged_mp3(tmp.path(), "song.mp3", "T", "A");

    for bad in ["../evil.mp3", "a/b.mp3", "a\\b.mp3", ".."] {
        let err = rename_song(&tmp.path().join("song.mp3"), bad).expect_err("非法名应被拒绝");
        assert!(
            err.contains("文件名不合法"),
            "错误应含「文件名不合法」: {err}"
        );
    }
    assert!(tmp.path().join("song.mp3").exists(), "原文件应保留");
}

#[cfg(unix)]
#[test]
fn rename_io_failure_keeps_original_files() {
    // 权限失败路径：目录只读 → rename 需目录写权限必失败 → Err 中文，
    // 原音频与 `.lrc` 保持原样（D2：`.lrc` 先失败 → 音频未动，可重试自愈）。
    let tmp = TempDir::new().unwrap();
    let dir = tmp.path().join("ro_dir");
    fs::create_dir(&dir).unwrap(); // 独立子目录，单独改权限不影响 TempDir 清理
    write_tagged_mp3(&dir, "song.mp3", "T", "A");
    fs::write(dir.join("song.lrc"), "[00:00.00]歌词").unwrap();

    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o555)).unwrap(); // r-x 去写位
    let err = rename_song(&dir.join("song.mp3"), "新歌.mp3").expect_err("只读目录应拒绝改名");
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o755)).unwrap(); // 恢复以便清理

    assert!(err.contains("改名"), "错误应含中文改名前缀: {err}");
    assert!(dir.join("song.mp3").exists(), "音频应保留");
    assert!(dir.join("song.lrc").exists(), ".lrc 应保留");
    assert!(!dir.join("新歌.mp3").exists(), "新音频不得出现");
    assert!(!dir.join("新歌.lrc").exists(), "新 .lrc 不得出现");
}

// ---------------------------------------------------------------------------
// command 薄壳委托（design.md §10：薄壳只做参数接收 → service）
// ---------------------------------------------------------------------------

#[test]
fn rename_song_command_shell_delegates_and_reports_err() {
    let err = app_lib::commands::song::rename_song("/nonexistent/a.mp3".into(), "../x.mp3".into())
        .expect_err("非法名应被拒绝");
    assert!(
        err.contains("文件名不合法"),
        "薄壳应透传 service 的 Err: {err}"
    );
}
