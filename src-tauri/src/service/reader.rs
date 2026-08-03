// MusicTag — 标签读取（列表摘要 + 完整元数据）。
//
// - `read_summary`：只读 title/artist（失败 → 空串，列表永不因单曲坏标签崩溃）。
// - `read_song_meta`：读全量标签（失败 → `Err`，触发前端坏标签只读表单）。
// 依赖 `meta::split_track_pair` + `cover::encode_cover`，函数提升 `pub`。

use crate::model::{LyricsSource, Song, SongSummary};
use crate::service::cover::encode_cover;
use crate::service::meta::split_track_pair;
use lofty::prelude::{Accessor, TaggedFileExt};
use lofty::probe::Probe;
use std::path::Path;

/// 读取单文件 title/artist。任何读取失败均返回空串，使列表层保持健壮。
pub fn read_summary(path: &Path) -> SongSummary {
    let (title, artist) = match Probe::open(path).and_then(|probed| probed.read()) {
        Ok(tagged_file) => {
            let tag = tagged_file.primary_tag();
            let title = tag
                .and_then(Accessor::title)
                .map(|s| s.to_string())
                .unwrap_or_default();
            let artist = tag
                .and_then(Accessor::artist)
                .map(|s| s.to_string())
                .unwrap_or_default();
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

    // 文本字段统一经 ItemKey 读取，未设置读空串（PRD §6），Rust 不 trim。
    let get = |key: lofty::tag::ItemKey| {
        tag.and_then(|t| t.get_string(key))
            .map(|s| s.to_owned())
            .unwrap_or_default()
    };

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
    let year = {
        let y = get(lofty::tag::ItemKey::RecordingDate);
        if y.is_empty() {
            get(lofty::tag::ItemKey::Year)
        } else {
            y
        }
    };

    let (cover, cover_mime) = tag
        .and_then(|t| t.pictures().first().cloned())
        .map(encode_cover)
        .unwrap_or((None, None));

    Ok(Song {
        path: path.to_string_lossy().into_owned(),
        title: get(lofty::tag::ItemKey::TrackTitle),
        artist: get(lofty::tag::ItemKey::TrackArtist),
        album: get(lofty::tag::ItemKey::AlbumTitle),
        album_artist: get(lofty::tag::ItemKey::AlbumArtist),
        track,
        track_total,
        year,
        genre: get(lofty::tag::ItemKey::Genre),
        lyrics,
        lyrics_source,
        cover,
        cover_mime,
    })
}
