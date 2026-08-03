// MusicTag — 侧载 `.lrc` 读写（纯应用层，无 lofty）。
//
// design.md D1/D5/D10：
// - `.lrc` 路径 = 音频 `with_extension("lrc")`（同目录、去扩展名同名，PRD §5.4 / FR-4.3）；
// - 读取用 UTF-8 lossy（存量 `.lrc` 常见 GBK，lossy 读入不 panic、badge 仍能展示）；
// - 写回始终 UTF-8，空歌词 no-op（FR-4.4a 不生成空 `.lrc`）；
// - 原子写（临时文件 + rename，与 `fs_atomic` 同语义），失败返回中文 Err（不含
//   「写 .lrc 失败:」前缀——该前缀由 `writer::save_song` 统一加，避免双重前缀）。

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
pub fn export_lrc(audio_path: &Path, lyrics: &str) -> Result<(), String> {
    if lyrics.is_empty() {
        return Ok(());
    }

    let lrc_path = sidecar_lrc_path(audio_path);
    let dir = lrc_path
        .parent()
        .ok_or_else(|| "路径缺少父目录".to_string())?;

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

    // rename 原子替换原 `.lrc`（同目录保证同卷）。失败时临时文件由 Drop 清理。
    temp.persist(&lrc_path)
        .map_err(|e| format!("rename 替换失败: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sidecar_path_removes_extension() {
        // 常规 FLAC/MP3 → 同目录去扩展名同名
        assert_eq!(
            sidecar_lrc_path(Path::new("/dir/song.flac")),
            PathBuf::from("/dir/song.lrc")
        );
        assert_eq!(
            sidecar_lrc_path(Path::new("/dir/song.mp3")),
            PathBuf::from("/dir/song.lrc")
        );
        // 无扩展名 → 追加 `.lrc`
        assert_eq!(
            sidecar_lrc_path(Path::new("/dir/noext")),
            PathBuf::from("/dir/noext.lrc")
        );
        // 多后缀 → 只换最后一个扩展名
        assert_eq!(
            sidecar_lrc_path(Path::new("/dir/a.b.mp3")),
            PathBuf::from("/dir/a.b.lrc")
        );
    }

    #[test]
    fn read_missing_sidecar_returns_none() {
        let tmp = tempfile::TempDir::new().unwrap();
        assert_eq!(read_sidecar_lrc(&tmp.path().join("nope.flac")), None);
    }

    #[test]
    fn read_sidecar_utf8_roundtrip() {
        let tmp = tempfile::TempDir::new().unwrap();
        let audio = tmp.path().join("song.flac");
        fs::write(
            tmp.path().join("song.lrc"),
            "[00:00.00]第一行\n[00:10.00]第二行",
        )
        .unwrap();
        assert_eq!(
            read_sidecar_lrc(&audio).as_deref(),
            Some("[00:00.00]第一行\n[00:10.00]第二行")
        );
    }

    #[test]
    fn read_sidecar_lossy_for_non_utf8() {
        // GBK 编码字节（非 UTF-8）→ lossy 读入不 panic、坏字节降级为替换符
        let tmp = tempfile::TempDir::new().unwrap();
        let audio = tmp.path().join("song.flac");
        fs::write(tmp.path().join("song.lrc"), b"[00:00.00]\xC4\xE3\xBA\xC3").unwrap();
        let text = read_sidecar_lrc(&audio).expect("非 UTF-8 也应可读");
        assert!(text.contains('\u{FFFD}'), "坏字节应降级为替换符: {text}");
    }

    #[test]
    fn export_empty_lyrics_is_noop() {
        let tmp = tempfile::TempDir::new().unwrap();
        let audio = tmp.path().join("song.flac");
        export_lrc(&audio, "").expect("空歌词应为 Ok（忽略复选框）");
        assert!(
            !tmp.path().join("song.lrc").exists(),
            "空歌词不得生成空 .lrc"
        );
    }

    #[test]
    fn export_writes_atomic_lrc_without_temp_residue() {
        let tmp = tempfile::TempDir::new().unwrap();
        let audio = tmp.path().join("song.flac");
        export_lrc(&audio, "[00:00.00]歌词").expect("应成功");
        assert_eq!(
            fs::read_to_string(tmp.path().join("song.lrc")).unwrap(),
            "[00:00.00]歌词"
        );
        // 无 .tmp 残留
        let leftovers: Vec<_> = fs::read_dir(tmp.path())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "临时文件应被清理: {leftovers:?}");
    }

    #[test]
    fn export_overwrites_existing_lrc() {
        let tmp = tempfile::TempDir::new().unwrap();
        let audio = tmp.path().join("song.flac");
        fs::write(tmp.path().join("song.lrc"), "旧内容").unwrap();
        export_lrc(&audio, "新内容").expect("应成功");
        assert_eq!(
            fs::read_to_string(tmp.path().join("song.lrc")).unwrap(),
            "新内容"
        );
    }
}
