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
use crate::service::searcher::{join_query_terms, MusicSource};
use async_trait::async_trait;

pub struct Itunes {
    /// `/search` 搜索接口（Tester：HTTP 状态分支 mock 注入点）。
    pub search_url: String,
}

impl Default for Itunes {
    fn default() -> Self {
        Self {
            search_url: "https://itunes.apple.com/search".to_string(),
        }
    }
}

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
        album: &str,
    ) -> Result<Vec<SongCandidate>, String> {
        // term = "<title> <artist> <album>"（search-cover-album：综合三段，空段跳过）；
        // country=CN（中文曲库优先）、media=music&entity=song（只搜单曲）。
        // Url::parse_with_params 保证中文 term 正确 URL 编码。
        let term = join_query_terms(title, artist, album);
        let url = reqwest::Url::parse_with_params(
            &self.search_url,
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
///
/// `pub`：供 `src-tauri/tests/searcher_itunes_tests.rs` 直接断言（rust-tests-separation
/// 单测外置；集成测试是独立 crate，仅 `pub` 可见）。
pub fn parse_search_response(json: &serde_json::Value) -> Vec<SongCandidate> {
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

