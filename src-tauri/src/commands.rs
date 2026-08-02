// MusicTag — Rust 侧 Tauri command 实现。
//
// 本变更（v1-folder-list）交付两个只读命令：
// - `pick_folder`：rfd 原生文件夹选择器，返回目录绝对路径或 null（取消）。
// - `list_songs`：walkdir 深度遍历收集 FLAC/MP3，只读列表项 `SongSummary`。
//
// 按需读取原则（design.md §10.3）：列表只返回 `{ path, title, artist }`，不读
// 封面/歌词/其它标签；title/artist 从标签读取但不 trim（前端判定空串回退文件名）。
// 单文件标签读取失败时返回空串而非报错，保证列表永不因单曲坏标签崩溃。

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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;
    use tempfile::TempDir;

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
}
