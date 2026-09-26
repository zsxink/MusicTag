// MusicTag — 集成测试公共 fixture（src-tauri/tests/common/）。
//
// 文件 I/O 集成测试（list_songs/open_song/save_song）共享的 fixture：
// - `tiny_png_bytes`：生成 2x2 红色 PNG 字节；
// - `add_tags`：往已写好的音频文件覆写全字段标签（含歌词、封面）；
// - `write_tagged_flac` / `write_tagged_mp3`：构造最小合法 FLAC/MP3；
// - `write_tagged_ape` / `write_tagged_wav` / `write_tagged_m4a`：构造最小合法 APE/WAV/M4A；
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
use std::sync::{Arc, Mutex};

/// 启动极简 HTTP 服务器（一次请求后关闭），返回 mock URL。
///
/// 各源「HTTP 非 2xx → Err 分支」回归测试（Tester 缺失项）与 `download_cover` 限流单测共用：
/// 对每个连接读请求头后写回 `response` 字节，处理一个请求后关闭。纯 std `TcpListener` 实现
/// （原为 `searcher/mod.rs` 的 `#[cfg(test)] test_util`，rust-tests-separation 迁入共享 fixture）。
pub fn mock_http_once(response: Vec<u8>) -> String {
    use std::io::{Read, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("绑定本地端口");
    let addr = listener.local_addr().expect("取本地端口");
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut s) = stream else { continue };
            let mut buf = [0u8; 4096];
            let _ = s.read(&mut buf);
            let _ = s.write_all(&response);
            let _ = s.flush();
            break;
        }
    });
    format!("http://{addr}")
}

/// 启动极简 HTTP 服务器：读入请求头后写回 `response`，返回 `(mock_url, 捕获的请求目标)`。
///
/// 捕获值为请求行第 2 段（如 `/?p=1&n=10&w=...&format=json`，不含 scheme/host），供各源
/// 「查询参数构造透传 album」断言（search-cover-album：QQ `w` / iTunes `term` / LRCLIB
/// `album_name` 有/无）。处理一个请求后关闭；返回的 URL 前缀 + 捕获目标拼回完整 URL 后
/// 可用 `reqwest::Url::query_pairs()` 解码断言。
pub fn mock_http_capture(response: Vec<u8>) -> (String, Arc<Mutex<String>>) {
    use std::io::{Read, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("绑定本地端口");
    let addr = listener.local_addr().expect("取本地端口");
    let captured = Arc::new(Mutex::new(String::new()));
    let captured_for_thread = captured.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut s) = stream else { continue };
            let mut buf = [0u8; 8192];
            let _ = s.read(&mut buf);
            let text = String::from_utf8_lossy(&buf);
            let target = text.split_whitespace().nth(1).unwrap_or_default().to_string();
            *captured_for_thread.lock().unwrap() = target;
            let _ = s.write_all(&response);
            let _ = s.flush();
            break;
        }
    });
    (format!("http://{addr}"), captured)
}

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

/// 最小合法 Monkey's Audio（.ape）：MAC 描述符 + 头 + APEv2 tag。
///
/// lofty 无法凭空产出 APE 音频 payload，故手工拼字节（与 FLAC/MP3 fixture 同思路）。
pub fn write_tagged_ape(dir: &Path, name: &str, title: &str, artist: &str) {
    fn item(key: &str, value: &str) -> Vec<u8> {
        let mut v = Vec::new();
        v.extend_from_slice(&(value.len() as u32).to_le_bytes()); // value size
        v.extend_from_slice(&0u32.to_le_bytes()); // flags: 0 = UTF-8 text
        v.extend_from_slice(key.as_bytes());
        v.push(0);
        v.extend_from_slice(value.as_bytes());
        v
    }
    fn ape_tag(items: &[Vec<u8>]) -> Vec<u8> {
        let body: Vec<u8> = items.concat();
        let size = (body.len() + 32) as u32; // items + footer
        let mut t = Vec::new();
        t.extend_from_slice(b"APETAGEX");
        t.extend_from_slice(&2000u32.to_le_bytes()); // version
        t.extend_from_slice(&size.to_le_bytes());
        t.extend_from_slice(&(items.len() as u32).to_le_bytes());
        t.extend_from_slice(&0u32.to_le_bytes()); // flags
        t.extend_from_slice(&[0u8; 8]); // reserved
        t.extend_from_slice(&body);
        // footer
        t.extend_from_slice(b"APETAGEX");
        t.extend_from_slice(&2000u32.to_le_bytes());
        t.extend_from_slice(&size.to_le_bytes());
        t.extend_from_slice(&(items.len() as u32).to_le_bytes());
        t.extend_from_slice(&0u32.to_le_bytes());
        t.extend_from_slice(&[0u8; 8]);
        t
    }

    // MAC 描述符。lofty `properties_gt_3980` 在 `MAC ` 之后**恰好**读 46 字节
    // descriptor、并取 `descriptor[2..6]` 当 descriptor_len，故 46 字节里偏移 2 放
    // 46 自身（见下方断言），偏移 6 起放 24 字节 MAC header 的字段。
    let mut mac = Vec::new();
    mac.extend_from_slice(b"MAC ");
    mac.extend_from_slice(&3990u16.to_le_bytes()); // version >= 3980
    let mut desc = Vec::new();
    desc.extend_from_slice(&46u32.to_le_bytes()); // descriptor[2..6]，lofty 取作 descriptor_len
    desc.extend_from_slice(&0u32.to_le_bytes()); // descriptor[6..10] 未读
    desc.extend_from_slice(&0u32.to_le_bytes()); // blocks_per_frame
    desc.extend_from_slice(&0u32.to_le_bytes()); // final_frame_blocks
    desc.extend_from_slice(&1u32.to_le_bytes()); // total_frames（须非 0，见 lofty verify）
    desc.extend_from_slice(&0u32.to_le_bytes()); // MAC header[0..4]（compression/flags）未读
    desc.extend_from_slice(&16u16.to_le_bytes()); // MAC header bit_depth
    desc.extend_from_slice(&1u16.to_le_bytes()); // MAC header channels（1..=32）
    desc.extend_from_slice(&44100u32.to_le_bytes()); // MAC header sample_rate
    desc.extend_from_slice(&[0u8; 14]); // 补齐 descriptor 尾部
    assert_eq!(desc.len(), 46, "MAC descriptor after magic must be 46 bytes");
    mac.extend_from_slice(&desc);
    mac.extend_from_slice(&[0u8; 24]); // MAC header（字段已在 descriptor 尾部读走）

    let mut out = mac;
    out.extend_from_slice(&ape_tag(&[
        item("Title", title),
        item("Artist", artist),
    ]));
    fs::write(dir.join(name), &out).expect("写入测试 APE 失败");
}

/// 最小合法 WAV（RIFF/WAVE + fmt + data + ID3 chunk）。
///
/// 走内嵌 ID3v2 chunk 而非 RIFF INFO：WAV 的 `primary_tag_type()` 是 Id3v2，
/// 且 MusicTag 写侧封面落到内嵌 APIC（PRD §5.5）。
pub fn write_tagged_wav(dir: &Path, name: &str, title: &str, artist: &str) {
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
    fn chunk(id: &[u8; 4], body: &[u8]) -> Vec<u8> {
        let mut c = Vec::from(id);
        c.extend_from_slice(&(body.len() as u32).to_le_bytes());
        c.extend_from_slice(body);
        if body.len() % 2 == 1 {
            c.push(0); // pad to even boundary
        }
        c
    }

    let mut fmt = Vec::new();
    fmt.extend_from_slice(&1u16.to_le_bytes()); // PCM
    fmt.extend_from_slice(&1u16.to_le_bytes()); // mono
    fmt.extend_from_slice(&44100u32.to_le_bytes());
    fmt.extend_from_slice(&88200u32.to_le_bytes()); // byte rate
    fmt.extend_from_slice(&2u16.to_le_bytes()); // block align
    fmt.extend_from_slice(&16u16.to_le_bytes()); // bits per sample

    let mut frames = Vec::new();
    frames.extend(text_frame("TIT2", title));
    frames.extend(text_frame("TPE1", artist));
    let mut id3 = Vec::from(b"ID3\x04\x00\x00");
    id3.extend_from_slice(&synchsafe(frames.len()));
    id3.extend_from_slice(&frames);

    let mut body = chunk(b"fmt ", &fmt);
    body.extend(chunk(b"data", &vec![0u8; 64]));
    body.extend(chunk(b"ID3 ", &id3));

    let mut out = Vec::from(b"RIFF");
    out.extend_from_slice(&((body.len() + 4) as u32).to_le_bytes());
    out.extend_from_slice(b"WAVE");
    out.extend_from_slice(&body);
    fs::write(dir.join(name), &out).expect("写入测试 WAV 失败");
}

/// 最小合法 M4A：ftyp + mdat + moov(mvhd/trak/mdia/minf/stbl/stsd/udta/meta/ilst)。
///
/// 手工拼 MP4 atom（尺寸前缀 + 4 字节类型，大端），与 FLAC/MP3 fixture 同思路。
pub fn write_tagged_m4a(dir: &Path, name: &str, title: &str, artist: &str) {
    fn atom(id: &[u8; 4], body: &[u8]) -> Vec<u8> {
        let mut a = Vec::from(((body.len() + 8) as u32).to_be_bytes());
        a.extend_from_slice(id);
        a.extend_from_slice(body);
        a
    }
    fn full_atom(id: &[u8; 4], body: &[u8]) -> Vec<u8> {
        let mut b = vec![0u8, 0, 0, 0]; // version + flags
        b.extend_from_slice(body);
        atom(id, &b)
    }
    fn data_atom(text: &str) -> Vec<u8> {
        // version(1) + flags(3)=UTF8(1) + locale(4) + text
        let mut d = vec![0u8, 0, 0, 1];
        d.extend_from_slice(&[0, 0, 0, 0]);
        d.extend_from_slice(text.as_bytes());
        atom(b"data", &d)
    }

    let mut ilst = Vec::new();
    ilst.extend(atom(b"\xa9nam", &data_atom(title)));
    ilst.extend(atom(b"\xa9ART", &data_atom(artist)));

    // meta 至少要一个 hdlr（lofty 靠它识别 handler），照抄真实文件的 hdlr 内容
    let hdlr_body = [
        &full_atom(b"hdlr", &[0u8, 0, 0, 0, 0, 0, 0, 0, b'm', b'd', b'i', b'r', b'a', b'p',
            b'l', b'i', b's', b't', 0, 0, 0, 0, 0, 0])[..],
    ]
    .concat();
    let mut meta_body = vec![0u8, 0, 0, 0];
    meta_body.extend_from_slice(&hdlr_body);
    meta_body.extend_from_slice(&atom(b"ilst", &ilst));
    let meta = atom(b"meta", &meta_body);

    let udta = atom(b"udta", &meta);

    // trak → mdia → {mdhd, hdlr(="soun"), minf}。lofty `find_audio_trak` 要求
    // hdlr.handler_type == "soun" 且存在 mdhd，否则报 "File contains no audio tracks"。
    let mut mdhd = Vec::new(); // version 0
    mdhd.extend_from_slice(&0u32.to_be_bytes()); // creation time
    mdhd.extend_from_slice(&0u32.to_be_bytes()); // modification time
    mdhd.extend_from_slice(&44100u32.to_be_bytes()); // timescale
    mdhd.extend_from_slice(&44100u32.to_be_bytes()); // duration
    mdhd.extend_from_slice(&[0u8; 4]); // language + quality
    let mdhd = full_atom(b"mdhd", &mdhd);

    // hdlr：full_atom 已补 version/flags(4)，故 body 从 pre_defined 起算。
    // lofty 读法：atom 头后**前跳 8 字节**再读 4 字节当 handler_type
    // （`find_audio_trak`），即 pre_defined(4) 之后必须正好是 "soun"。
    let mut hdlr_body = vec![0u8; 4]; // pre_defined
    hdlr_body.extend_from_slice(b"soun"); // handler type
    hdlr_body.extend_from_slice(&[0u8; 12]); // reserved
    let hdlr_mdia = full_atom(b"hdlr", &hdlr_body);

    // minf → stbl → stsd（音频 codec 描述）。lofty 在此判读 codec/声道/采样率。
    let mut esds_body = vec![0u8, 0, 0, 0]; // version + flags
    esds_body.push(0x03); // ES_DescrTag
    esds_body.extend_from_slice(&[0, 0, 0, 0]); // len 占位
    esds_body.push(0x40); // flags: MPEG-4 audio
    esds_body.push(0x15); // object type = AAC
    esds_body.extend_from_slice(&44100u32.to_be_bytes()); // buffer size DB (hi/lo)
    esds_body.extend_from_slice(&0u32.to_be_bytes()); // max bitrate
    esds_body.extend_from_slice(&0u32.to_be_bytes()); // avg bitrate
    esds_body.push(0x05); // DecoderConfigDescrTag
    esds_body.extend_from_slice(&[0, 0, 0, 0]); // len 占位
    esds_body.push(0x02); // object type = AAC LC
    esds_body.push(0x1b); // buffer size (90000)
    esds_body.extend_from_slice(&0u32.to_be_bytes()); // max bitrate
    esds_body.extend_from_slice(&0u32.to_be_bytes()); // avg bitrate
    esds_body.push(0x05); // DecSpecificInfoTag
    esds_body.push(0x02); // len = 2
    esds_body.extend_from_slice(&[0x12, 0x10]); // AAC LC, 44100Hz
    esds_body.push(0x06); // SLConfigDescrTag
    esds_body.push(0x01); // len = 1
    esds_body.push(0x02); // predefined = 2
    let esds = full_atom(b"esds", &esds_body);

    let mut mp4a_body = Vec::new(); // reserved
    mp4a_body.extend_from_slice(&[0u8; 6]);
    mp4a_body.extend_from_slice(&1u16.to_be_bytes()); // data reference index
    mp4a_body.extend_from_slice(&[0u8; 8]); // version/revision/vendor
    mp4a_body.extend_from_slice(&1u16.to_be_bytes()); // channels
    mp4a_body.extend_from_slice(&16u16.to_be_bytes()); // sample size
    mp4a_body.extend_from_slice(&[0u8, 0]); // compression id
    mp4a_body.extend_from_slice(&[0u8; 2]); // packet size
    mp4a_body.extend_from_slice(&44100u32.to_be_bytes()); // sample rate (16.16 fixed → high word)
    mp4a_body.extend_from_slice(&esds);
    let mut stsd_body = vec![0u8, 0, 0, 0]; // version + flags
    stsd_body.extend_from_slice(&1u32.to_be_bytes()); // entry count
    let mut stsd_body_inner = vec![0u8; 6]; // sample entry reserved
    stsd_body_inner.extend_from_slice(&mp4a_body);
    stsd_body.extend_from_slice(&atom(b"mp4a", &stsd_body_inner));
    let stsd = full_atom(b"stsd", &stsd_body);

    let stbl = atom(b"stbl", &stsd);
    let minf = atom(b"minf", &stbl);
    let mut mdia_body = mdhd;
    mdia_body.extend_from_slice(&hdlr_mdia);
    mdia_body.extend_from_slice(&minf);
    let mdia = atom(b"mdia", &mdia_body);
    let trak = atom(b"trak", &atom(b"tkhd", &[0u8; 4]).into_iter().chain(mdia.into_iter()).collect::<Vec<u8>>());

    let mut moov = full_atom(b"mvhd", &[0u8; 100]);
    moov.extend_from_slice(&trak);
    moov.extend_from_slice(&udta);
    let moov = atom(b"moov", &moov);

    let ftyp = atom(
        b"ftyp",
        &[b'M', b'4', b'A', b' ', 0, 0, 0, 0, b'M', b'4', b'A', b' ', b'i', b's', b'o', b'm'],
    );
    let mdat = atom(b"mdat", &[0u8; 16]);

    let mut out = ftyp;
    out.extend_from_slice(&mdat);
    out.extend_from_slice(&moov);
    fs::write(dir.join(name), &out).expect("写入测试 M4A 失败");
}
