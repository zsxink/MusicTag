// MusicTag — 缺失字段只读扫描。
//
// 这里仅读取选中的标签维度、图片存在性和歌词来源存在性；不调用 reader 的完整
// Song 读取，不编码封面，也不读取/写入 sidecar 内容。

use crate::model::{MissingField, MissingScanError, MissingScanResult, MissingSong};
use crate::service::lyrics::sidecar_lrc_path;
use crate::service::meta::is_audio_file;
use lofty::prelude::TaggedFileExt;
use lofty::probe::Probe;
use lofty::tag::{ItemKey, ItemValue};
use std::path::Path;
use walkdir::WalkDir;

const FIELD_ORDER: [MissingField; 5] = [
    MissingField::Title,
    MissingField::Artist,
    MissingField::Album,
    MissingField::Cover,
    MissingField::Lyrics,
];

/// 扫描目录中选定维度缺失的音频文件。
///
/// `checks` 为空表示未启用筛选，直接返回空结果。目录遍历和单文件解析错误分别
/// 以 command 可继续处理的 `errors` 返回；只有 worker 无法启动/汇合时才由 command
/// 转成 command-level 错误。
pub fn scan_missing(dir: &Path, checks: &[MissingField]) -> Result<MissingScanResult, String> {
    if checks.is_empty() {
        return Ok(MissingScanResult {
            songs: Vec::new(),
            errors: Vec::new(),
        });
    }

    if !dir.is_dir() {
        return Err(format!("目录不存在或不可读取: {}", dir.to_string_lossy()));
    }

    let selected: Vec<MissingField> = FIELD_ORDER
        .into_iter()
        .filter(|field| checks.contains(field))
        .collect();

    let mut result = MissingScanResult {
        songs: Vec::new(),
        errors: Vec::new(),
    };

    for entry in WalkDir::new(dir).into_iter() {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                result.errors.push(MissingScanError {
                    path: error
                        .path()
                        .map(|path| path.to_string_lossy().into_owned())
                        .unwrap_or_else(|| dir.to_string_lossy().into_owned()),
                    reason: error.to_string(),
                });
                continue;
            }
        };

        if !entry.file_type().is_file() || !is_audio_file(entry.path()) {
            continue;
        }

        match scan_file(entry.path(), &selected) {
            Ok(Some(song)) => result.songs.push(song),
            Ok(None) => {}
            Err(reason) => result.errors.push(MissingScanError {
                path: entry.path().to_string_lossy().into_owned(),
                reason,
            }),
        }
    }

    Ok(result)
}

fn scan_file(path: &Path, selected: &[MissingField]) -> Result<Option<MissingSong>, String> {
    let tagged_file = Probe::open(path)
        .and_then(|probed| probed.read())
        .map_err(|error| format!("读取标签失败: {error}"))?;
    let tag = tagged_file.primary_tag();

    let mut missing = Vec::new();
    for field in selected {
        let is_missing = match field {
            MissingField::Title => text_missing(tag, ItemKey::TrackTitle),
            MissingField::Artist => text_missing(tag, ItemKey::TrackArtist),
            MissingField::Album => text_missing(tag, ItemKey::AlbumTitle),
            MissingField::Cover => tag.map(|tag| tag.pictures().is_empty()).unwrap_or(true),
            MissingField::Lyrics => lyrics_missing(tag, path),
        };
        if is_missing {
            missing.push(*field);
        }
    }

    if missing.is_empty() {
        Ok(None)
    } else {
        Ok(Some(MissingSong {
            path: path.to_string_lossy().into_owned(),
            missing,
        }))
    }
}

fn text_missing(tag: Option<&lofty::tag::Tag>, key: ItemKey) -> bool {
    tag.and_then(|tag| tag.get_string(key))
        .map(|value| value.trim().is_empty())
        .unwrap_or(true)
}

fn lyrics_missing(tag: Option<&lofty::tag::Tag>, audio_path: &Path) -> bool {
    let has_embedded = tag
        .map(|tag| {
            tag.items()
                .filter(|item| matches!(item.key(), ItemKey::Lyrics | ItemKey::UnsyncLyrics))
                .any(|item| match item.value() {
                    ItemValue::Text(value) | ItemValue::Locator(value) => !value.trim().is_empty(),
                    ItemValue::Binary(value) => !value.is_empty(),
                })
        })
        .unwrap_or(false);

    if has_embedded {
        return false;
    }

    !sidecar_lrc_path(audio_path).is_file()
}
