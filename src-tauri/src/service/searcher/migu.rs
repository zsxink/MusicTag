// MusicTag — 咪咕客户端（scr_search_tag 搜索 + getLyric 取词，design.md D2 / D5）。
//
// 接口逐字对照 music-tag-web 的 MiGuMusicClient（纯 HTTP 无加密）：
// - 搜索：GET `m.music.migu.cn/migu/remoting/scr_search_tag?rows=10&type=2&keyword=<title>&pgc=1`
//   → 解析 `musics[]`；
// - 取词：GET `music.migu.cn/v3/api/music/audioPlayer/getLyric?copyrightId=<id>` → `lyric`。
// UA 覆盖为 Firefox + Referer `m.music.migu.cn`（design.md D2）。单源失败一律降级为空列表 / None。

use crate::model::{MusicSourceId, SongCandidate};
use crate::service::searcher::{json_string, MusicSource};
use async_trait::async_trait;

pub struct Migu;

/// 咪咕移动端 Firefox UA + Referer（design.md D2）。
const MIGU_UA: &str =
    "Mozilla/5.0 (Linux; Android 10; SM-G981B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const MIGU_REFERER: &str = "https://m.music.migu.cn/";

const SEARCH_URL: &str = "https://m.music.migu.cn/migu/remoting/scr_search_tag";
const LYRIC_URL_BASE: &str = "https://music.migu.cn/v3/api/music/audioPlayer/getLyric";

#[async_trait]
impl MusicSource for Migu {
    fn id(&self) -> MusicSourceId {
        MusicSourceId::Migu
    }

    async fn search(
        &self,
        client: &reqwest::Client,
        title: &str,
        _artist: &str,
    ) -> Result<Vec<SongCandidate>, String> {
        // keyword 须 URL 编码（中文/空格），用 Url::parse_with_params 保证。
        let url = reqwest::Url::parse_with_params(
            SEARCH_URL,
            &[
                ("rows", "10"),
                ("type", "2"),
                ("keyword", title),
                ("pgc", "1"),
            ],
        )
        .expect("构造咪咕搜索 URL 失败");
        let resp = match client
            .get(url)
            .header("User-Agent", MIGU_UA)
            .header("Referer", MIGU_REFERER)
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => return Err(format!("咪咕搜索请求失败: {e}")),
        };
        if !resp.status().is_success() {
            return Err(format!("咪咕搜索失败: HTTP {}", resp.status().as_u16()));
        }
        let json: serde_json::Value = match resp.json().await {
            Ok(v) => v,
            Err(e) => return Err(format!("咪咕搜索响应解析失败: {e}")),
        };
        // 业务错误响应（无 `musics` 数组但带 `code` 字段）→ 计为源失败，不误算「成功空」。
        if is_error_response(&json) {
            return Err(format!("咪咕搜索被拒: code={}", json["code"]));
        }
        Ok(parse_search_response(&json))
    }

    async fn fetch_lyric(&self, client: &reqwest::Client, id: &str) -> Option<String> {
        let url = format!("{LYRIC_URL_BASE}?copyrightId={id}");
        let resp = client
            .get(&url)
            .header("User-Agent", MIGU_UA)
            .header("Referer", MIGU_REFERER)
            .send()
            .await
            .ok()?;
        let json: serde_json::Value = resp.json().await.ok()?;
        parse_lyric_response(&json)
    }
}

/// 业务错误响应判定（CR v1-search-fixes）：无 `musics` 数组但带 `code` 字段 → 真。
///
/// 成功/正常空结果都返回 `musics` 数组（可为空）；错误响应是 `{"code":"...","msg":...}`。
fn is_error_response(json: &serde_json::Value) -> bool {
    json["musics"].as_array().is_none() && json.get("code").is_some()
}

/// 解析 scr_search_tag 响应 `musics[]` → 候选。
///
/// 映射（design.md 任务 3.3）：`copyrightId` → id（缺省回退 `id`）；`songName` → title；
/// `singerName` → artist；`albumName` → album；`cover` → cover_url。空字段兜底空串 / None。
fn parse_search_response(json: &serde_json::Value) -> Vec<SongCandidate> {
    let musics = match json["musics"].as_array() {
        Some(a) => a,
        None => return Vec::new(),
    };
    musics
        .iter()
        .map(|m| SongCandidate {
            source: MusicSourceId::Migu,
            id: json_string(&m["copyrightId"])
                .or_else(|| json_string(&m["id"]))
                .unwrap_or_default(),
            title: m["songName"].as_str().unwrap_or_default().to_string(),
            artist: m["singerName"].as_str().unwrap_or_default().to_string(),
            album: m["albumName"].as_str().unwrap_or_default().to_string(),
            cover_url: m["cover"].as_str().map(String::from),
        })
        .collect()
}

/// 解析 getLyric 响应 `lyric` → 歌词文本（空 → None，供 C2 换源）。
fn parse_lyric_response(json: &serde_json::Value) -> Option<String> {
    let lyric = json["lyric"].as_str()?;
    if lyric.trim().is_empty() {
        None
    } else {
        Some(lyric.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_search_response_full_fields() {
        let json = serde_json::json!({
            "musics": [{
                "copyrightId": "6005470192326504316",
                "songName": "晴天",
                "singerName": "周杰伦",
                "albumName": "叶惠美",
                "cover": "https://gss0.baidu.com/cover.jpg"
            }]
        });
        let songs = parse_search_response(&json);
        assert_eq!(songs.len(), 1);
        let s = &songs[0];
        assert_eq!(s.source, MusicSourceId::Migu);
        assert_eq!(s.id, "6005470192326504316");
        assert_eq!(s.title, "晴天");
        assert_eq!(s.artist, "周杰伦");
        assert_eq!(s.album, "叶惠美");
        assert_eq!(
            s.cover_url.as_deref(),
            Some("https://gss0.baidu.com/cover.jpg")
        );
    }

    #[test]
    fn parses_search_response_numeric_copyright_id_fallback() {
        // copyrightId 可能是数字（json_string 兜底 string/int/u64）
        let json = serde_json::json!({"musics": [{"copyrightId": 6005470192326504316u64, "songName": "t"}]});
        let songs = parse_search_response(&json);
        assert_eq!(songs[0].id, "6005470192326504316");

        // copyrightId 缺失 → 回退 `id`
        let json2 = serde_json::json!({"musics": [{"id": "abc123", "songName": "t"}]});
        let songs2 = parse_search_response(&json2);
        assert_eq!(songs2[0].id, "abc123");
    }

    #[test]
    fn parses_search_response_empty_fields_fallback() {
        let json = serde_json::json!({"musics": [{"songName": "", "singerName": "", "albumName": "", "cover": ""}]});
        let songs = parse_search_response(&json);
        assert_eq!(songs[0].title, "");
        assert_eq!(songs[0].artist, "");
        assert_eq!(songs[0].album, "");
        assert_eq!(songs[0].cover_url.as_deref(), Some(""));
        assert_eq!(songs[0].id, "");
    }

    #[test]
    fn parses_search_response_missing_musics_returns_empty() {
        assert!(parse_search_response(&serde_json::json!({})).is_empty());
        assert!(parse_search_response(&serde_json::json!({"code": "00001"})).is_empty());
    }

    #[test]
    fn is_error_response_detects_business_rejection() {
        // CR v1-search-fixes：无 musics 数组但带 code（业务被拒）→ 源失败，不误算「成功空」
        assert!(is_error_response(&serde_json::json!({"code": "00001", "msg": "被拒"})), "业务错误应判失败");
        assert!(!is_error_response(&serde_json::json!({"musics": []})), "正常空结果 → 成功");
        assert!(!is_error_response(&serde_json::json!({"musics": [{"songName": "晴天"}]})), "正常结果 → 成功");
        assert!(!is_error_response(&serde_json::json!({})), "malformed 无 code → 按成功空");
    }

    #[test]
    fn parses_lyric_response_returns_text() {
        let json = serde_json::json!({"lyric": "[00:00.00]作词：方文山"});
        assert_eq!(
            parse_lyric_response(&json).as_deref(),
            Some("[00:00.00]作词：方文山")
        );
    }

    #[test]
    fn parses_lyric_response_missing_returns_none() {
        assert_eq!(parse_lyric_response(&serde_json::json!({})), None);
        assert_eq!(
            parse_lyric_response(&serde_json::json!({"lyric": ""})),
            None
        );
    }
}
