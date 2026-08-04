// MusicTag — iTunes Search 客户端（封面源，search-sources-renewal D5）。
//
// 苹果公开搜索 API，零鉴权零签名，`artworkUrl100` 字段天然带高清模板替换规则：
// - 搜索：GET `itunes.apple.com/search?term=<title> <artist>&country=CN&media=music&entity=song&limit=10`
//   → `results[]`：`trackName`/`artistName`/`collectionName`/`artworkUrl100`；
//   `artworkUrl100` 的 `100x100bb` → `600x600bb` 替换（实测高清可用）。
// - 取词：**恒 None**（iTunes 无歌词，不参与 C2 取词链——前端 C2_SOURCE_ORDER 不含 itunes）。
// 候选只带封面 URL，点选走既有 `download_cover`（5s 超时 + 12MB 限流，零改动）。
// 单源失败一律降级为空列表 / None。

use crate::model::{MusicSourceId, SongCandidate};
use crate::service::searcher::MusicSource;
use async_trait::async_trait;

pub struct Itunes;

const SEARCH_URL: &str = "https://itunes.apple.com/search";

#[async_trait]
impl MusicSource for Itunes {
    fn id(&self) -> MusicSourceId {
        MusicSourceId::Itunes
    }

    async fn search(
        &self,
        client: &reqwest::Client,
        title: &str,
        artist: &str,
    ) -> Result<Vec<SongCandidate>, String> {
        // term = "<title> <artist>"；country=CN（中文曲库优先）、media=music&entity=song（只搜单曲）。
        // Url::parse_with_params 保证中文 term 正确 URL 编码。
        let term = format!("{title} {artist}").trim().to_string();
        let url = reqwest::Url::parse_with_params(
            SEARCH_URL,
            &[
                ("term", term.as_str()),
                ("country", "CN"),
                ("media", "music"),
                ("entity", "song"),
                ("limit", "10"),
            ],
        )
        .expect("构造 iTunes 搜索 URL 失败");
        let resp = match client.get(url).send().await {
            Ok(r) => r,
            Err(e) => return Err(format!("iTunes 搜索请求失败: {e}")),
        };
        if !resp.status().is_success() {
            return Err(format!("iTunes 搜索失败: HTTP {}", resp.status().as_u16()));
        }
        let json: serde_json::Value = match resp.json().await {
            Ok(v) => v,
            Err(e) => return Err(format!("iTunes 搜索响应解析失败: {e}")),
        };
        Ok(parse_search_response(&json))
    }

    async fn fetch_lyric(&self, _client: &reqwest::Client, _id: &str) -> Option<String> {
        // iTunes 无歌词：恒 None（前端 C2 自动换其他源取词）。
        None
    }
}

/// 解析 `/search` 响应 `results[]` → 候选。
///
/// 映射（search-sources-renewal D5）：`trackName` → title；`artistName` → artist；
/// `collectionName` → album；`artworkUrl100` → cover_url（`100x100bb` → `600x600bb` 高清替换）。
/// 空字段兜底空串 / None（Rust 不 trim）。
fn parse_search_response(json: &serde_json::Value) -> Vec<SongCandidate> {
    let results = match json["results"].as_array() {
        Some(a) => a,
        None => return Vec::new(),
    };
    results
        .iter()
        .map(|it| SongCandidate {
            source: MusicSourceId::Itunes,
            id: it["trackId"]
                .as_i64()
                .map(|v| v.to_string())
                .unwrap_or_default(),
            title: it["trackName"].as_str().unwrap_or_default().to_string(),
            artist: it["artistName"].as_str().unwrap_or_default().to_string(),
            album: it["collectionName"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            cover_url: it["artworkUrl100"]
                .as_str()
                .map(|u| u.replace("100x100bb", "600x600bb")),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_search_response_full_fields_and_upgrades_cover() {
        let json = serde_json::json!({
            "resultCount": 10,
            "results": [{
                "trackId": 1584471135,
                "trackName": "晴天",
                "artistName": "周杰伦",
                "collectionName": "叶惠美",
                "artworkUrl100": "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/45/8a/e4/458ae484-dc8b-5683-ce04-8d2948346462/JAY.jpg/100x100bb.jpg"
            }]
        });
        let songs = parse_search_response(&json);
        assert_eq!(songs.len(), 1);
        let s = &songs[0];
        assert_eq!(s.source, MusicSourceId::Itunes);
        assert_eq!(s.id, "1584471135");
        assert_eq!(s.title, "晴天");
        assert_eq!(s.artist, "周杰伦");
        assert_eq!(s.album, "叶惠美");
        assert_eq!(
            s.cover_url.as_deref(),
            Some("https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/45/8a/e4/458ae484-dc8b-5683-ce04-8d2948346462/JAY.jpg/600x600bb.jpg"),
            "artworkUrl100 应 100x100bb → 600x600bb 高清替换"
        );
    }

    #[test]
    fn parses_search_response_missing_results_returns_empty() {
        assert!(parse_search_response(&serde_json::json!({})).is_empty());
        assert!(parse_search_response(&serde_json::json!({"results": []})).is_empty());
    }

    #[test]
    fn parses_search_response_cover_url_unmodified_when_no_bb_pattern() {
        // 非 `100x100bb` 模板（异常 URL）→ 原样保留
        let json = serde_json::json!({
            "results": [{
                "trackId": 1,
                "trackName": "t",
                "artistName": "a",
                "collectionName": "c",
                "artworkUrl100": "https://example.com/cover.jpg"
            }]
        });
        let songs = parse_search_response(&json);
        assert_eq!(
            songs[0].cover_url.as_deref(),
            Some("https://example.com/cover.jpg")
        );
    }
}
