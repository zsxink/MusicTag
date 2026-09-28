// MusicTag — 保存编排（probe → primary_tag_mut().clear() → apply_meta → write_atomic）。
//
// 语义（PRD FR-5.5）：`Song` 中的非空字段写入标签，空字段被清除；
// `cover=None` 即删除封面；写回**原路径**，不产生新文件、不改文件名。
// 函数提升 `pub` 供 `src-tauri/tests/` 集成测试经 `app_lib::service::writer::` 访问。

use crate::model::Song;
use crate::service::fs_atomic::write_atomic_with;
use crate::service::meta::{apply_meta, apply_riff_info_meta};
use lofty::ape::ApeTag;
use lofty::config::WriteOptions;
use lofty::file::{AudioFile, FileType};
use lofty::prelude::{TagExt, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::Tag;
use lofty::tag::TagType;
use std::path::Path;

/// 保存当前编辑表单，全量覆盖写回原路径。
///
/// 写盘策略（D6）：读入 → `clear()` 重建标签 → 写同目录临时文件 →
/// rename 原子替换原路径。任一环节失败返回 `Err(String)`，原文件不被触碰。
///
/// `export_lrc`（design.md D3/D4）：复选框 opt-in 同步写 `.lrc`。写顺序**内嵌先、
/// `.lrc` 后**——内嵌是主存储（FR-4.1）；`.lrc` 失败 `?` 并入总 Err（前缀「写 .lrc
/// 失败:」），绝不吞错报成功（`.lrc` 为空时 `export_lrc` 内部 no-op，FR-4.4a）。
pub fn save_song(song: Song, export_lrc: bool) -> Result<(), String> {
    let path = Path::new(&song.path);

    // 写前校验格式（PRD「稳健」）：格式损坏/不可读 → Err，原文件未动。
    let mut tagged_file = Probe::open(path)
        .and_then(|probed| probed.read())
        .map_err(|e| format!("读取标签失败: {e}"))?;

    // lofty 仅在 RIFF INFO 非空时暴露该辅助标签。记下其原始存在性，避免为
    // ID3v2-only WAV 新建 RIFF INFO，同时使原有 INFO 的旧值可随表单被清除。
    let has_riff_info =
        tagged_file.file_type() == FileType::Wav && tagged_file.tag(TagType::RiffInfo).is_some();

    // D2：primary tag `clear()` 重建，保证「最终标签 == 表单内容」。
    // 无标签但格式可写时先创建 lofty 为该容器选择的 primary tag。
    if tagged_file.primary_tag().is_none() {
        let tag_type = tagged_file.primary_tag_type();
        if !matches!(tag_type, TagType::Ape | TagType::Id3v2 | TagType::Mp4Ilst) {
            return Err("读取标签失败: 文件缺少可写的主标签".to_string());
        }
        tagged_file.insert_tag(Tag::new(tag_type));
    }
    {
        let tag = tagged_file
            .primary_tag_mut()
            .ok_or_else(|| "读取标签失败: 文件缺少可写的主标签".to_string())?;
        tag.clear();
        apply_meta(tag, &song)?;
    }

    if has_riff_info {
        let riff_info = tagged_file
            .tag_mut(TagType::RiffInfo)
            .expect("已确认存在的 RIFF INFO 标签应仍可访问");
        riff_info.clear();
        apply_riff_info_meta(riff_info, &song);
    }

    let ape_tag = tagged_file
        .primary_tag()
        .filter(|tag| tag.tag_type() == TagType::Ape)
        .map(|tag| ApeTag::from(tag.clone()));

    write_atomic_with(path, move |file| {
        if let Some(ape_tag) = ape_tag {
            use lofty::prelude::TagExt;
            ape_tag
                .save_to(file, WriteOptions::default())
                .map_err(std::io::Error::other)?;
        } else {
            tagged_file
                .save_to(file, WriteOptions::default())
                .map_err(std::io::Error::other)?;
        }
        Ok(())
    })
    .map_err(|e| format!("写回文件失败: {e}"))?;

    if export_lrc {
        crate::service::lyrics::export_lrc(path, &song.lyrics)
            .map_err(|e| format!("写 .lrc 失败: {e}"))?;
    }
    Ok(())
}
