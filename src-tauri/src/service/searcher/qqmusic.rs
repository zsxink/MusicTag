// MusicTag — QQ 音乐客户端（client_search_cp GET 搜索 + fcg_query_lyric_new 取词，search-sources-renewal D2）。
//
// 2026-08 起 musicu.fcg 搜索被内层 code:2001 空响应，换公开 GET `client_search_cp`（零加密零签名）：
// - 搜索：GET `c.y.qq.com/soso/fcgi-bin/client_search_cp?p=1&n=10&w=<title>&format=json`
//   → 解析 `data.song.list[]`；顶层 `code` 字段沿用 `is_error_response`（`code!=0` → 源失败）；
// - 取词：GET `c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=<mid>`，响应 `lyric` 字段 **base64** → utf-8
//   （实测正常，保持不动；UA 用 ASCII 兜底——非 ASCII UA 被部分中间层拒绝）。
// 单源失败一律降级为空列表 / None。

use crate::model::{MusicSourceId, SongCandidate};
use crate::service::searcher::MusicSource;
use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};

pub struct QqMusic;

/// QQ 音乐 UA（design.md D2 覆盖值；ASCII 兜底——非 ASCII UA 可能被中间层拒绝）与 Referer。
const QQ_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const QQ_REFERER: &str = "https://y.qq.com/portal/profile.html";

const SEARCH_URL: &str = "https://c.y.qq.com/soso/fcgi-bin/client_search_cp";
const LYRIC_URL_BASE: &str = "https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg";

#[async_trait]
impl MusicSource for QqMusic {
    fn id(&self) -> MusicSourceId {
        MusicSourceId::QqMusic
    }

    async fn search(
        &self,
        client: &reqwest::Client,
        title: &str,
        _artist: &str,
    ) -> Result<Vec<SongCandidate>, String> {
        // client_search_cp：公开 GET，`w` 关键词、`p/n` 分页、`format=json`（零加密零签名）。
        // 用 Url::parse_with_params 保证中文 keyword 正确 URL 编码。
        let url = reqwest::Url::parse_with_params(
            SEARCH_URL,
            &[("p", "1"), ("n", "10"), ("w", title), ("format", "json")],
        )
        .expect("构造 QQ 搜索 URL 失败");
        let resp = match client
            .get(url)
            .header("User-Agent", QQ_UA)
            .header("Referer", QQ_REFERER)
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => return Err(format!("QQ 音乐搜索请求失败: {e}")),
        };
        if !resp.status().is_success() {
            return Err(format!("QQ 音乐搜索失败: HTTP {}", resp.status().as_u16()));
        }
        let json: serde_json::Value = match resp.json().await {
            Ok(v) => v,
            Err(e) => return Err(format!("QQ 音乐搜索响应解析失败: {e}")),
        };
        // 业务错误码（HTTP 200 但 code≠0）：计为源失败，不误算「成功空」（离线判定依赖）。
        if is_error_response(&json) {
            return Err(format!("QQ 音乐搜索被拒: code={}", json["code"]));
        }
        Ok(parse_search_response(&json))
    }

    async fn fetch_lyric(&self, client: &reqwest::Client, id: &str) -> Option<String> {
        // fcg_query_lyric_new：`songmid=<mid>`（候选 id 即 mid），`lyric` 字段 base64。
        let url = format!(
            "{LYRIC_URL_BASE}?g_tk=5381&format=json&platform=yqq&needNewCode=0&inCharset=utf8&outCharset=utf-8&notice=0&loginUin=0&hostUin=0&songmid={id}"
        );
        let resp = client
            .get(&url)
            .header("User-Agent", QQ_UA)
            .header("Referer", QQ_REFERER)
            .send()
            .await
            .ok()?;
        let text = resp.text().await.ok()?;
        let json: serde_json::Value = serde_json::from_str(&text).ok()?;
        parse_lyric_response(&json)
    }
}

/// 业务错误响应判定（CR v1-search-fixes）：HTTP 200 但顶层 `code` 非 0（如限流/风控 -1）→ 真。
///
/// 成功/正常空结果都带 `code:0`；仅 `code` 缺失（malformed）不算错误（按成功空兜底）。
fn is_error_response(json: &serde_json::Value) -> bool {
    json["code"].as_i64().is_some_and(|c| c != 0)
}

/// 解析 client_search_cp 搜索响应 `data.song.list[]` → 候选。
///
/// 映射（search-sources-renewal D2）：`songmid` → id（取歌词用 songmid）；`songname` → title；
/// `singer[].name` → artist（逗号连接）；`albumname` → album（空 → `未分类专辑`）；
/// `albummid` → 封面模板 `T002R300x300M000{albummid}.jpg`（空 → None）。
fn parse_search_response(json: &serde_json::Value) -> Vec<SongCandidate> {
    let list = match json["data"]["song"]["list"].as_array() {
        Some(a) => a,
        None => return Vec::new(),
    };
    list.iter()
        .map(|s| SongCandidate {
            source: MusicSourceId::QqMusic,
            id: s["songmid"].as_str().map(String::from).unwrap_or_else(|| {
                s["songid"]
                    .as_i64()
                    .map(|v| v.to_string())
                    .unwrap_or_default()
            }),
            title: s["songname"].as_str().unwrap_or_default().to_string(),
            artist: s["singer"]
                .as_array()
                .map(|ss| {
                    ss.iter()
                        .filter_map(|x| x["name"].as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .unwrap_or_default(),
            album: {
                let album = s["albumname"].as_str().unwrap_or_default();
                if album.is_empty() {
                    "未分类专辑"
                } else {
                    album
                }
            }
            .to_string(),
            cover_url: s["albummid"]
                .as_str()
                .filter(|mid| !mid.is_empty())
                .map(|mid| format!("https://y.qq.com/music/photo_new/T002R300x300M000{mid}.jpg")),
        })
        .collect()
}

/// 解析 fcg_query_lyric_new 响应：`lyric` 字段 base64 → utf-8 文本（空/解码失败 → None）。
fn parse_lyric_response(json: &serde_json::Value) -> Option<String> {
    let b64 = json["lyric"].as_str()?;
    if b64.trim().is_empty() {
        return None;
    }
    let bytes = BASE64.decode(b64.trim()).ok()?;
    let lyric = String::from_utf8(bytes).ok()?;
    if lyric.trim().is_empty() {
        None
    } else {
        Some(lyric)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_search_response_full_fields() {
        // client_search_cp 响应：`data.song.list[]`，顶层 `code:0`
        let json = serde_json::json!({
            "code": 0,
            "data": {
                "song": {
                    "list": [{
                        "songid": 97773,
                        "songmid": "0039MnYb0qxYhV",
                        "songname": "晴天",
                        "singer": [{"name": "周杰伦"}],
                        "albumname": "叶惠美",
                        "albummid": "000MkMni19ClKG"
                    }]
                }
            }
        });
        let songs = parse_search_response(&json);
        assert_eq!(songs.len(), 1);
        let s = &songs[0];
        assert_eq!(s.source, MusicSourceId::QqMusic);
        assert_eq!(
            s.id, "0039MnYb0qxYhV",
            "候选 id 应为 songmid（取歌词用 songmid）"
        );
        assert_eq!(s.title, "晴天");
        assert_eq!(s.artist, "周杰伦");
        assert_eq!(s.album, "叶惠美");
        assert_eq!(
            s.cover_url.as_deref(),
            Some("https://y.qq.com/music/photo_new/T002R300x300M000000MkMni19ClKG.jpg")
        );
    }

    #[test]
    fn parses_search_response_multiple_singers_comma_joined() {
        let json = serde_json::json!({
            "data": {"song": {"list": [{
                "songmid": "m1", "songname": "t",
                "singer": [{"name": "A"}, {"name": "B"}],
                "albumname": "al", "albummid": ""
            }]}}
        });
        let songs = parse_search_response(&json);
        assert_eq!(songs[0].artist, "A, B");
    }

    #[test]
    fn is_error_response_detects_business_rejection() {
        // CR v1-search-fixes：HTTP 200 但 code≠0（限流/风控）→ 源失败，不误算「成功空」
        assert!(is_error_response(&serde_json::json!({"code": -1})));
        assert!(
            !is_error_response(&serde_json::json!({"code": 0, "data": {}})),
            "code 0 成功"
        );
        assert!(
            !is_error_response(&serde_json::json!({"data": {}})),
            "malformed 无 code → 按成功空"
        );
    }

    #[test]
    fn parses_search_response_empty_album_falls_back_to_uncategorized() {
        // albumname 空 → `未分类专辑`；albummid 空 → cover_url None
        let json = serde_json::json!({
            "data": {"song": {"list": [{
                "songmid": "m1", "songname": "t", "singer": [], "album": {}
            }]}}
        });
        let songs = parse_search_response(&json);
        assert_eq!(songs[0].album, "未分类专辑");
        assert_eq!(songs[0].cover_url, None);
        assert_eq!(songs[0].artist, "");
    }

    #[test]
    fn parses_search_response_falls_back_to_numeric_id_when_songmid_missing() {
        let json = serde_json::json!({
            "data": {"song": {"list": [{
                "songid": 97773, "songname": "t", "singer": [], "albumname": "al"
            }]}}
        });
        let songs = parse_search_response(&json);
        assert_eq!(songs[0].id, "97773");
    }

    #[test]
    fn parses_search_response_missing_list_returns_empty() {
        assert!(parse_search_response(&serde_json::json!({"data": {}})).is_empty());
        assert!(parse_search_response(&serde_json::json!({"code": -1})).is_empty());
    }

    #[test]
    fn parses_lyric_response_base64_decodes_utf8() {
        let text = "[00:00.00]作词：方文山\n[00:01.00]晴天\n";
        let b64 = BASE64.encode(text);
        let json = serde_json::json!({"retcode": 0, "songmid": "004D3pK90wGyM2", "lyric": b64});
        assert_eq!(parse_lyric_response(&json).as_deref(), Some(text));
    }

    #[test]
    fn parses_lyric_response_missing_or_empty_returns_none() {
        // 空 lyric / 缺失 / 坏 base64 → None（C2 换源）
        assert_eq!(
            parse_lyric_response(&serde_json::json!({"lyric": ""})),
            None
        );
        assert_eq!(parse_lyric_response(&serde_json::json!({})), None);
        assert_eq!(
            parse_lyric_response(&serde_json::json!({"lyric": "@@@not-base64@@@"})),
            None
        );
    }
}
