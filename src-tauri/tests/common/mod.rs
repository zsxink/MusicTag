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
use lofty::file::FileType;
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::prelude::{TagExt, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::{items::ENGLISH, ItemValue, TagItem, TagType};
use std::fs;
use std::io::Cursor;
use std::path::Path;
use std::process::Command;
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
            let target = text
                .split_whitespace()
                .nth(1)
                .unwrap_or_default()
                .to_string();
            *captured_for_thread.lock().unwrap() = target;
            let _ = s.write_all(&response);
            let _ = s.flush();
            break;
        }
    });
    (format!("http://{addr}"), captured)
}

/// 启动可应答多次的极简 HTTP 服务器：按请求目标（含 query）分流响应，返回
/// `(mock_url, 捕获的请求目标序列)`。
///
/// 供 iTunes 双店面并发搜索（`storefronts` 按 `country=HK`/`country=US` 各发一次请求）
/// 断言「请求 2 次 + 按 query 分流不同响应」：`routes` 收到完整请求目标返回本次响应
/// 字节，捕获值按到达顺序追加。应答 `expected` 次后关闭（并发连接落 backlog，不会死锁）。
pub fn mock_http_router(
    routes: impl Fn(&str) -> Vec<u8> + Send + 'static,
    expected: usize,
) -> (String, Arc<Mutex<Vec<String>>>) {
    use std::io::{Read, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("绑定本地端口");
    let addr = listener.local_addr().expect("取本地端口");
    let captured = Arc::new(Mutex::new(Vec::new()));
    let captured_for_thread = captured.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming().take(expected) {
            let Ok(mut s) = stream else { continue };
            let mut buf = [0u8; 8192];
            let _ = s.read(&mut buf);
            let text = String::from_utf8_lossy(&buf);
            let target = text
                .split_whitespace()
                .nth(1)
                .unwrap_or_default()
                .to_string();
            captured_for_thread.lock().unwrap().push(target.clone());
            let response = routes(&target);
            let _ = s.write_all(&response);
            let _ = s.flush();
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

/// 为 APE fixture 写入原生 APEv2 picture item。通用 `Tag::save_to_path` 会先
/// 转换成抽象 Tag，lofty 0.24 对 APE picture 的转换不保留 cover item；这里直接
/// 使用 `ApeTag`/`ApeItem`，让 open 测试验证真实的 `Cover Art (Front)` 数据。
pub fn add_ape_tags_with_picture(path: &Path, picture: Vec<u8>) {
    use lofty::ape::{ApeItem, ApeTag};
    use lofty::picture::{MimeType, Picture, PictureType};
    use lofty::tag::{ItemValue, TagExt};
    use std::fs::OpenOptions;

    let mut tag = ApeTag::new();
    tag.insert(ApeItem::new("Title".into(), ItemValue::Text("Song".into())).unwrap());
    tag.insert(ApeItem::new("Artist".into(), ItemValue::Text("Artist".into())).unwrap());
    tag.insert(ApeItem::new("Album".into(), ItemValue::Text("Album".into())).unwrap());
    tag.insert(ApeItem::new("Year".into(), ItemValue::Text("2021".into())).unwrap());
    tag.insert(ApeItem::new("Lyrics".into(), ItemValue::Text("歌词".into())).unwrap());
    let ape_picture = Picture::unchecked(picture)
        .pic_type(PictureType::CoverFront)
        .mime_type(MimeType::Png)
        .build()
        .as_ape_bytes();
    tag.insert(ApeItem::new("Cover Art (Front)".into(), ItemValue::Binary(ape_picture)).unwrap());
    assert!(tag.get("Cover Art (Front)").is_some());
    let mut file = OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
        .expect("打开 APE fixture 失败");
    tag.save_to(&mut file, lofty::config::WriteOptions::default())
        .expect("写入原生 APE picture fixture 失败");
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

/// 构造可被 lofty 读取和写回的 WAV/M4A fixture。
///
/// ffmpeg 生成真实的音频容器和最小音频轨道；metadata 参数确保 lofty 创建
/// 对应的 primary tag，后续 `add_tags` 再通过 ItemKey 写全字段。
pub fn write_tagged_wav(dir: &Path, name: &str, title: &str, artist: &str) {
    // ffmpeg 的 WAV metadata 会生成 RIFF INFO；这里从无标签容器开始，确保该
    // fixture 真正只含 ID3v2，双标签场景由 `write_dual_tagged_wav` 显式构造。
    write_ffmpeg_fixture(dir, name, "wav", "pcm_s16le", None, None);
    let path = dir.join(name);
    let mut bytes = fs::read(&path).expect("读取 WAV fixture 失败");
    let id3 = id3v24_text_tag(title, artist);
    bytes.extend_from_slice(b"ID3 ");
    bytes.extend_from_slice(&(id3.len() as u32).to_le_bytes());
    bytes.extend_from_slice(&id3);
    if id3.len() % 2 != 0 {
        bytes.push(0);
    }
    let riff_size = (bytes.len() - 8) as u32;
    bytes[4..8].copy_from_slice(&riff_size.to_le_bytes());
    fs::write(path, bytes).expect("写入 WAV ID3 fixture 失败");
    assert_wav_fixture_tags(&dir.join(name), true, false);
}

/// 构造只带 RIFF INFO 的 WAV。`fields` 使用 RIFF 四字符键，例如 `INAM`、`IART`。
/// 写入后立即用 lofty 早检，避免后续业务断言建立在无效 fixture 上。
pub fn write_riff_info_only_wav(dir: &Path, name: &str, fields: &[(&str, &str)]) {
    write_tagless_wav(dir, name);
    let path = dir.join(name);
    append_riff_info(&path, fields);
    assert_wav_fixture_tags(&path, false, true);
}

/// 构造同时带 ID3v2 和 RIFF INFO 的 WAV，供字段级优先级场景使用。
pub fn write_dual_tagged_wav(
    dir: &Path,
    name: &str,
    id3_title: &str,
    id3_artist: &str,
    riff_fields: &[(&str, &str)],
) {
    write_tagged_wav(dir, name, id3_title, id3_artist);
    let path = dir.join(name);
    append_riff_info(&path, riff_fields);
    assert_wav_fixture_tags(&path, true, true);
}

/// 早检 WAV fixture 的容器类型和两种标签的存在形态。
pub fn assert_wav_fixture_tags(path: &Path, has_id3v2: bool, has_riff_info: bool) {
    let tagged = Probe::open(path)
        .and_then(|probed| probed.read())
        .unwrap_or_else(|err| panic!("WAV fixture 应可被 lofty 读取 {path:?}: {err}"));
    assert_eq!(
        tagged.file_type(),
        FileType::Wav,
        "fixture 应为 WAV: {path:?}"
    );
    assert_eq!(
        tagged.tag(TagType::Id3v2).is_some(),
        has_id3v2,
        "WAV ID3v2 形态不符: {path:?}"
    );
    assert_eq!(
        tagged.tag(TagType::RiffInfo).is_some(),
        has_riff_info,
        "WAV RIFF INFO 形态不符: {path:?}"
    );
}

/// 坏 WAV fixture 的早检接口：必须被 lofty 拒绝，不能误进入业务断言。
pub fn assert_bad_wav_fixture(path: &Path) {
    assert!(
        Probe::open(path).and_then(|probed| probed.read()).is_err(),
        "坏 WAV fixture 不应被 lofty 读取: {path:?}"
    );
}

fn append_riff_info(path: &Path, fields: &[(&str, &str)]) {
    assert!(!fields.is_empty(), "RIFF INFO fixture 至少应含一个字段");
    let mut info = Vec::from(&b"INFO"[..]);
    for (key, value) in fields {
        assert_eq!(key.len(), 4, "RIFF INFO key 必须是四字符: {key}");
        info.extend_from_slice(key.as_bytes());
        let value_len = value.len() + 1; // RIFF INFO 文本含 NUL 终止符。
        info.extend_from_slice(&(value_len as u32).to_le_bytes());
        info.extend_from_slice(value.as_bytes());
        info.push(0);
        if value_len % 2 != 0 {
            info.push(0);
        }
    }

    let mut bytes = fs::read(path).expect("读取 WAV fixture 失败");
    bytes.extend_from_slice(b"LIST");
    bytes.extend_from_slice(&(info.len() as u32).to_le_bytes());
    bytes.extend_from_slice(&info);
    let riff_size = (bytes.len() - 8) as u32;
    bytes[4..8].copy_from_slice(&riff_size.to_le_bytes());
    fs::write(path, bytes).expect("写入 WAV RIFF INFO fixture 失败");
}

pub fn write_tagged_m4a(dir: &Path, name: &str, title: &str, artist: &str) {
    write_ffmpeg_fixture(dir, name, "ipod", "alac", Some(title), Some(artist));
}

/// 真实容器但不含 primary tag 的 fixture，用于验证首次保存时创建标签。
pub fn write_tagless_wav(dir: &Path, name: &str) {
    write_ffmpeg_fixture(dir, name, "wav", "pcm_s16le", None, None);
}

pub fn write_tagless_m4a(dir: &Path, name: &str) {
    write_ffmpeg_fixture(dir, name, "ipod", "alac", None, None);
}

fn write_ffmpeg_fixture(
    dir: &Path,
    name: &str,
    format: &str,
    codec: &str,
    title: Option<&str>,
    artist: Option<&str>,
) {
    let output = dir.join(name);
    let mut args = vec![
        "-hide_banner".to_string(),
        "-loglevel".to_string(),
        "error".to_string(),
        "-f".to_string(),
        "lavfi".to_string(),
        "-i".to_string(),
        "anullsrc=r=8000:cl=mono".to_string(),
        "-t".to_string(),
        "0.1".to_string(),
        "-c:a".to_string(),
        codec.to_string(),
    ];
    if let Some(title) = title {
        args.extend(["-metadata".to_string(), format!("title={title}")]);
    }
    if let Some(artist) = artist {
        args.extend(["-metadata".to_string(), format!("artist={artist}")]);
    }
    args.extend([
        "-f".to_string(),
        format.to_string(),
        output.to_str().expect("fixture 路径应为 UTF-8").to_string(),
    ]);
    let status = Command::new("ffmpeg")
        .args(&args)
        .status()
        .expect("测试需要 ffmpeg 生成真实 WAV/M4A fixture");
    assert!(status.success(), "ffmpeg 生成 fixture 失败: {output:?}");
    if format == "wav" {
        // ffmpeg 即使没有用户 metadata 也会写入 `ISFT=Lavf...` RIFF INFO。
        // fixture 的标签形态必须可控，故先移除它，再由各构造器显式加入 ID3v2/INFO。
        strip_riff_info(&output);
    }
}

fn strip_riff_info(path: &Path) {
    let bytes = fs::read(path).expect("读取 WAV fixture 失败");
    assert!(
        bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WAVE"),
        "应为 WAV"
    );

    let mut stripped = bytes[..12].to_vec();
    let mut offset = 12;
    while offset + 8 <= bytes.len() {
        let size = u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap()) as usize;
        let end = offset + 8 + size;
        let padded_end = end + (size % 2);
        assert!(padded_end <= bytes.len(), "WAV fixture chunk 越界");
        let is_riff_info = &bytes[offset..offset + 4] == b"LIST"
            && bytes.get(offset + 8..offset + 12) == Some(b"INFO");
        if !is_riff_info {
            stripped.extend_from_slice(&bytes[offset..padded_end]);
        }
        offset = padded_end;
    }
    assert_eq!(offset, bytes.len(), "WAV fixture chunk 对齐失败");
    let riff_size = (stripped.len() - 8) as u32;
    stripped[4..8].copy_from_slice(&riff_size.to_le_bytes());
    fs::write(path, stripped).expect("移除 WAV RIFF INFO fixture 失败");
}

fn id3v24_text_tag(title: &str, artist: &str) -> Vec<u8> {
    fn synchsafe(n: usize) -> [u8; 4] {
        let n = n as u32;
        [(n >> 21) as u8, (n >> 14) as u8, (n >> 7) as u8, n as u8]
    }
    fn frame(id: &[u8; 4], value: &str) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(id);
        out.extend_from_slice(&synchsafe(value.len() + 1));
        out.extend_from_slice(&[0, 0, 3]);
        out.extend_from_slice(value.as_bytes());
        out
    }
    let mut frames = frame(b"TIT2", title);
    frames.extend(frame(b"TPE1", artist));
    let mut tag = b"ID3\x04\x00\x00".to_vec();
    tag.extend_from_slice(&synchsafe(frames.len()));
    tag.extend_from_slice(&frames);
    tag
}

/// 构造最小但合法的 Monkey's Audio 3.98 文件，并附带一个 APEv2 标题项。
/// APE 的属性读取只要求合法 MAC descriptor/header 和至少一个 frame；音频 frame
/// 本身不被 lofty 解码，故用一个占位字节即可，标签仍通过 lofty 完整读写。
pub fn write_tagged_ape(dir: &Path, name: &str, title: &str, artist: &str) {
    use std::io::Write;
    let mut out = Vec::new();
    out.extend_from_slice(b"MAC ");
    out.extend_from_slice(&3980u16.to_le_bytes());
    out.extend_from_slice(&52u32.to_le_bytes()); // descriptor length
    out.extend_from_slice(&[0u8; 42]);
    out.extend_from_slice(&0u16.to_le_bytes()); // compression level
    out.extend_from_slice(&0u16.to_le_bytes()); // format flags
    out.extend_from_slice(&73728u32.to_le_bytes());
    out.extend_from_slice(&1u32.to_le_bytes()); // final frame blocks
    out.extend_from_slice(&1u32.to_le_bytes()); // total frames
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&8000u32.to_le_bytes());
    out.push(0); // placeholder frame byte

    let mut items = Vec::new();
    for (key, value) in [("Title", title), ("Artist", artist)] {
        items.extend_from_slice(&(value.len() as u32).to_le_bytes());
        items.extend_from_slice(&0u32.to_le_bytes());
        items.extend_from_slice(key.as_bytes());
        items.push(0);
        items.extend_from_slice(value.as_bytes());
    }
    let tag_size = (items.len() + 32) as u32;
    let mut header = Vec::new();
    header.extend_from_slice(b"APETAGEX");
    header.extend_from_slice(&2000u32.to_le_bytes());
    header.extend_from_slice(&tag_size.to_le_bytes());
    header.extend_from_slice(&2u32.to_le_bytes());
    header.extend_from_slice(&0xE0000000u32.to_le_bytes());
    header.extend_from_slice(&[0u8; 8]);
    out.extend_from_slice(&header);
    out.extend_from_slice(&items);
    let mut footer = header;
    footer[20..24].copy_from_slice(&0xC0000000u32.to_le_bytes());
    out.extend_from_slice(&footer);
    fs::File::create(dir.join(name))
        .expect("创建 APE fixture 失败")
        .write_all(&out)
        .expect("写入 APE fixture 失败");
}

pub fn write_tagless_ape(dir: &Path, name: &str) {
    write_tagged_ape(dir, name, "", "");
    let path = dir.join(name);
    let mut bytes = fs::read(&path).expect("读取 APE fixture 失败");
    // MAC header (52-byte descriptor + 24-byte header) and one placeholder frame.
    bytes.truncate(52 + 24 + 1);
    fs::write(path, bytes).expect("写入无标签 APE fixture 失败");
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
