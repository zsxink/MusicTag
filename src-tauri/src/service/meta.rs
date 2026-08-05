// MusicTag — 字段映射与格式分支（lofty 标签读写核心逻辑，不触碰文件系统）。
//
// 本模块承载 design.md D2–D5 的标签语义：
// - `is_audio_file` / `split_track_pair`：扩展名过滤与 TRCK 合串兜底拆分；
// - `apply_meta` / `set_text` / `apply_lyrics` / `apply_cover`：表单全量覆盖写标签。
// 函数提升 `pub` 供 `src-tauri/tests/` 集成测试经 `app_lib::service::meta::` 访问。

use crate::model::Song;
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::tag::items::ENGLISH;
use lofty::tag::{ItemKey, ItemValue, Tag, TagItem};
use std::path::Path;

/// 是否为可收录的音频扩展名（`.flac`/`.mp3`，大小写不敏感）。
pub fn is_audio_file(path: &Path) -> bool {
    path.extension()
        .map(|ext| ext.eq_ignore_ascii_case("flac") || ext.eq_ignore_ascii_case("mp3"))
        .unwrap_or(false)
}

/// TRCK/TRACKNUMBER 合串（`x/y`）兜底拆分。`track` 含 `/` 时按第一个 `/`
/// 拆到 `track`/`track_total`（左侧 track 已非空时保留原值，不覆盖）。
pub fn split_track_pair(track: &str, track_total: &str) -> (String, String) {
    if !track_total.is_empty() {
        return (track.to_string(), track_total.to_string());
    }
    match track.split_once('/') {
        Some((num, total)) if !num.trim().is_empty() => {
            (num.trim().to_string(), total.trim().to_string())
        }
        _ => (track.to_string(), String::new()),
    }
}

/// 字段映射写入（design.md D3）。非空字段 set、空字段不写（已被 clear 删除）。
pub fn apply_meta(tag: &mut Tag, song: &Song) -> Result<(), String> {
    set_text(tag, ItemKey::TrackTitle, &song.title);
    set_text(tag, ItemKey::TrackArtist, &song.artist);
    set_text(tag, ItemKey::AlbumTitle, &song.album);
    set_text(tag, ItemKey::AlbumArtist, &song.album_artist);
    set_text(tag, ItemKey::TrackNumber, &song.track);
    set_text(tag, ItemKey::TrackTotal, &song.track_total);
    // D3：年份统一写 RecordingDate（FLAC `DATE` / MP3 `TDRC`，与读侧优先分支对称）。
    set_text(tag, ItemKey::RecordingDate, &song.year);
    set_text(tag, ItemKey::Genre, &song.genre);

    apply_lyrics(tag, &song.lyrics);
    apply_cover(tag, &song.cover)
}

/// 非空字段 `insert_text`（空则跳过——clear 后未写即删除，表单全量覆盖语义）。
pub fn set_text(tag: &mut Tag, key: ItemKey, value: &str) {
    if !value.is_empty() {
        tag.insert_text(key, value.to_string());
    }
}

/// 歌词写入（design.md D5）：
/// - MP3 → USLT 帧：`ItemKey::UnsyncLyrics` + `set_lang(ENGLISH)`（lofty 写 ID3v2 要求 lang 非空）。
/// - FLAC → Vorbis `LYRICS` 帧：`ItemKey::Lyrics`（无需 lang）。
///
/// 按 tag 类型分支：`ItemKey::Lyrics` 在 ID3v2 不受支持（lofty 会静默丢弃），
/// `UnsyncLyrics` 在 Vorbis 映射为多余的 `UNSYNCEDLYRICS` comment，故只写对应格式的 key。
pub fn apply_lyrics(tag: &mut Tag, lyrics: &str) {
    if lyrics.is_empty() {
        return;
    }
    match tag.tag_type() {
        lofty::tag::TagType::Id3v2 => {
            let mut item = TagItem::new(ItemKey::UnsyncLyrics, ItemValue::Text(lyrics.to_string()));
            item.set_lang(ENGLISH);
            tag.push(item);
        }
        _ => {
            tag.insert_text(ItemKey::Lyrics, lyrics.to_string());
        }
    }
}

/// 封面写盘（design.md D4）：base64 data URL → 字节 + MIME → PICTURE/APIC。
/// `cover=None` → 不 push（clear 后即删除封面）。
pub fn apply_cover(tag: &mut Tag, cover: &Option<String>) -> Result<(), String> {
    let Some(data_url) = cover else {
        return Ok(());
    };

    let (bytes, mime) = crate::service::cover::decode_cover(data_url)?;
    let picture = Picture::unchecked(bytes)
        .pic_type(PictureType::CoverFront) // PRD §5.3：类型 3
        .mime_type(MimeType::from_str(&mime))
        .build();
    tag.push_picture(picture);
    Ok(())
}

