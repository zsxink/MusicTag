// MusicTag — LRCLIB 客户端（歌词源，search-sources-renewal D4）。
//
// 全球社区维护的开源歌词库，零鉴权零加密、接口稳定——歌词兜底的长期锚点：
// - 搜索：GET `lrclib.net/api/search?track_name=<title>&artist_name=<artist>` → 候选数组
//   （`id`/`trackName`/`artistName`/`albumName`，无封面 URL）；
// - 取词：GET `lrclib.net/api/get/{id}` → `syncedLyrics`（空回退 `plainLyrics`）。
// 请求带描述性 User-Agent（`MusicTag/1.0 (search)`，LRCLIB 公开约定），请求级覆盖共享 client 的默认浏览器 UA。
// 单源失败一律降级为空列表 / None（不 panic、不影响其余源）。

use crate::model::{MusicSourceId, SongCandidate};
use crate::service::searcher::MusicSource;
use async_trait::async_trait;

pub struct Lrclib {
    /// `/api/search` 搜索接口（Tester：HTTP 状态分支 mock 注入点）。
    search_url: String,
    /// `/api/get/{id}` 取词接口 base。
    lyric_url_base: String,
}

impl Default for Lrclib {
    fn default() -> Self {
        Self {
            search_url: "https://lrclib.net/api/search".to_string(),
            lyric_url_base: "https://lrclib.net/api/get".to_string(),
        }
    }
}

/// LRCLIB 描述性 User-Agent（公开约定，非浏览器伪装；请求级覆盖共享 client 的默认 UA）。
const LRCLIB_UA: &str = "MusicTag/1.0 (search)";

#[async_trait]
impl MusicSource for Lrclib {
    fn id(&self) -> MusicSourceId {
        MusicSourceId::Lrclib
    }

    async fn search(
        &self,
        client: &reqwest::Client,
        title: &str,
        artist: &str,
    ) -> Result<Vec<SongCandidate>, String> {
        let url = reqwest::Url::parse_with_params(
            &self.search_url,
            &[("track_name", title), ("artist_name", artist)],
        )
        .expect("构造 LRCLIB 搜索 URL 失败");
        let resp = match client.get(url).header("User-Agent", LRCLIB_UA).send().await {
            Ok(r) => r,
            Err(e) => return Err(format!("LRCLIB 搜索请求失败: {e}")),
        };
        if !resp.status().is_success() {
            return Err(format!("LRCLIB 搜索失败: HTTP {}", resp.status().as_u16()));
        }
        let json: serde_json::Value = match resp.json().await {
            Ok(v) => v,
            Err(e) => return Err(format!("LRCLIB 搜索响应解析失败: {e}")),
        };
        Ok(parse_search_response(&json))
    }

    async fn fetch_lyric(&self, client: &reqwest::Client, id: &str) -> Option<String> {
        // `/api/get/{id}` 一步取词：syncedLyrics 优先，空回退 plainLyrics。
        let url = format!("{}/{}", self.lyric_url_base, id);
        let resp = client
            .get(&url)
            .header("User-Agent", LRCLIB_UA)
            .send()
            .await
            .ok()?;
        let json: serde_json::Value = resp.json().await.ok()?;
        parse_lyric_response(&json)
    }
}

/// 解析 `/api/search` 候选数组 → 候选。
///
/// 映射（search-sources-renewal D4）：`id`（数字）→ id；`trackName` → title；`artistName` → artist；
/// `albumName` → album；无封面 URL → None。空字段兜底空串（Rust 不 trim）。
fn parse_search_response(json: &serde_json::Value) -> Vec<SongCandidate> {
    let arr = match json.as_array() {
        Some(a) => a,
        None => return Vec::new(),
    };
    arr.iter()
        .map(|it| SongCandidate {
            source: MusicSourceId::Lrclib,
            id: it["id"].as_i64().map(|v| v.to_string()).unwrap_or_default(),
            title: it["trackName"].as_str().unwrap_or_default().to_string(),
            artist: it["artistName"].as_str().unwrap_or_default().to_string(),
            album: it["albumName"].as_str().unwrap_or_default().to_string(),
            cover_url: None,
        })
        .collect()
}

/// 解析 `/api/get/{id}` 响应：`syncedLyrics` 优先，空回退 `plainLyrics`（都空 → None，供 C2 换源）。
fn parse_lyric_response(json: &serde_json::Value) -> Option<String> {
    let synced = json["syncedLyrics"].as_str();
    let plain = json["plainLyrics"].as_str();
    let lyric = synced
        .filter(|s| !s.trim().is_empty())
        .or_else(|| plain.filter(|s| !s.trim().is_empty()))?;
    Some(lyric.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::service::searcher::test_util::mock_http_once;

    #[test]
    fn parses_search_response_full_fields() {
        let json = serde_json::json!([
            {
                "id": 36847354,
                "trackName": "晴天",
                "artistName": "周杰伦",
                "albumName": "葉惠美",
                "duration": 299.0,
                "syncedLyrics": "[00:00.00]晴天",
                "plainLyrics": "晴天"
            }
        ]);
        let songs = parse_search_response(&json);
        assert_eq!(songs.len(), 1);
        let s = &songs[0];
        assert_eq!(s.source, MusicSourceId::Lrclib);
        assert_eq!(s.id, "36847354");
        assert_eq!(s.title, "晴天");
        assert_eq!(s.artist, "周杰伦");
        assert_eq!(s.album, "葉惠美");
        assert_eq!(s.cover_url, None, "LRCLIB 无封面 URL");
    }

    #[test]
    fn parses_search_response_empty_array_or_object_returns_empty() {
        assert!(parse_search_response(&serde_json::json!([])).is_empty());
        assert!(parse_search_response(&serde_json::json!({"error": "not found"})).is_empty());
    }

    #[test]
    fn parses_lyric_prefers_synced_falls_back_to_plain() {
        let json = serde_json::json!({
            "syncedLyrics": "[00:00.00]晴天（同步）",
            "plainLyrics": "晴天（纯文本）"
        });
        assert_eq!(
            parse_lyric_response(&json).as_deref(),
            Some("[00:00.00]晴天（同步）"),
            "syncedLyrics 优先"
        );

        // synced 为空 → 回退 plainLyrics
        let json2 = serde_json::json!({
            "syncedLyrics": "",
            "plainLyrics": "晴天（纯文本）"
        });
        assert_eq!(
            parse_lyric_response(&json2).as_deref(),
            Some("晴天（纯文本）"),
            "syncedLyrics 空回退 plainLyrics"
        );
    }

    #[test]
    fn parses_lyric_both_empty_returns_none() {
        // 无词/空 → None（C2 换源触发点）
        assert_eq!(parse_lyric_response(&serde_json::json!({})), None);
        assert_eq!(
            parse_lyric_response(&serde_json::json!({"syncedLyrics": "", "plainLyrics": "  "})),
            None
        );
        assert_eq!(
            parse_lyric_response(&serde_json::json!({"syncedLyrics": null, "plainLyrics": null})),
            None
        );
    }

    #[tokio::test]
    async fn http_error_status_returns_err() {
        // Tester 回归：各源 HTTP 非 2xx → Err 分支（源失败降级），mock server 404。
        // 构造源指向 mock URL（search_url），search 返回 Err 且消息含 404。
        let response = b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n".to_vec();
        let url = mock_http_once(response);
        let lrclib = Lrclib {
            search_url: url,
            lyric_url_base: String::new(),
        };
        let client = reqwest::Client::new();
        let err = lrclib.search(&client, "晴天", "周杰伦").await.unwrap_err();
        assert!(err.contains("404"), "非 2xx 应报 HTTP 状态，实际: {err}");
    }
}
