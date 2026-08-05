// MusicTag — 文件名改名（音频 + 同名 `.lrc` 同步，v1-rename-sync）。
//
// 语义（design.md D1/D2/D7，FR-4.6 / 4.6a / 4.7 / FR-5.6）：
// - `rename_song(old_path, new_name)`：改文件名是**独立动作**（FR-5.5，不进保存字段语义），
//   同目录同名 `.lrc` 一并改名；纯扩展名变化（主干相同）`.lrc` 不动（FR-4.6a）；
// - 撞名预检先行（D1 原子性）：全部 `exists()` 检查在**第一次 `fs::rename` 之前**一次性
//   完成，撞名（最常见失败）零部分状态，禁止 POSIX 覆盖（FR-4.7）；
// - 改名顺序 `.lrc` 先、音频后（D2 失败自愈）：任一失败返回中文 Err，原文件保持原样可重试；
// - `new_name` 防御校验（D7 安全护栏）：含 `/`、`\`、`..` → Err「文件名不合法」。
//
// `.lrc` 路径复用 `service::lyrics::sidecar_lrc_path`（D3 命名约定单一来源，避免两处漂移）。

use crate::service::lyrics::sidecar_lrc_path;
use std::fs;
use std::path::Path;

/// 改文件名（音频 + 同名 `.lrc` 同步），撞名拒绝覆盖。
///
/// 流程：`new_name` 防御校验 → 目标路径计算 → 撞名预检（任何 rename 之前）
/// → `.lrc` 先 rename、音频后 rename（失败自愈）。返回 `Err(String)` 时
/// 原文件保持原样（撞名场景零部分状态；权限等 IO 失败由 D2 重试自愈）。
pub fn rename_song(old_path: &Path, new_name: &str) -> Result<(), String> {
    // D7：防改名逃逸当前目录（纯安全护栏，非产品需求）
    if is_illegal_name(new_name) {
        return Err("文件名不合法".to_string());
    }

    let dir = old_path
        .parent()
        .ok_or_else(|| "路径缺少父目录".to_string())?;
    let new_path = dir.join(new_name);

    // 新旧主干对比：相同 → 纯扩展名变化，`.lrc` 不参与改名（FR-4.6a）
    let stem_changed = old_path.file_stem() != new_path.file_stem();

    // `.lrc` 路径单一来源：sidecar_lrc_path（去扩展名同名约定）
    let old_lrc = sidecar_lrc_path(old_path);
    let lrc_to_move = stem_changed && old_lrc.is_file();
    let new_lrc = sidecar_lrc_path(&new_path);

    // 撞名预检（D1）：全部检查在任何 rename 之前一次性完成，禁止 POSIX 覆盖（FR-4.7）。
    //
    // `.lrc` 结尾的目标名（如「新歌.lrc」「song.mp3.lrc」）会令 new_path == new_lrc
    // （sidecar_lrc_path 对已 `.lrc` 结尾的名字返回自身）。此时若放行且旧 `.lrc` 需移动，
    // `.lrc` 先 rename 落位到 new_path，随后音频 fs::rename 会在 POSIX 下**静默覆盖**歌词
    // （数据丢失）。故目标名解析出音频路径与自身 sidecar 路径重合时，直接拒绝——无论旧
    // `.lrc` 是否存在，任何 rename 之前返回 Err「目标已存在」（D1 零部分状态）。
    if new_path == new_lrc {
        return Err("目标已存在".to_string());
    }
    // new_path 存在 → 音频撞名；或（旧 `.lrc` 需移动且）new_lrc 存在 → `.lrc` 撞名。
    if new_path.exists() {
        return Err("目标已存在".to_string());
    }
    if lrc_to_move && new_lrc.exists() {
        return Err("目标已存在".to_string());
    }

    // 改名顺序：`.lrc` 先、音频后（D2 失败自愈）。任一失败返回中文 Err，
    // 原文件保持原样可重试；已迁走的 `.lrc` 由重试的「无 `.lrc` 分支」收敛到一致终态。
    if lrc_to_move {
        fs::rename(&old_lrc, &new_lrc).map_err(|e| format!("改名 .lrc 失败: {e}"))?;
    }
    fs::rename(old_path, &new_path).map_err(|e| format!("改名音频失败: {e}"))?;
    Ok(())
}

/// `new_name` 防御校验（D7）：拒绝路径分隔符（`/`、`\`）与 `..`，防改名逃逸当前目录。
///
/// `pub`：供 `src-tauri/tests/service_rename_tests.rs` 直接断言（rust-tests-separation
/// 单测外置；集成测试是独立 crate，仅 `pub` 可见）。
pub fn is_illegal_name(new_name: &str) -> bool {
    new_name.contains('/') || new_name.contains('\\') || new_name.contains("..")
}

