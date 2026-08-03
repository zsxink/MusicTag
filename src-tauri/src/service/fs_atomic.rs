// MusicTag — 原子写回（design.md D6）：同目录临时文件写标签 → rename 覆盖原路径。
//
// `Tag::save_to`（lofty 0.24）会**就地** `truncate(0)` 重写整个文件——若直接对原
// 文件调用，中途写失败会损坏原文件。故先把原文件完整拷贝到同目录临时文件，
// 再对临时文件写标签，最后 `rename`（同卷原子替换）覆盖原路径。任一环节失败
// 返回 `Err`，原文件零触碰（临时文件由 `Drop` 自动清理）。

use lofty::config::WriteOptions;
use lofty::file::{AudioFile, TaggedFile};
use std::fs;
use std::io::{Seek, Write};
use std::path::Path;

/// 原子写回（design.md D6）：同目录临时文件写标签 → rename 覆盖原路径。
///
/// `Tag::save_to`（lofty 0.24）会**就地** `truncate(0)` 重写整个文件——若直接对原
/// 文件调用，中途写失败会损坏原文件。故先把原文件完整拷贝到同目录临时文件，
/// 再对临时文件写标签，最后 `rename`（同卷原子替换）覆盖原路径。任一环节失败
/// 返回 `Err`，原文件零触碰（临时文件由 `Drop` 自动清理）。
pub fn write_atomic(path: &Path, tagged_file: &TaggedFile) -> std::io::Result<()> {
    let dir = path
        .parent()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "路径缺少父目录"))?;

    let mut temp = tempfile::Builder::new().suffix(".tmp").tempfile_in(dir)?;

    // 1. 原文件完整拷贝到临时文件（保留音频帧与其余内容）。
    {
        let mut src = fs::File::open(path)?;
        let mut dst = temp.as_file_mut();
        std::io::copy(&mut src, &mut dst)?;
        dst.flush()?;
    }

    // 2. 对临时文件写标签。`save_to` 会 probe 临时文件内容猜测格式——临时文件
    //    已含完整音频字节，格式可识别。写失败时临时文件被 Drop 清理，原文件未动。
    {
        let mut dst = temp.as_file_mut();
        dst.rewind()?;
        tagged_file
            .save_to(&mut dst, WriteOptions::default())
            .map_err(std::io::Error::other)?;
        dst.flush()?;
        dst.sync_all()?;
    }

    // 3. rename 原子替换原路径（同目录保证同卷，POSIX/Windows 均为原子替换）。
    temp.persist(path)?;
    Ok(())
}
