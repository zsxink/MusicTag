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

pub struct Lrclib;

/// LRCLIB 描述性 User-Agent（公开约定，非浏览器伪装；请求级覆盖共享 client 的默认 UA）。
const LRCLIB_UA: &str = "MusicTag/1.0 (search)";

const SEARCH_URL: &str = "https://lrclib.net/api/search";
const LYRIC_URL_BASE: &str = "https://lrclib.net/api/get";

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
            SEARCH_URL,
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
        let url = format!("{LYRIC_URL_BASE}/{id}");
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
}
