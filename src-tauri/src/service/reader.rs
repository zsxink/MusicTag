// MusicTag — 标签读取（列表摘要 + 完整元数据）。
//
// - `read_summary`：只读 title/artist（失败 → 空串，列表永不因单曲坏标签崩溃）。
// - `read_song_meta`：读全量标签（失败 → `Err`，触发前端坏标签只读表单）。
// 依赖 `meta::split_track_pair` + `cover::encode_cover`，函数提升 `pub`。

use crate::model::{LyricsSource, Song, SongSummary};
use crate::service::cover::encode_cover;
use crate::service::meta::split_track_pair;
use lofty::ape::ApeFile;
use lofty::config::ParseOptions;
use lofty::file::AudioFile;
use lofty::file::FileType;
use lofty::picture::{Picture, PictureType};
use lofty::prelude::TaggedFileExt;
use lofty::probe::Probe;
use lofty::tag::{ItemKey, ItemValue, Tag, TagType};
use std::fs::File;
use std::path::Path;

fn read_ape_cover(path: &Path) -> Option<Picture> {
    let mut file = File::open(path).ok()?;
    let ape = ApeFile::read_from(&mut file, ParseOptions::new().read_properties(false)).ok()?;
    let item = ape.ape()?.get("Cover Art (Front)")?;
    let ItemValue::Binary(bytes) = item.value() else {
        return None;
    };
    let separator = bytes.iter().position(|&byte| byte == 0)?;
    let data = bytes.get(separator + 1..)?.to_vec();
    Some(
        Picture::unchecked(data)
            .pic_type(PictureType::CoverFront)
            .build(),
    )
}

fn tag_value(tag: Option<&Tag>, key: ItemKey) -> String {
    tag.and_then(|tag| tag.get_string(key))
        .map(ToOwned::to_owned)
        .unwrap_or_default()
}

/// WAV 的 ID3v2 是完整表单的权威来源；RIFF INFO 只为缺失文本字段提供回退。
fn wav_text_value(primary: Option<&Tag>, riff_info: Option<&Tag>, key: ItemKey) -> String {
    let primary_value = tag_value(primary, key);
    if primary_value.is_empty() {
        tag_value(riff_info, key)
    } else {
        primary_value
    }
}

fn wav_year_value(primary: Option<&Tag>, riff_info: Option<&Tag>) -> String {
    for key in [ItemKey::RecordingDate, ItemKey::Year] {
        let value = tag_value(primary, key);
        if !value.is_empty() {
            return value;
        }
    }
    for key in [ItemKey::RecordingDate, ItemKey::Year] {
        let value = tag_value(riff_info, key);
        if !value.is_empty() {
            return value;
        }
    }
    String::new()
}

/// 读取单文件 title/artist。任何读取失败均返回空串，使列表层保持健壮。
pub fn read_summary(path: &Path) -> SongSummary {
    let (title, artist) = match Probe::open(path).and_then(|probed| probed.read()) {
        Ok(tagged_file) => {
            let tag = tagged_file.primary_tag();
            let riff_info = (tagged_file.file_type() == FileType::Wav)
                .then(|| tagged_file.tag(TagType::RiffInfo))
                .flatten();
            let title = wav_text_value(tag, riff_info, ItemKey::TrackTitle);
            let artist = wav_text_value(tag, riff_info, ItemKey::TrackArtist);
            (title, artist)
        }
        Err(_) => (String::new(), String::new()),
    };
    SongSummary {
        path: path.to_string_lossy().into_owned(),
        title,
        artist,
    }
}

/// 读取单曲完整标签。与 `read_summary`（失败 → 空串保列表）不同，
/// 本函数 `Probe::open` 或 `.read()` 任一失败都返回 `Err`，触发前端只读表单。
pub fn read_song_meta(path: &Path) -> Result<Song, String> {
    let tagged_file = Probe::open(path)
        .and_then(|probed| probed.read())
        .map_err(|e| format!("读取标签失败: {e}"))?;

    let tag = tagged_file.primary_tag();
    let riff_info = (tagged_file.file_type() == FileType::Wav)
        .then(|| tagged_file.tag(TagType::RiffInfo))
        .flatten();

    // 文本字段统一经 ItemKey 读取，未设置读空串（PRD §6），Rust 不 trim。
    let get = |key: ItemKey| wav_text_value(tag, riff_info, key);

    let track = get(lofty::tag::ItemKey::TrackNumber);
    let track_total = get(lofty::tag::ItemKey::TrackTotal);

    // TRCK 合串（`x/y`）兜底拆分：lofty 读侧已对 ID3v2 TRCK / Vorbis
    // TRACKNUMBER 拆分，但极个别文件可能仍返回合串（design.md D2）。
    let (track, track_total) = split_track_pair(&track, &track_total);

    // FLAC Vorbis 用 ItemKey::Lyrics；MP3 用 UnsyncLyrics（USLT）。
    let mut lyrics = get(lofty::tag::ItemKey::Lyrics);
    if lyrics.is_empty() {
        lyrics = get(lofty::tag::ItemKey::UnsyncLyrics);
    }

    // 来源判定（design.md D2）：内嵌 trim 非空 → Embedded（内嵌优先，权威字段）；
    // 否则 `.lrc` 侧载存在 → SidecarLrc 且歌词取 `.lrc` 文本；否则 None。
    // `.lrc` 读取失败按 None 处理（fallback，不得锁死表单）。
    let lyrics_source = if lyrics.trim().is_empty() {
        match crate::service::lyrics::read_sidecar_lrc(path) {
            Some(sidecar) => {
                lyrics = sidecar;
                LyricsSource::SidecarLrc
            }
            None => LyricsSource::None,
        }
    } else {
        LyricsSource::Embedded
    };

    // 年份读取需同时兼容两个 ItemKey（design.md D2 只写 `ItemKey::Year`，但 lofty
    // 实际映射：Vorbis `DATE` → RecordingDate、ID3v2 `TDRC` → RecordingDate；仅
    // Vorbis `YEAR` 落 `ItemKey::Year`）。故 RecordingDate 优先、Year 兜底，保证
    // FLAC `DATE=...` 与 MP3 `TDRC=...` 均能读到。
    let year = wav_year_value(tag, riff_info);

    let (cover, cover_mime) = tag
        .and_then(|t| t.pictures().first().cloned())
        .or_else(|| {
            path.extension()
                .filter(|ext| ext.eq_ignore_ascii_case("ape"))
                .and_then(|_| read_ape_cover(path))
        })
        .map(encode_cover)
        .unwrap_or((None, None));

    Ok(Song {
        path: path.to_string_lossy().into_owned(),
        title: get(ItemKey::TrackTitle),
        artist: get(ItemKey::TrackArtist),
        album: get(ItemKey::AlbumTitle),
        album_artist: get(ItemKey::AlbumArtist),
        track,
        track_total,
        year,
        genre: get(ItemKey::Genre),
        lyrics,
        lyrics_source,
        cover,
        cover_mime,
    })
}
