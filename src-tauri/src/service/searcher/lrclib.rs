// MusicTag — LRCLIB 客户端（歌词源，search-sources-renewal D4）。
//
// 全球社区维护的开源歌词库，零鉴权零加密、接口稳定——歌词兜底的长期锚点：
// - 搜索：GET `lrclib.net/api/search?track_name=<title>&artist_name=<artist>` → 候选数组
//   （`id`/`trackName`/`artistName`/`albumName`，无封面 URL）；
// - 取词：GET `lrclib.net/api/get/{id}` → `syncedLyrics`（空回退 `plainLyrics`）。
// 请求带描述性 User-Agent（`MusicTag/1.0 (search)`，LRCLIB 公开约定），请求级覆盖共享 client 的默认浏览器 UA。
// 单源失败一律降级为空列表 / None（不 panic、不影响其余源）。
// `parse_search_response`/`parse_lyric_response` 与结构体字段提 `pub`：rust-tests-separation
// 单测外置 `tests/searcher_lrclib_tests.rs`（集成测试是独立 crate，仅 `pub` 可见）。

use crate::model::{MusicSourceId, SongCandidate};
use crate::service::searcher::MusicSource;
use async_trait::async_trait;

pub struct Lrclib {
    /// `/api/search` 搜索接口（Tester：HTTP 状态分支 mock 注入点）。
    pub search_url: String,
    /// `/api/get/{id}` 取词接口 base。
    pub lyric_url_base: String,
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
        _album: &str,
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
pub fn parse_search_response(json: &serde_json::Value) -> Vec<SongCandidate> {
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
pub fn parse_lyric_response(json: &serde_json::Value) -> Option<String> {
    let synced = json["syncedLyrics"].as_str();
    let plain = json["plainLyrics"].as_str();
    let lyric = synced
        .filter(|s| !s.trim().is_empty())
        .or_else(|| plain.filter(|s| !s.trim().is_empty()))?;
    Some(lyric.to_string())
}

