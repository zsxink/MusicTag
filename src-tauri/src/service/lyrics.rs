// MusicTag — 侧载 `.lrc` 读写（纯应用层，无 lofty）。
//
// design.md D1/D5/D10：
// - `.lrc` 路径 = 音频 `with_extension("lrc")`（同目录、去扩展名同名，PRD §5.4 / FR-4.3）；
// - 读取用 UTF-8 lossy（存量 `.lrc` 常见 GBK，lossy 读入不 panic、badge 仍能展示）；
// - 写回始终 UTF-8，空歌词 no-op（FR-4.4a 不生成空 `.lrc`）；
// - 原子写（临时文件 + rename，与 `fs_atomic` 同语义），失败返回中文 Err（不含
//   「写 .lrc 失败:」前缀——该前缀由 `writer::save_song` 统一加，避免双重前缀）；
// - 覆盖已存在的同名 `.lrc` 时保留其原权限位（rename 前复制到临时文件）；
//   `.lrc` 不存在时保持 tempfile 新建行为，不继承音频文件权限（issue-190 D6）。

use crate::service::fs_atomic::{apply_permissions, existing_permissions};
use std::fs;
use std::path::{Path, PathBuf};

/// `.lrc` 路径 = 音频文件 `with_extension("lrc")`（同目录、去扩展名同名）。
/// `with_extension` 正确处理无扩展名（追加）/ 多后缀（只换最后一段）情况。
pub fn sidecar_lrc_path(audio_path: &Path) -> PathBuf {
    audio_path.with_extension("lrc")
}

/// 侧载读取：`.lrc` 存在 → 读文本（非 UTF-8 经 `from_utf8_lossy` 鲁棒读入）；
/// 文件不存在或读取失败 → None（`.lrc` 只是 fallback，不得锁死编辑）。
pub fn read_sidecar_lrc(audio_path: &Path) -> Option<String> {
    let lrc_path = sidecar_lrc_path(audio_path);
    fs::read(&lrc_path)
        .ok()
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
}

/// 同步写 `.lrc`：歌词为空 → `Ok(())` 直接返回（不生成空文件）；
/// 否则同目录临时文件写文本 → rename 原子替换（临时文件 + 同卷 rename 语义，
/// 避免写失败留下半截/空 `.lrc`）。失败返回中文 Err。
///
/// 覆盖已存在的 `.lrc` 时保留其原权限位：创建临时文件前捕获目标权限，写文本并
/// `sync_all` 后、`persist` 前应用；目标不存在时捕获为 `None`，保持新建行为。
pub fn export_lrc(audio_path: &Path, lyrics: &str) -> Result<(), String> {
    if lyrics.is_empty() {
        return Ok(());
    }

    let lrc_path = sidecar_lrc_path(audio_path);
    let dir = lrc_path
        .parent()
        .ok_or_else(|| "路径缺少父目录".to_string())?;

    // 创建临时文件前捕获目标 `.lrc` 的权限（issue-190 D2/D4）：不存在 → None
    // （按新建处理）；非 NotFound 错误 → 以 Err 返回，尚未产生临时文件。
    let original_perms =
        existing_permissions(&lrc_path).map_err(|e| format!("读取权限失败: {e}"))?;

    let mut temp = tempfile::Builder::new()
        .suffix(".tmp")
        .tempfile_in(dir)
        .map_err(|e| format!("创建临时文件失败: {e}"))?;

    {
        use std::io::Write;
        temp.write_all(lyrics.as_bytes())
            .map_err(|e| format!("写入临时文件失败: {e}"))?;
        temp.flush().map_err(|e| format!("flush 失败: {e}"))?;
        temp.as_file()
            .sync_all()
            .map_err(|e| format!("sync 失败: {e}"))?;
    }

    // rename 前把原 `.lrc` 权限位复制到临时文件（D3）：已存在则保留原权限，
    // 不存在时 no-op；失败不 persist，原文件内容与权限位均不变。
    apply_permissions(temp.as_file(), original_perms).map_err(|e| format!("设置权限失败: {e}"))?;

    // rename 原子替换原 `.lrc`（同目录保证同卷）。失败时临时文件由 Drop 清理。
    temp.persist(&lrc_path)
        .map_err(|e| format!("rename 替换失败: {e}"))?;
    Ok(())
}
