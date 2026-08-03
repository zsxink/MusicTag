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
use lofty::config::WriteOptions;
use lofty::file::AudioFile;
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::prelude::{Accessor, TagExt, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::items::ENGLISH;
use lofty::tag::{ItemKey, ItemValue, Tag, TagItem};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Seek, Write};
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

// ---------------------------------------------------------------------------
// save_song：表单全量覆盖写回原路径（design.md D1–D6）
// ---------------------------------------------------------------------------

/// 保存当前编辑表单，全量覆盖写回原路径。
///
/// 语义（PRD FR-5.5）：`Song` 中的非空字段写入标签，空字段被清除；
/// `cover=None` 即删除封面；写回**原路径**，不产生新文件、不改文件名。
///
/// 写盘策略（D6）：读入 → `clear()` 重建标签 → 写同目录临时文件 →
/// rename 原子替换原路径。任一环节失败返回 `Err(String)`，原文件不被触碰。
#[tauri::command]
pub fn save_song(song: Song) -> Result<(), String> {
    let path = Path::new(&song.path);

    // 写前校验格式（PRD「稳健」）：格式损坏/不可读 → Err，原文件未动。
    let mut tagged_file = Probe::open(path)
        .and_then(|probed| probed.read())
        .map_err(|e| format!("读取标签失败: {e}"))?;

    // D2：primary tag `clear()` 重建，保证「最终标签 == 表单内容」。
    let tag = tagged_file
        .primary_tag_mut()
        .ok_or_else(|| "读取标签失败: 文件缺少可写的主标签".to_string())?;
    tag.clear();

    apply_meta(tag, &song)?;

    write_atomic(path, &tagged_file).map_err(|e| format!("写回文件失败: {e}"))
}

/// 字段映射写入（design.md D3）。非空字段 set、空字段不写（已被 clear 删除）。
fn apply_meta(tag: &mut Tag, song: &Song) -> Result<(), String> {
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
fn set_text(tag: &mut Tag, key: ItemKey, value: &str) {
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
fn apply_lyrics(tag: &mut Tag, lyrics: &str) {
    if lyrics.is_empty() {
        return;
    }
    match tag.tag_type() {
        lofty::tag::TagType::Id3v2 => {
            let mut item =
                TagItem::new(ItemKey::UnsyncLyrics, ItemValue::Text(lyrics.to_string()));
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
fn apply_cover(tag: &mut Tag, cover: &Option<String>) -> Result<(), String> {
    let Some(data_url) = cover else {
        return Ok(());
    };

    let (bytes, mime) = decode_cover(data_url)?;
    let picture = Picture::unchecked(bytes)
        .pic_type(PictureType::CoverFront) // PRD §5.3：类型 3
        .mime_type(MimeType::from_str(&mime))
        .build();
    tag.push_picture(picture);
    Ok(())
}

/// 解码封面 base64 data URL：`data:<mime>;base64,...` → `(bytes, mime)`。
///
/// MIME 优先取 data URL 前缀；缺省用 `image::guess_format` 按字节探测
/// （与读侧 `encode_cover` 对称）。探测失败返回 `Err`（拒绝写坏封面）。
fn decode_cover(cover: &str) -> Result<(Vec<u8>, String), String> {
    // 剥离 `data:<mime>;base64,` 前缀（无前缀时按纯 base64 处理）。
    let (prefix, b64) = match cover.split_once(',') {
        Some((head, tail)) if head.starts_with("data:") && head.ends_with(";base64") => {
            let mime = head
                .strip_prefix("data:")
                .and_then(|m| m.strip_suffix(";base64"))
                .unwrap_or_default();
            (Some(mime.to_string()), tail)
        }
        _ => (None, cover),
    };

    let bytes = BASE64
        .decode(b64)
        .map_err(|e| format!("封面 base64 解码失败: {e}"))?;

    let mime = match prefix {
        Some(m) if !m.is_empty() && m != "application/octet-stream" => m,
        _ => {
            image::guess_format(&bytes)
                .map(|f| f.to_mime_type().to_string())
                .map_err(|_| "封面格式无法识别".to_string())?
        }
    };

    Ok((bytes, mime))
}

/// 原子写回（design.md D6）：同目录临时文件写标签 → rename 覆盖原路径。
///
/// `Tag::save_to`（lofty 0.24）会**就地** `truncate(0)` 重写整个文件——若直接对原
/// 文件调用，中途写失败会损坏原文件。故先把原文件完整拷贝到同目录临时文件，
/// 再对临时文件写标签，最后 `rename`（同卷原子替换）覆盖原路径。任一环节失败
/// 返回 `Err`，原文件零触碰（临时文件由 `Drop` 自动清理）。
fn write_atomic(path: &Path, tagged_file: &lofty::file::TaggedFile) -> std::io::Result<()> {
    let dir = path
        .parent()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "路径缺少父目录"))?;

    let mut temp = tempfile::Builder::new()
        .suffix(".tmp")
        .tempfile_in(dir)?;

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

    // ---------------------------------------------------------------------------
    // save_song 写回（design.md D1–D6）
    // ---------------------------------------------------------------------------

    /// 构造一个完整表单（全字段 + 歌词 + 封面 data URL），path 由调用方填。
    fn full_song(path: String) -> Song {
        let png = tiny_png_bytes();
        let cover = format!("data:image/png;base64,{}", BASE64.encode(&png));
        Song {
            path,
            title: "保存标题".into(),
            artist: "保存艺术家".into(),
            album: "保存专辑".into(),
            album_artist: "保存专辑艺术家".into(),
            track: "7".into(),
            track_total: "9".into(),
            year: "2022".into(),
            genre: "Rock".into(),
            lyrics: "[00:00.00]保存歌词第一行\n[00:10.00]第二行".into(),
            lyrics_source: LyricsSource::Embedded,
            cover: Some(cover),
            cover_mime: Some("image/png".into()),
        }
    }

    #[test]
    fn save_song_flac_roundtrips_all_fields() {
        let tmp = TempDir::new().unwrap();
        write_tagged_flac(tmp.path(), "song.flac", "旧标题", "旧艺术家");
        let path = tmp.path().join("song.flac").to_string_lossy().into_owned();

        let song = full_song(path.clone());
        save_song(song).expect("FLAC 保存应成功");

        // 读回逐字段断言一致
        let saved = read_song_meta(Path::new(&path)).expect("保存后应可读");
        assert_eq!(saved.title, "保存标题");
        assert_eq!(saved.artist, "保存艺术家");
        assert_eq!(saved.album, "保存专辑");
        assert_eq!(saved.album_artist, "保存专辑艺术家");
        assert_eq!(saved.track, "7");
        assert_eq!(saved.track_total, "9");
        assert_eq!(saved.year, "2022");
        assert_eq!(saved.genre, "Rock");
        assert_eq!(saved.lyrics, "[00:00.00]保存歌词第一行\n[00:10.00]第二行");
        assert_eq!(saved.lyrics_source, LyricsSource::Embedded);
        // 封面读回字节一致
        let cover = saved.cover.expect("应有封面");
        let b64 = cover.split_once(";base64,").map(|(_, b)| b).unwrap();
        assert_eq!(BASE64.decode(b64).unwrap(), tiny_png_bytes());
    }

    #[test]
    fn save_song_mp3_roundtrips_all_fields_id3v24() {
        let tmp = TempDir::new().unwrap();
        write_tagged_mp3(tmp.path(), "song.mp3", "旧标题", "旧艺术家");
        let path = tmp.path().join("song.mp3").to_string_lossy().into_owned();

        let song = full_song(path.clone());
        save_song(song).expect("MP3 保存应成功");

        let saved = read_song_meta(Path::new(&path)).expect("保存后应可读");
        assert_eq!(saved.title, "保存标题");
        assert_eq!(saved.artist, "保存艺术家");
        assert_eq!(saved.album, "保存专辑");
        assert_eq!(saved.album_artist, "保存专辑艺术家");
        assert_eq!(saved.track, "7");
        assert_eq!(saved.track_total, "9");
        assert_eq!(saved.year, "2022");
        assert_eq!(saved.genre, "Rock");
        assert_eq!(saved.lyrics, "[00:00.00]保存歌词第一行\n[00:10.00]第二行");

        // 写后文件头必须是 ID3v2.4（`ID3\x04`，非 v2.3）
        let bytes = fs::read(&path).unwrap();
        assert_eq!(&bytes[..3], b"ID3");
        assert_eq!(bytes[3], 0x04, "MP3 写回必须为 ID3v2.4，实际版本: {}", bytes[3]);
        // 封面 APIC 读回字节一致
        let cover = saved.cover.expect("应有封面");
        let b64 = cover.split_once(";base64,").map(|(_, b)| b).unwrap();
        assert_eq!(BASE64.decode(b64).unwrap(), tiny_png_bytes());
    }

    #[test]
    fn save_song_mp3_uslt_lang_is_eng() {
        let tmp = TempDir::new().unwrap();
        write_tagged_mp3(tmp.path(), "lyric.mp3", "T", "A");
        let path = tmp.path().join("lyric.mp3").to_string_lossy().into_owned();

        let mut song = full_song(path.clone());
        song.lyrics = "一段歌词".into();
        save_song(song).expect("MP3 保存应成功");

        // 读回 USLT 帧并断言 lang=eng
        let tagged = Probe::open(&path)
            .and_then(|p| p.read())
            .expect("应可读");
        let tag = tagged.primary_tag().expect("应有主标签");
        let uslt = tag
            .get(lofty::tag::ItemKey::UnsyncLyrics)
            .expect("应有 USLT 帧");
        assert_eq!(uslt.lang(), &ENGLISH, "USLT lang 必须为 eng");
    }

    #[test]
    fn save_song_clears_empty_fields_and_removes_lyrics_cover() {
        let tmp = TempDir::new().unwrap();
        write_tagged_flac(tmp.path(), "full.flac", "旧标题", "旧艺术家");
        add_tags(
            &tmp.path().join("full.flac"),
            Some("[00:00.00]旧歌词"),
            Some(tiny_png_bytes()),
        );
        let path = tmp.path().join("full.flac").to_string_lossy().into_owned();

        // 表单全空 + 无封面 → 保存后标签被清空
        let song = Song {
            path: path.clone(),
            title: String::new(),
            artist: String::new(),
            album: String::new(),
            album_artist: String::new(),
            track: String::new(),
            track_total: String::new(),
            year: String::new(),
            genre: String::new(),
            lyrics: String::new(),
            lyrics_source: LyricsSource::None,
            cover: None,
            cover_mime: None,
        };
        save_song(song).expect("保存应成功");

        let saved = read_song_meta(Path::new(&path)).expect("应可读");
        assert_eq!(saved.title, "");
        assert_eq!(saved.artist, "");
        assert_eq!(saved.album, "");
        assert_eq!(saved.lyrics, "");
        assert_eq!(saved.lyrics_source, LyricsSource::None);
        assert_eq!(saved.cover, None, "cover=None 后标签应无封面");
        assert_eq!(saved.cover_mime, None);
    }

    #[test]
    fn save_song_removes_cover_when_cover_none() {
        let tmp = TempDir::new().unwrap();
        write_tagged_mp3(tmp.path(), "cover.mp3", "T", "A");
        add_tags(
            &tmp.path().join("cover.mp3"),
            None,
            Some(tiny_png_bytes()),
        );
        let path = tmp.path().join("cover.mp3").to_string_lossy().into_owned();

        // 先确认原文件有封面
        let before = read_song_meta(Path::new(&path)).expect("应可读");
        assert!(before.cover.is_some());

        // 表单保留标题但 cover=None → 封面被删除
        let song = Song {
            path: path.clone(),
            title: "保留标题".into(),
            cover: None,
            ..full_song(path.clone())
        };
        save_song(song).expect("保存应成功");

        let after = read_song_meta(Path::new(&path)).expect("应可读");
        assert_eq!(after.title, "保留标题");
        assert_eq!(after.cover, None, "cover=None 应删除封面");
        assert_eq!(after.cover_mime, None);
    }

    #[test]
    fn save_song_atomic_write_failure_keeps_original_untouched() {
        let tmp = TempDir::new().unwrap();
        // 独立子目录（可单独改权限，不影响 TempDir 自身清理）
        let dir = tmp.path().join("ro_dir");
        fs::create_dir(&dir).unwrap();
        write_tagged_flac(&dir, "song.flac", "原标题", "原艺术家");
        let path = dir.join("song.flac");
        let orig_bytes = fs::read(&path).unwrap();

        // 写失败场景：目录只读 → 临时文件创建失败 → Err 且原文件 bytes 不变。
        // 原文件仍可读（Probe::open 只读成功），失败发生在 write_atomic 阶段。
        let mut perms = fs::metadata(&dir).unwrap().permissions();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            perms.set_mode(0o555); // r-x，去掉写位
        }
        fs::set_permissions(&dir, perms).expect("设置只读目录失败");

        let song = full_song(path.to_string_lossy().into_owned());
        let res = save_song(song);
        assert!(res.is_err(), "只读目录应返回 Err");
        assert!(res.unwrap_err().contains("写回文件失败"));

        // 恢复目录写权限以便后续清理
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&dir, fs::Permissions::from_mode(0o755)).unwrap();
        }

        // 原文件 bytes 完全不变
        assert_eq!(fs::read(&path).unwrap(), orig_bytes, "原子写失败不得改动原文件");
    }

    #[test]
    fn save_song_missing_path_returns_err_not_panic() {
        let song = full_song("/nonexistent/missing/file.mp3".into());
        let res = save_song(song);
        assert!(res.is_err(), "路径不存在应返回 Err（不 panic）");
    }

    #[test]
    fn save_song_corrupt_file_returns_err_not_panic() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("broken.mp3");
        fs::write(&path, b"garbage bytes").unwrap();
        let song = full_song(path.to_string_lossy().into_owned());
        let res = save_song(song);
        assert!(res.is_err(), "坏标签文件应返回 Err（不 panic）");
    }

    #[test]
    fn save_song_cover_bad_mime_returns_err() {
        let tmp = TempDir::new().unwrap();
        write_tagged_flac(tmp.path(), "badcover.flac", "T", "A");
        let path = tmp.path().join("badcover.flac").to_string_lossy().into_owned();

        // 封面字节无法识别为图片格式（纯文本 base64）
        let mut song = full_song(path.clone());
        song.cover = Some(format!("data:application/octet-stream;base64,{}", BASE64.encode(b"not an image")));
        let res = save_song(song);
        assert!(res.is_err(), "MIME 探测失败应返回 Err");
        assert!(res.unwrap_err().contains("封面格式无法识别"));
    }

    #[test]
    fn save_song_track_only_writes_trck_x() {
        let tmp = TempDir::new().unwrap();
        write_tagged_mp3(tmp.path(), "track.mp3", "T", "A");
        let path = tmp.path().join("track.mp3").to_string_lossy().into_owned();

        // 只有 track 无 track_total → TRCK 只写 `x`
        let mut song = full_song(path.clone());
        song.track = "5".into();
        song.track_total = String::new();
        save_song(song).expect("保存应成功");

        let saved = read_song_meta(Path::new(&path)).expect("应可读");
        assert_eq!(saved.track, "5");
        assert_eq!(saved.track_total, "", "track_total 空则不写");
    }

    #[test]
    fn decode_cover_strips_prefix_and_guesses_mime() {
        // data URL 前缀 → 前缀 MIME 优先
        let png = tiny_png_bytes();
        let data_url = format!("data:image/png;base64,{}", BASE64.encode(&png));
        let (bytes, mime) = decode_cover(&data_url).expect("应解码");
        assert_eq!(bytes, png);
        assert_eq!(mime, "image/png");

        // 无前缀 → 按纯 base64 解码 + 字节探测 MIME
        let (bytes2, mime2) = decode_cover(&BASE64.encode(&png)).expect("纯 base64 应解码");
        assert_eq!(bytes2, png);
        assert_eq!(mime2, "image/png");
    }

    #[test]
    fn save_song_preserves_audio_frames() {
        // 保存后文件仍可被 lofty 完整解析（音频帧未损坏），且不再残留临时文件。
        let tmp = TempDir::new().unwrap();
        write_tagged_mp3(tmp.path(), "keep.mp3", "旧标题", "旧艺术家");
        let path = tmp.path().join("keep.mp3");
        let orig_len = fs::metadata(&path).unwrap().len();

        let song = full_song(path.to_string_lossy().into_owned());
        save_song(song).expect("保存应成功");

        // 原路径下无残留 .tmp
        let leftovers: Vec<_> = fs::read_dir(tmp.path())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "临时文件应在保存后清理: {leftovers:?}");

        // 文件仍可读（audio frames 完好）
        let tagged = Probe::open(&path).and_then(|p| p.read()).expect("保存后仍可解析");
        assert_eq!(tagged.file_type(), lofty::file::FileType::Mpeg);
        // 文件只增不减标签体积（音频保留）
        assert!(fs::metadata(&path).unwrap().len() >= orig_len);
    }
}
