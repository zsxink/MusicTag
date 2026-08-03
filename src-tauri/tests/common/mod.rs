// MusicTag — 集成测试公共 fixture（src-tauri/tests/common/）。
//
// 文件 I/O 集成测试（list_songs/open_song/save_song）共享的 fixture：
// - `tiny_png_bytes`：生成 2x2 红色 PNG 字节；
// - `add_tags`：往已写好的音频文件覆写全字段标签（含歌词、封面）；
// - `write_tagged_flac` / `write_tagged_mp3`：构造最小合法 FLAC/MP3；
// - `full_song`：构造完整表单（全字段 + 歌词 + 封面 data URL）。
//
// 各测试 crate 按需引用子集，未用到的 fixture 属预期，不产生 dead_code 告警。
#![allow(dead_code)]

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use lofty::config::WriteOptions;
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::prelude::{TagExt, TaggedFileExt};
use lofty::tag::{items::ENGLISH, ItemValue, TagItem};
use std::fs;
use std::io::Cursor;
use std::path::Path;

/// 生成一张 2x2 红色 PNG 的字节（`image` crate 编码）。
pub fn tiny_png_bytes() -> Vec<u8> {
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
pub fn add_tags(path: &Path, lyrics: Option<&str>, picture: Option<Vec<u8>>) {
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
pub fn write_tagged_flac(dir: &Path, name: &str, title: &str, artist: &str) {
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
pub fn write_tagged_mp3(dir: &Path, name: &str, title: &str, artist: &str) {
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

/// 构造一个完整表单（全字段 + 歌词 + 封面 data URL），path 由调用方填。
pub fn full_song(path: String) -> app_lib::model::Song {
    let png = tiny_png_bytes();
    let cover = format!("data:image/png;base64,{}", BASE64.encode(&png));
    app_lib::model::Song {
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
        lyrics_source: app_lib::model::LyricsSource::Embedded,
        cover: Some(cover),
        cover_mime: Some("image/png".into()),
    }
}
