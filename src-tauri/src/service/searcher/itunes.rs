// MusicTag — iTunes Search 客户端（封面源，search-sources-renewal D5）。
//
// 苹果公开搜索 API，零鉴权零签名，`artworkUrl100` 字段天然带高清模板替换规则：
// - 搜索：GET `itunes.apple.com/search?term=<title> <artist> <album>&country=<店面>&media=music&entity=song&limit=10`
//   → `results[]`：`trackName`/`artistName`/`collectionName`/`artworkUrl100`；
//   `artworkUrl100` 的 `100x100bb` → `600x600bb` 替换（实测高清可用）。
//   （2026-10 fix-search-sources-locale D3）实测 `country=CN` 对 `entity=song/album` **结构性空**
//   （同店面 `media=podcast`/`software` 正常），且语种与店面**双向错配**：中文歌只有 HK 有真货、
//   西文歌只有 US 有规范艺名（HK 把 Blinding Lights 唱成「Abel Tesfaye」、US 把中文歌搜成罗马音）。
//   故改为 **HK + US 双店面并发**、**按店面序（HK 在前）拼接**后再交给聚合去重/截 TOP 3。
// - 取词：**恒 None**（iTunes 无歌词，不参与 C2 取词链——前端 C2_SOURCE_ORDER 不含 itunes）。
// 候选只带封面 URL，点选走既有 `download_cover`（5s 超时 + 12MB 限流，零改动）。
// 单源失败一律降级为空列表 / None。

use crate::model::{MusicSourceId, SongCandidate};
use crate::service::searcher::{join_query_terms, MusicSource};
use async_trait::async_trait;
use tokio::task::JoinSet;

pub struct Itunes {
    /// `/search` 搜索接口 base（**两店面共用**，靠 `country` 查询参数区分；Tester 注入点，语义不变）。
    pub search_url: String,
    /// 并发查询的店面序列（默认 `["HK", "US"]`）。**按此序拼接**结果，HK 在前。
    ///
    /// 2026-10 实测：单一店面无论选谁都丢一半召回（中文歌 / 西文歌双向错配），且任何语种启发式
    /// 在「中文艺人 + 拉丁歌名」组合上会猜错，故两个都查、让聚合的打分决定（D3，**不做语种猜测**）。
    pub storefronts: Vec<String>,
}

impl Default for Itunes {
    fn default() -> Self {
        Self {
            search_url: "https://itunes.apple.com/search".to_string(),
            storefronts: vec!["HK".to_string(), "US".to_string()],
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
        // country 由店面序参数化（不再硬编码 CN）、media=music&entity=song（只搜单曲）。
        // Url::parse_with_params 保证中文 term 正确 URL 编码。
        let term = join_query_terms(title, artist, album);
        // `slots` **先按店面序占位**（下标 = 店面序），JoinSet 任务回填按下标定位。
        let mut slots: Vec<Option<Result<Vec<SongCandidate>, String>>> =
            vec![None; self.storefronts.len()];
        let mut set = JoinSet::new();
        for (index, storefront) in self.storefronts.iter().enumerate() {
            let url = reqwest::Url::parse_with_params(
                &self.search_url,
                &[
                    ("term", term.as_str()),
                    ("country", storefront.as_str()),
                    ("media", "music"),
                    ("entity", "song"),
                    ("limit", "10"),
                ],
            )
            .expect("构造 iTunes 搜索 URL 失败");
            let client = client.clone();
            set.spawn(async move { (index, search_storefront(client, url).await) });
        }

        // JoinSet **完成顺序不确定** → 严格按任务回传的下标回填槽位（同 mod.rs
        // `search_song_with_sources` 的「先按固定序占位、再回填」惯用法），最后按店面序拼接，
        // 保证同分去重与最终排序可复现（直接 `join` 会让 HK/US 顺序随机）。
        while let Some(joined) = set.join_next().await {
            if let Ok((index, res)) = joined {
                if let Some(slot) = slots.get_mut(index) {
                    *slot = Some(res);
                }
            }
        }

        // 任一店面成功即该源成功（**含成功但空结果**）→ 不误算「成功空」为失败；
        // 两店面全失败才 Err（`all_failed` 依赖此口径，iTunes 一次失败抵一整个源）。
        let mut songs: Vec<SongCandidate> = Vec::new();
        let mut any_ok = false;
        let mut errors: Vec<String> = Vec::new();
        for (storefront, res) in self.storefronts.iter().zip(slots) {
            match res {
                Some(Ok(list)) => {
                    any_ok = true;
                    songs.extend(list);
                }
                Some(Err(e)) => errors.push(format!("{storefront}: {e}")),
                // 槽位未回填（JoinSet join 异常，如任务 panic）→ 视同该店面失败。
                None => errors.push(format!("{storefront}: 搜索任务无结果")),
            }
        }
        if any_ok || self.storefronts.is_empty() {
            return Ok(songs);
        }
        Err(errors.join("；"))
    }

    async fn fetch_lyric(&self, _client: &reqwest::Client, _id: &str) -> Option<String> {
        // iTunes 无歌词：恒 None（前端 C2 自动换其他源取词）。
        None
    }
}

/// 单店面搜索请求（`search()` 内的每个 JoinSet 任务）：HTTP 非 2xx / 请求失败 / JSON 解析失败 → `Err`。
///
/// 纯函数式一步（无状态、不依赖 `&self`），故 JoinSet 任务只需捕获 `client` 与 `url` 两个 `'static`
/// 可拥有的值；结果槽位由 `search()` 按任务回传的下标定位。
async fn search_storefront(
    client: reqwest::Client,
    url: reqwest::Url,
) -> Result<Vec<SongCandidate>, String> {
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

