// MusicTag — Rust 侧 Tauri command 实现。
//
// 本变更（v1-folder-list）交付两个只读命令：
// - `pick_folder`：rfd 原生文件夹选择器，返回目录绝对路径或 null（取消）。
// - `list_songs`：walkdir 深度遍历收集 FLAC/MP3，只读列表项 `SongSummary`。
//
// 按需读取原则（design.md §10.3）：列表只返回 `{ path, title, artist }`，不读
// 封面/歌词/其它标签；title/artist 从标签读取但不 trim（前端判定空串回退文件名）。
// 单文件标签读取失败时返回空串而非报错，保证列表永不因单曲坏标签崩溃。

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use lofty::prelude::{Accessor, TaggedFileExt};
use lofty::probe::Probe;
use serde::{Deserialize, Serialize};
use std::path::Path;
use walkdir::WalkDir;

/// 只读列表项。字段均 `String`，Rust 侧不 trim。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SongSummary {
    pub path: String,
    pub title: String,
    pub artist: String,
}

/// 歌词来源（design.md D1 契约形状：`"embedded" | "sidecar" | "none"`）。
///
/// serde 默认会把 enum 序列化成 `{"Embedded":null}` 对象形状，破坏 TS 契约，
/// 必须逐变体 rename 对齐 `src/lib/tauri.ts` 的字面量。`SidecarLrc` 若只依赖
/// `rename_all = "snake_case"` 会得到 `"sidecar_lrc"`，故显式 `rename = "sidecar"`。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LyricsSource {
    Embedded,
    #[serde(rename = "sidecar")]
    SidecarLrc,
    None,
}

/// 完整标签（open_song 返回 / save_song 提交）。字段与 TS `Song` 契约逐项对齐。
///
/// - 文本字段一律 `String`，未设置读空串（PRD §6），Rust 侧不 trim。
/// - `cover` 为 base64 data URL（`data:<mime>;base64,...`），前端 `<img :src>` 直接用。
/// - `lyrics_source` 本变更只落内嵌判定（trim 非空 → Embedded，否则 None）；
///   `SidecarLrc` 由 v1-lyrics-lrc 补充。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Song {
    pub path: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub album_artist: String,
    pub track: String,
    pub track_total: String,
    pub year: String,
    pub genre: String,
    pub lyrics: String,
    pub lyrics_source: LyricsSource,
    pub cover: Option<String>,
    pub cover_mime: Option<String>,
}

/// 是否为可收录的音频扩展名（`.flac`/`.mp3`，大小写不敏感）。
fn is_audio_file(path: &Path) -> bool {
    path.extension()
        .map(|ext| ext.eq_ignore_ascii_case("flac") || ext.eq_ignore_ascii_case("mp3"))
        .unwrap_or(false)
}

/// 读取单文件 title/artist。任何读取失败均返回空串，使列表层保持健壮。
fn read_summary(path: &Path) -> SongSummary {
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

/// 打开原生文件夹选择器。取消返回 `None`，否则返回目录绝对路径。
#[tauri::command]
pub fn pick_folder() -> Option<String> {
    rfd::FileDialog::new()
        .pick_folder()
        .map(|dir| dir.to_string_lossy().into_owned())
}

/// 深度遍历 `dir` 收集全部 FLAC/MP3，返回只读列表项。
#[tauri::command]
pub fn list_songs(dir: String) -> Vec<SongSummary> {
    WalkDir::new(&dir)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file() && is_audio_file(entry.path()))
        .map(|entry| read_summary(entry.path()))
        .collect()
}

/// 读取单曲完整标签。与 `read_summary`（失败 → 空串保列表）不同，
/// 本函数 `Probe::open` 或 `.read()` 任一失败都返回 `Err`，触发前端只读表单。
fn read_song_meta(path: &Path) -> Result<Song, String> {
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
    let lyrics = get(lofty::tag::ItemKey::Lyrics);
    let lyrics = if lyrics.is_empty() {
        get(lofty::tag::ItemKey::UnsyncLyrics)
    } else {
        lyrics
    };

    let lyrics_source = if lyrics.trim().is_empty() {
        LyricsSource::None
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

/// TRCK/TRACKNUMBER 合串（`x/y`）兜底拆分。`track` 含 `/` 时按第一个 `/`
/// 拆到 `track`/`track_total`（左侧 track 已非空时保留原值，不覆盖）。
fn split_track_pair(track: &str, track_total: &str) -> (String, String) {
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

/// 组装封面 base64 data URL：`data:<mime>;base64,...`。
///
/// MIME 优先用 lofty `Picture::mime_type()`（内嵌自带声明），为空时退回
/// `image::guess_format` 按字节探测（design.md D3）。
fn encode_cover(picture: lofty::picture::Picture) -> (Option<String>, Option<String>) {
    let bytes = picture.data();
    let mime = picture
        .mime_type()
        .map(|m| m.as_str().to_string())
        .or_else(|| {
            image::guess_format(bytes)
                .ok()
                .map(|f| f.to_mime_type().to_string())
        });

    let Some(mime) = mime else {
        // 探测不出 MIME 时仍给 data URL，用通用 MIME 兜底。
        return (
            Some(encode_data_url(bytes, "application/octet-stream")),
            None,
        );
    };

    (Some(encode_data_url(bytes, &mime)), Some(mime))
}

fn encode_data_url(bytes: &[u8], mime: &str) -> String {
    let b64 = BASE64.encode(bytes);
    format!("data:{mime};base64,{b64}")
}

/// 读取单曲完整标签并返回（open_song command）。
///
/// 入参为 `String` 与 `list_songs` 一致（列表项 `path` 直接透传），Tauri 自动转 PathBuf。
#[tauri::command]
pub fn open_song(path: String) -> Result<Song, String> {
    read_song_meta(Path::new(&path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;
    use tempfile::TempDir;

    // 测试工具：用 lofty 自带的写 API 构造 fixture（比手工拼字节可靠），
    // 覆盖完整字段（含歌词、封面、TRCK 合串）。

    /// 生成一张 2x2 红色 PNG 的字节（`image` crate 编码）。
    fn tiny_png_bytes() -> Vec<u8> {
        use std::io::Cursor;
        let mut buf = Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            2,
            2,
            image::Rgba([255, 0, 0, 255]),
        ))
        .write_to(&mut buf, image::ImageFormat::Png)
        .expect("编码测试 PNG 失败");
        buf.into_inner()
    }

    /// 往已写好的音频文件追加/覆写全字段标签（用 lofty 写回，贴近真实文件形态）。
    fn add_tags(path: &Path, lyrics: Option<&str>, picture: Option<Vec<u8>>) {
        use lofty::config::WriteOptions;
        use lofty::picture::{MimeType, Picture, PictureType};
        use lofty::prelude::{TagExt, TaggedFileExt};
        use lofty::tag::{items::ENGLISH, ItemValue, TagItem};

        let mut file = lofty::read_from_path(path).expect("读取 fixture 失败");
        let tag = file.primary_tag_mut().expect("fixture 应有主标签");

        tag.insert_text(lofty::tag::ItemKey::AlbumTitle, "Album".to_string());
        tag.insert_text(lofty::tag::ItemKey::AlbumArtist, "AlbumArtist".to_string());
        tag.insert_text(lofty::tag::ItemKey::TrackNumber, "3".to_string());
        tag.insert_text(lofty::tag::ItemKey::TrackTotal, "12".to_string());
        tag.insert_text(lofty::tag::ItemKey::RecordingDate, "2021".to_string());
        tag.insert_text(lofty::tag::ItemKey::Genre, "Pop".to_string());
        if let Some(lrc) = lyrics {
            // USLT 帧强制 lang=eng（PRD §7）；lofty 写 ID3v2 时要求 lang 非空，
            // 用 TagItem::new + set_lang 显式指定。
            let mut item = TagItem::new(
                lofty::tag::ItemKey::UnsyncLyrics,
                ItemValue::Text(lrc.to_string()),
            );
            item.set_lang(ENGLISH);
            tag.push(item);
            // FLAC 侧走 ItemKey::Lyrics（LYRICS 帧）
            tag.insert_text(lofty::tag::ItemKey::Lyrics, lrc.to_string());
        }
        if let Some(bytes) = picture {
            let pic = Picture::unchecked(bytes)
                .pic_type(PictureType::CoverFront)
                .mime_type(MimeType::Png)
                .description("cover")
                .build();
            tag.push_picture(pic);
        }

        tag.save_to_path(path, WriteOptions::default())
            .expect("写回 fixture 失败");
    }

    /// 构造带 title/artist 的最小合法 FLAC（STREAMINFO + VORBIS_COMMENT 块）。
    ///
    /// lofty 无法凭空产出无损音频 payload，故手工拼字节：`fLaC` magic + STREAMINFO
    /// 元数据块 + VORBIS_COMMENT 块（TITLE/ARTIST 两个 comment）。
    fn write_tagged_flac(dir: &Path, name: &str, title: &str, artist: &str) {
        let mut out = Vec::from(b"fLaC");

        let mut si = vec![0u8; 34];
        si[0..2].copy_from_slice(&4096u16.to_be_bytes()); // min blocksize
        si[2..4].copy_from_slice(&4096u16.to_be_bytes()); // max blocksize
        let sr = 44100u32;
        let bps = 16u32;
        si[10] = ((sr >> 12) & 0xFF) as u8;
        si[11] = ((sr >> 4) & 0xFF) as u8;
        si[12] = (((sr & 0xF) << 4) | ((bps - 1) >> 4)) as u8;
        si[13] = (((bps - 1) & 0xF) << 4) as u8;
        out.push(0x00); // STREAMINFO, is_last=0
        out.extend_from_slice(&34u32.to_be_bytes()[1..]);
        out.extend_from_slice(&si);

        // VORBIS_COMMENT（is_last=1），长度先占位后回填
        let vc_len_pos = {
            out.push(0x80 | 0x04);
            out.extend_from_slice(&[0, 0, 0]);
            out.len()
        };
        let vc_start = out.len();
        let vendor = "fixture";
        out.extend_from_slice(&(vendor.len() as u32).to_le_bytes());
        out.extend_from_slice(vendor.as_bytes());
        let comments = [format!("TITLE={title}"), format!("ARTIST={artist}")];
        out.extend_from_slice(&(comments.len() as u32).to_le_bytes());
        for c in comments {
            out.extend_from_slice(&(c.len() as u32).to_le_bytes());
            out.extend_from_slice(c.as_bytes());
        }
        let vc_len_val = (out.len() - vc_start) as u32;
        out[vc_len_pos - 3..vc_len_pos].copy_from_slice(&vc_len_val.to_be_bytes()[1..]);

        fs::write(dir.join(name), &out).expect("写入测试 FLAC 失败");
    }

    /// 构造带 title/artist 的最小合法 MP3：ID3v2.4 tag（TIT2/TPE1）+ 两个合法 MPEG 帧。
    fn write_tagged_mp3(dir: &Path, name: &str, title: &str, artist: &str) {
        fn synchsafe(n: usize) -> [u8; 4] {
            let n = n as u32;
            [(n >> 21) as u8, (n >> 14) as u8, (n >> 7) as u8, n as u8]
        }
        fn text_frame(id: &str, text: &str) -> Vec<u8> {
            let mut f = Vec::new();
            f.extend_from_slice(id.as_bytes());
            f.extend_from_slice(&synchsafe(text.len() + 1)[..]);
            f.extend_from_slice(&[0, 0]);
            f.push(0x03); // UTF-8
            f.extend_from_slice(text.as_bytes());
            f
        }

        let mut audio = Vec::from(b"ID3\x04\x00\x00");
        let mut frames = Vec::new();
        frames.extend(text_frame("TIT2", title));
        frames.extend(text_frame("TPE1", artist));
        audio.extend_from_slice(&synchsafe(frames.len()));
        audio.extend(&frames);
        // 两个合法 MPEG1 Layer3 128kbps 44100 帧（各 417 字节），保证 lofty 解析通过
        for _ in 0..2 {
            audio.extend_from_slice(&[0xFF, 0xFB, 0x90, 0x00]);
            audio.extend(std::iter::repeat_n(0u8, 413));
        }
        fs::write(dir.join(name), &audio).expect("写入测试 MP3 失败");
    }

    #[test]
    fn list_songs_recurses_filters_and_reads_tags() {
        let tmp = TempDir::new().unwrap();
        // 混合大小写扩展名
        write_tagged_flac(tmp.path(), "song.flac", "Song", "Artist");
        fs::rename(tmp.path().join("song.flac"), tmp.path().join("song.FLAC")).unwrap();
        write_tagged_flac(tmp.path(), "b.flac", "Beta", "B");
        write_tagged_mp3(tmp.path(), "c.mp3", "See", "C");
        // 非音频
        fs::write(tmp.path().join("notes.txt"), "not audio").unwrap();
        fs::write(tmp.path().join("cover.jpg"), "nope").unwrap();
        // 子目录深度遍历
        let sub = tmp.path().join("sub");
        fs::create_dir(&sub).unwrap();
        write_tagged_mp3(&sub, "deep.mp3", "Deep", "D");

        let songs = list_songs(tmp.path().to_string_lossy().into_owned());

        assert_eq!(
            songs.len(),
            4,
            "应只收录 song.FLAC、b.flac、c.mp3、sub/deep.mp3"
        );
        assert!(songs.iter().any(|s| s.path.ends_with("song.FLAC")));
        assert!(songs.iter().any(|s| s.path.ends_with("b.flac")));
        assert!(songs.iter().any(|s| s.path.ends_with("c.mp3")));
        assert!(songs.iter().any(|s| s.path.ends_with("deep.mp3")));

        let song = songs
            .iter()
            .find(|s| s.path.ends_with("song.FLAC"))
            .unwrap();
        assert_eq!(song.title, "Song");
        assert_eq!(song.artist, "Artist");
        let deep = songs.iter().find(|s| s.path.ends_with("deep.mp3")).unwrap();
        assert_eq!(deep.title, "Deep");
        assert_eq!(deep.artist, "D");
    }

    #[test]
    fn non_audio_files_are_ignored() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("readme.txt"), "no audio").unwrap();
        fs::write(tmp.path().join("cover.jpg"), "nope").unwrap();
        fs::write(tmp.path().join("a.invalid"), "x").unwrap();
        write_tagged_flac(tmp.path(), "keep.flac", "Keep", "K");
        let songs = list_songs(tmp.path().to_string_lossy().into_owned());
        assert_eq!(songs.len(), 1);
        assert!(songs[0].path.ends_with("keep.flac"));
    }

    #[test]
    fn empty_dir_returns_empty_list() {
        let tmp = TempDir::new().unwrap();
        let songs = list_songs(tmp.path().to_string_lossy().into_owned());
        assert!(songs.is_empty());
    }

    #[test]
    fn corrupt_file_yields_blank_not_error() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("broken.mp3"), b"garbage bytes").unwrap();
        let songs = list_songs(tmp.path().to_string_lossy().into_owned());
        assert_eq!(songs.len(), 1);
        assert_eq!(songs[0].title, "");
        assert_eq!(songs[0].artist, "");
    }

    #[test]
    fn summary_never_trims() {
        let tmp = TempDir::new().unwrap();
        write_tagged_flac(tmp.path(), "padded.flac", "  Song  ", " Artist ");
        let songs = list_songs(tmp.path().to_string_lossy().into_owned());
        assert_eq!(songs.len(), 1);
        assert_eq!(songs[0].title, "  Song  ");
        assert_eq!(songs[0].artist, " Artist ");
    }

    #[test]
    fn summary_serializes_to_contract_shape() {
        let s = SongSummary {
            path: "p".into(),
            title: "t".into(),
            artist: "a".into(),
        };
        let json = serde_json::to_string(&s).unwrap();
        assert_eq!(json, r#"{"path":"p","title":"t","artist":"a"}"#);
    }

    // ---------------------------------------------------------------------------
    // open_song 全量读取
    // ---------------------------------------------------------------------------

    #[test]
    fn open_song_flac_reads_all_fields_with_lyrics_and_cover() {
        let tmp = TempDir::new().unwrap();
        write_tagged_flac(tmp.path(), "song.flac", "Song", "Artist");
        add_tags(
            &tmp.path().join("song.flac"),
            Some("[00:00.00]第一行歌词\n[00:05.00]第二行"),
            Some(tiny_png_bytes()),
        );

        let song = read_song_meta(&tmp.path().join("song.flac")).expect("FLAC 应可读");

        assert_eq!(song.path, tmp.path().join("song.flac").to_string_lossy());
        assert_eq!(song.title, "Song");
        assert_eq!(song.artist, "Artist");
        assert_eq!(song.album, "Album");
        assert_eq!(song.album_artist, "AlbumArtist");
        assert_eq!(song.track, "3");
        assert_eq!(song.track_total, "12");
        assert_eq!(song.year, "2021");
        assert_eq!(song.genre, "Pop");
        assert_eq!(song.lyrics, "[00:00.00]第一行歌词\n[00:05.00]第二行");
        assert_eq!(song.lyrics_source, LyricsSource::Embedded);

        let cover = song.cover.expect("应有封面 data URL");
        assert!(
            cover.starts_with("data:image/png;base64,"),
            "封面应前缀 data:image/png;base64,，实际: {cover}"
        );
        assert_eq!(song.cover_mime.as_deref(), Some("image/png"));
        // base64 解码回去应与原始 PNG 字节一致
        let b64 = cover.strip_prefix("data:image/png;base64,").unwrap();
        let decoded = BASE64.decode(b64).expect("base64 应可解码");
        assert_eq!(decoded, tiny_png_bytes());
    }

    #[test]
    fn open_song_mp3_reads_all_fields_with_uslt_and_apic() {
        let tmp = TempDir::new().unwrap();
        write_tagged_mp3(tmp.path(), "song.mp3", "Song", "Artist");
        add_tags(
            &tmp.path().join("song.mp3"),
            Some("[00:00.00]第一行歌词\n[00:05.00]第二行"),
            Some(tiny_png_bytes()),
        );

        let song = read_song_meta(&tmp.path().join("song.mp3")).expect("MP3 应可读");

        assert_eq!(song.title, "Song");
        assert_eq!(song.artist, "Artist");
        assert_eq!(song.album, "Album");
        assert_eq!(song.album_artist, "AlbumArtist");
        assert_eq!(song.track, "3");
        assert_eq!(song.track_total, "12");
        assert_eq!(song.year, "2021");
        assert_eq!(song.genre, "Pop");
        assert_eq!(song.lyrics, "[00:00.00]第一行歌词\n[00:05.00]第二行");
        assert_eq!(song.lyrics_source, LyricsSource::Embedded);

        let cover = song.cover.expect("应有封面 data URL");
        assert!(
            cover.starts_with("data:image/png;base64,"),
            "封面应前缀 data:image/png;base64,，实际: {cover}"
        );
        assert_eq!(song.cover_mime.as_deref(), Some("image/png"));
        let b64 = cover.strip_prefix("data:image/png;base64,").unwrap();
        assert_eq!(BASE64.decode(b64).unwrap(), tiny_png_bytes());
    }

    #[test]
    fn open_song_mp3_track_pair_merged_frame_reads_split() {
        // 部分 MP3 的 TRCK 写成合并串 `03/12`。lofty 读侧已拆（design.md D2），
        // 这里直接手工拼一个含 `/` 的 TRCK 文本帧注入 ID3v2.4 tag，验证读路径端到端拆分。
        let tmp = TempDir::new().unwrap();

        fn synchsafe(n: usize) -> [u8; 4] {
            let n = n as u32;
            [(n >> 21) as u8, (n >> 14) as u8, (n >> 7) as u8, n as u8]
        }
        // TRCK 文本帧：帧头（ID3v2.4 无 flags）+ UTF-8 文本
        let mut trck = Vec::from(b"TRCK");
        let content = b"03/12";
        trck.extend_from_slice(&synchsafe(content.len() + 1));
        trck.extend_from_slice(&[0, 0]);
        trck.push(0x03); // UTF-8
        trck.extend_from_slice(content);

        let mut audio = Vec::from(b"ID3\x04\x00\x00");
        audio.extend_from_slice(&synchsafe(trck.len()));
        audio.extend(&trck);
        // 两个合法 MPEG 帧保证 lofty 解析通过
        for _ in 0..2 {
            audio.extend_from_slice(&[0xFF, 0xFB, 0x90, 0x00]);
            audio.extend(std::iter::repeat_n(0u8, 413));
        }
        fs::write(tmp.path().join("trck.mp3"), &audio).expect("写入测试 MP3 失败");

        // 读回，lofty 对 TRCK 读侧做 x/y 拆分 → track/track_total 拆开
        let song = read_song_meta(&tmp.path().join("trck.mp3")).expect("应可读");
        assert_eq!(song.track, "03");
        assert_eq!(song.track_total, "12");
    }

    #[test]
    fn open_song_untagged_file_returns_blanks() {
        let tmp = TempDir::new().unwrap();
        write_tagged_flac(tmp.path(), "plain.flac", "", "");
        // 只写基础 FLAC，不 add_tags —— title/artist 为空，其余字段未设置

        let song = read_song_meta(&tmp.path().join("plain.flac")).expect("无标签 FLAC 应可读");

        assert_eq!(song.title, "");
        assert_eq!(song.artist, "");
        assert_eq!(song.album, "");
        assert_eq!(song.album_artist, "");
        assert_eq!(song.track, "");
        assert_eq!(song.track_total, "");
        assert_eq!(song.year, "");
        assert_eq!(song.genre, "");
        assert_eq!(song.lyrics, "");
        assert_eq!(song.lyrics_source, LyricsSource::None);
        assert_eq!(song.cover, None);
        assert_eq!(song.cover_mime, None);
    }

    #[test]
    fn open_song_corrupt_file_returns_err_not_blank() {
        // 与 list_songs 的语义差异：坏标签 → list_songs 空串、open_song 必须 Err。
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("broken.mp3"), b"garbage bytes").unwrap();
        let res = read_song_meta(&tmp.path().join("broken.mp3"));
        assert!(res.is_err(), "坏标签文件应返回 Err，而非空 Song");
        assert!(!res.unwrap_err().is_empty(), "错误原因不应为空串");
    }

    #[test]
    fn open_song_lyrics_source_none_when_whitespace_only() {
        let tmp = TempDir::new().unwrap();
        write_tagged_flac(tmp.path(), "ws.flac", "T", "A");
        add_tags(&tmp.path().join("ws.flac"), Some("   \n  "), None);

        let song = read_song_meta(&tmp.path().join("ws.flac")).expect("应可读");
        // 内嵌歌词 trim 后为空 → None
        assert_eq!(song.lyrics_source, LyricsSource::None);
        assert_eq!(song.lyrics, "   \n  ");
    }

    #[test]
    fn open_song_track_pair_split_fallback() {
        // 模拟 TRCK 合串 `03/12` 兜底拆分（lofty 读侧已拆，兜底逻辑单测）
        assert_eq!(
            split_track_pair("03/12", ""),
            ("03".to_string(), "12".to_string())
        );
        // track_total 已有值时保留
        assert_eq!(
            split_track_pair("03", "12"),
            ("03".to_string(), "12".to_string())
        );
        // 无 `/` 时 track_total 为空
        assert_eq!(
            split_track_pair("05", ""),
            ("05".to_string(), String::new())
        );
    }

    #[test]
    fn lyrics_source_serializes_to_contract_shape() {
        // 契约形状冻结（design.md D1）：embedded / sidecar / none。
        // 杜绝 `{"Embedded":null}` 对象形状与 `"sidecar_lrc"`。
        let embedded = Song {
            path: "p".into(),
            title: "t".into(),
            artist: "a".into(),
            album: String::new(),
            album_artist: String::new(),
            track: String::new(),
            track_total: String::new(),
            year: String::new(),
            genre: String::new(),
            lyrics: String::new(),
            lyrics_source: LyricsSource::Embedded,
            cover: None,
            cover_mime: None,
        };
        let json = serde_json::to_string(&embedded).unwrap();
        assert!(
            json.contains(r#""lyrics_source":"embedded""#),
            "Embedded 应序列化为 embedded，实际: {json}"
        );

        let sidecar = Song {
            lyrics_source: LyricsSource::SidecarLrc,
            ..embedded
        };
        let json = serde_json::to_string(&sidecar).unwrap();
        assert!(
            json.contains(r#""lyrics_source":"sidecar""#),
            "SidecarLrc 应序列化为 sidecar（显式 rename），实际: {json}"
        );
        assert!(!json.contains("sidecar_lrc"), "不得出现 sidecar_lrc");
        assert!(!json.contains("SidecarLrc"), "不得出现 Rust 变体名");

        let none = Song {
            lyrics_source: LyricsSource::None,
            ..sidecar
        };
        let json = serde_json::to_string(&none).unwrap();
        assert!(
            json.contains(r#""lyrics_source":"none""#),
            "None 应序列化为 none，实际: {json}"
        );
    }

    #[test]
    fn song_serializes_snake_case_cover_shape() {
        let song = Song {
            path: "p".into(),
            title: "t".into(),
            artist: "a".into(),
            album: "al".into(),
            album_artist: "aa".into(),
            track: "1".into(),
            track_total: "10".into(),
            year: "2000".into(),
            genre: "g".into(),
            lyrics: "l".into(),
            lyrics_source: LyricsSource::None,
            cover: Some("data:image/png;base64,AAAA".into()),
            cover_mime: Some("image/png".into()),
        };
        let json = serde_json::to_string(&song).unwrap();
        // 断言全字段 snake_case 契约形状（与 src/lib/tauri.ts 对齐）
        assert!(
            json.contains(r#""album_artist":"aa""#),
            "album_artist 应为 snake_case: {json}"
        );
        assert!(json.contains(r#""track_total":"10""#));
        assert!(json.contains(r#""lyrics_source":"none""#));
        assert!(json.contains(r#""cover":"data:image/png;base64,AAAA""#));
        assert!(json.contains(r#""cover_mime":"image/png""#));
    }

    #[test]
    fn open_song_command_returns_err_for_missing_path() {
        // 不存在的路径 → Err（区别于空串）
        let res = open_song("/nonexistent/definitely/missing.flac".to_string());
        assert!(res.is_err());
    }
}
