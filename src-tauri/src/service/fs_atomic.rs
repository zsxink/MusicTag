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

/// 读取路径当前权限位；路径不存在（`NotFound`）或非 Unix 平台返回 `Ok(None)`。
///
/// 供 `write_atomic_with` 与 `lyrics::export_lrc` 在创建临时文件**之前**调用，
/// 确保读到的是原文件而非临时文件的权限；非 `NotFound` 的元数据错误向上抛出，
/// 写回在产生任何临时文件前中止，原文件零触碰（design.md D2/D4）。
#[cfg(unix)]
pub fn existing_permissions(path: &Path) -> std::io::Result<Option<fs::Permissions>> {
    match fs::metadata(path) {
        Ok(metadata) => Ok(Some(metadata.permissions())),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err),
    }
}

/// 非 Unix：`Permissions` 只表达只读标志、不表达 ACL，不复制；恒返回 `None`（D5）。
#[cfg(not(unix))]
pub fn existing_permissions(_path: &Path) -> std::io::Result<Option<fs::Permissions>> {
    Ok(None)
}

/// 在 rename 前把捕获的权限位应用到已打开的临时文件；`None` 或非 Unix 为 no-op。
///
/// 用文件句柄 `set_permissions`（fchmod），不依赖临时文件路径，避免路径竞态；
/// 权限在文件以最终名字出现前就已就位。应用失败返回 Err，调用方不得 persist
/// （临时文件由 Drop 清理，原文件内容与权限均不变，D3/D4）。
#[cfg(unix)]
pub fn apply_permissions(
    file: &fs::File,
    permissions: Option<fs::Permissions>,
) -> std::io::Result<()> {
    match permissions {
        Some(perms) => file.set_permissions(perms),
        None => Ok(()),
    }
}

/// 非 Unix：保持现有行为（no-op，D5）。
#[cfg(not(unix))]
pub fn apply_permissions(
    _file: &fs::File,
    _permissions: Option<fs::Permissions>,
) -> std::io::Result<()> {
    Ok(())
}

/// 原子写回（design.md D6）：同目录临时文件写标签 → rename 覆盖原路径。
///
/// `Tag::save_to`（lofty 0.24）会**就地** `truncate(0)` 重写整个文件——若直接对原
/// 文件调用，中途写失败会损坏原文件。故先把原文件完整拷贝到同目录临时文件，
/// 再对临时文件写标签，最后 `rename`（同卷原子替换）覆盖原路径。任一环节失败
/// 返回 `Err`，原文件零触碰（临时文件由 `Drop` 自动清理）。
pub fn write_atomic(path: &Path, tagged_file: &TaggedFile) -> std::io::Result<()> {
    write_atomic_with(path, |dst| {
        tagged_file
            .save_to(dst, WriteOptions::default())
            .map_err(std::io::Error::other)
    })
}

/// 原子写回，并由调用方决定临时文件上的唯一标签写入策略。
///
/// 权限保留（design.md D2/D3）：创建临时文件**前**捕获原文件权限位，写标签并
/// `sync_all` 后、`persist` **前**应用到临时文件；任一新增步骤失败即返回 Err 且
/// 不 persist，原文件内容与权限位均不变。
pub fn write_atomic_with<F>(path: &Path, write_tags: F) -> std::io::Result<()>
where
    F: FnOnce(&mut fs::File) -> std::io::Result<()>,
{
    let dir = path
        .parent()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "路径缺少父目录"))?;

    // 1. 在创建临时文件前捕获原文件权限（D2）：此时读到的一定是原文件。
    //    metadata 非 NotFound 错误在此中止，尚未产生临时文件，原文件零触碰。
    let original_permissions = existing_permissions(path)?;

    let mut temp = tempfile::Builder::new().suffix(".tmp").tempfile_in(dir)?;

    // 2. 原文件完整拷贝到临时文件（保留音频帧与其余内容）。
    {
        let mut src = fs::File::open(path)?;
        let mut dst = temp.as_file_mut();
        std::io::copy(&mut src, &mut dst)?;
        dst.flush()?;
    }

    // 3. 对临时文件写标签。临时文件已含完整音频字节，格式可识别。写失败时
    //    临时文件被 Drop 清理，原文件未动。
    {
        let mut dst = temp.as_file_mut();
        dst.rewind()?;
        write_tags(&mut dst)?;
        dst.flush()?;
        dst.sync_all()?;
    }

    // 4. rename 前把原文件权限位复制到临时文件（D3）：fchmod 不依赖临时路径；
    //    失败则临时文件由 Drop 清理、原文件未动。
    apply_permissions(temp.as_file(), original_permissions)?;

    // 5. rename 原子替换原路径（同目录保证同卷，POSIX/Windows 均为原子替换）。
    temp.persist(path)?;
    Ok(())
}
