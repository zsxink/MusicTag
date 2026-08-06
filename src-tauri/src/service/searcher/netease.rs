// MusicTag — 网易云客户端（linuxapi 转发搜索 + 取词，design.md D4 / D5，search-sources-renewal）。
//
// 2026-08 起 weapi 搜索路径被风控空响应，改走 linuxapi 转发 `/api/linux/forward`（复用取词链路）：
// - 搜索：POST `/api/linux/forward`，form `eparams` = `crypto::linuxapi(json!({"method":"POST",
//   "url":"https://music.163.com/api/cloudsearch/pc","params":{"s":title,"type":1,"limit":10,"offset":0}}))`
//   → 响应结构 `result.songs[]` 与 weapi 相同，解析代码零改动；
// - 取词：同样 POST `/api/linux/forward`，form `eparams` = `crypto::linuxapi(lyric_payload)` 转发
//   `/api/song/lyric`（`{method:"POST",url:...,params:{id,lv:-1,kv:-1,tv:-1}}`）→ `lrc.lyric`
//   （linuxapi forward 透传原 API 响应，spec「网易云加密」）。
// 单源失败一律降级为空列表 / None（不 panic、不影响其余源）。
// `search_payload`/`lyric_payload`/`is_error_response`/`parse_*`/`CLOUDSEARCH_URL` 与结构体
// 字段提 `pub`：rust-tests-separation 单测外置 `tests/searcher_netease_tests.rs`（集成测试是
// 独立 crate，仅 `pub` 可见）。

use crate::model::{MusicSourceId, SongCandidate};
use crate::service::searcher::{crypto, join_query_terms, MusicSource};
use async_trait::async_trait;
use rand::Rng;

pub struct Netease {
    /// linuxapi 转发入口（搜索与取词共用 `/api/linux/forward`；Tester：HTTP 状态分支 mock 注入点）。
    pub forward_url: String,
}

impl Default for Netease {
    fn default() -> Self {
        Self {
            forward_url: FORWARD_URL.to_string(),
        }
    }
}

/// 随机浏览器 UA 列表（design.md D2：伪装降低风控，每次请求随机取一个）。
const USER_AGENTS: &[&str] = &[
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
];

fn random_ua() -> &'static str {
    let mut rng = rand::rng();
    USER_AGENTS[rng.random_range(0..USER_AGENTS.len())]
}

/// linuxapi 转发入口（搜索与取词共用；Default 字段来源）。
const FORWARD_URL: &str = "https://music.163.com/api/linux/forward";

/// 网易云搜索 linuxapi 转发的目标接口（`/api/cloudsearch/pc`，响应结构与 weapi 相同）。
///
/// `pub`：供 `src-tauri/tests/searcher_netease_tests.rs` 断言 payload url（rust-tests-separation
/// 单测外置；集成测试是独立 crate，仅 `pub` 可见）。
pub const CLOUDSEARCH_URL: &str = "https://music.163.com/api/cloudsearch/pc";

/// 网易云 anti-bot（`code:50000005` 风控）所需标准头（design.md D2 伪装）：
/// `Referer` 与 `Cookie` 缺一不可——仅随机 UA 会被风控拒绝。
const NETEASE_REFERER: &str = "https://music.163.com";
const NETEASE_COOKIE: &str = "os=pc; appver=2.9.7";

#[async_trait]
impl MusicSource for Netease {
    fn id(&self) -> MusicSourceId {
        MusicSourceId::Netease
    }

    async fn search(
        &self,
        client: &reqwest::Client,
        title: &str,
        artist: &str,
        album: &str,
    ) -> Result<Vec<SongCandidate>, String> {
        // linuxapi 转发：`eparams` = AES-ECB 加密 `{ method, url, params }`（复用取词链路，
        // 与 `crypto::linuxapi` 已知向量单测锁定，search-sources-renewal D1）。
        // search-cover-album：查询关键词综合 title + artist + album（空段跳过）；构造函数
        // `search_payload(keyword)` 签名不变，kw 拼好后传入（测试锚点不漂移）。
        let kw = join_query_terms(title, artist, album);
        let eparams = crypto::linuxapi(&search_payload(&kw));
        let resp = match client
            .post(&self.forward_url)
            .header("User-Agent", random_ua())
            .header("Referer", NETEASE_REFERER)
            .header("Cookie", NETEASE_COOKIE)
            .form(&[("eparams", &eparams)])
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => return Err(format!("网易云搜索请求失败: {e}")),
        };
        if !resp.status().is_success() {
            return Err(format!("网易云搜索失败: HTTP {}", resp.status().as_u16()));
        }
        let json: serde_json::Value = match resp.json().await {
            Ok(v) => v,
            Err(e) => return Err(format!("网易云搜索响应解析失败: {e}")),
        };
        // 业务错误码（如风控 code=50000005）：HTTP 200 但 code≠200 → 计为源失败，
        // 不得算作「成功空」（否则全源被阻断时 all_failed=false，离线降级失效）。
        if is_error_response(&json) {
            return Err(format!("网易云搜索被拒: code={}", json["code"]));
        }
        Ok(parse_search_response(&json))
    }

    async fn fetch_lyric(&self, client: &reqwest::Client, id: &str) -> Option<String> {
        // linuxapi 转发 `/api/song/lyric`：form `eparams` = AES-ECB 加密
        // `{method:"POST",url:"https://music.163.com/api/song/lyric",params:{id,lv,kv,tv}}`
        // （取词同样走 `/api/linux/forward`，spec「网易云加密」）。
        let eparams = crypto::linuxapi(&lyric_payload(id));
        let resp = client
            .post(&self.forward_url)
            .header("User-Agent", random_ua())
            .header("Referer", NETEASE_REFERER)
            .header("Cookie", NETEASE_COOKIE)
            .form(&[("eparams", &eparams)])
            .send()
            .await
            .ok()?;
        let json: serde_json::Value = resp.json().await.ok()?;
        parse_lyric_response(&json)
    }
}

/// 构建 linuxapi 转发搜索 payload（`{ method, url, params }`，search-sources-renewal D1）。
///
/// `params.s` = title、`type:1`（单曲）、`limit/offset` 控制条数。响应结构 `result.songs[]`。
pub fn search_payload(title: &str) -> String {
    serde_json::json!({
        "method": "POST",
        "url": CLOUDSEARCH_URL,
        "params": {"s": title, "type": 1, "limit": 10, "offset": 0},
    })
    .to_string()
}

/// 构建 linuxapi 转发取词 payload（`{ method, url, params }`，spec「网易云加密」）。
///
/// `params` 带 `id`/`lv`/`kv`/`tv`（-1 = 全取）。linuxapi forward 透传原 `/api/song/lyric`
/// 响应，解析 `lrc.lyric` 与直接调用一致。
pub fn lyric_payload(id: &str) -> String {
    serde_json::json!({
        "method": "POST",
        "url": "https://music.163.com/api/song/lyric",
        "params": {"id": id, "lv": -1, "kv": -1, "tv": -1},
    })
    .to_string()
}

/// 业务错误响应判定（CR v1-search-fixes）：HTTP 200 但 `code` 非 200（风控 50000005 等）→ 真。
///
/// 成功/正常空结果都带 `code:200`；仅 `code` 缺失（malformed）不算错误（按成功空兜底）。
pub fn is_error_response(json: &serde_json::Value) -> bool {
    json["code"].as_i64().is_some_and(|c| c != 200)
}

/// 解析搜索响应 `result.songs[]`（linuxapi 转发 `/api/cloudsearch/pc`，结构与 weapi 相同）→ 候选。
///
/// 映射（design.md 任务 2.4）：`id` / `name` → title；`ar[].name` → artist（逗号连接）；
/// `al.name` → album；`al.picUrl` → cover_url，且 `http://` 前缀升级 `https://`——网易云返回的
/// picUrl 为 http，Tauri WKWebView 安全上下文渲染 http 图片被混合内容拦截，封面候选破图隐藏、
/// 表现为「搜索不出封面」（Issue #113）；`p*.music.126.net` 同主机 https 可用，替换安全。
/// 空字段兜底为空串 / None（Rust 不 trim）。
pub fn parse_search_response(json: &serde_json::Value) -> Vec<SongCandidate> {
    let songs = match json["result"]["songs"].as_array() {
        Some(a) => a,
        None => return Vec::new(),
    };
    songs
        .iter()
        .map(|s| SongCandidate {
            source: MusicSourceId::Netease,
            id: s["id"].as_i64().map(|v| v.to_string()).unwrap_or_default(),
            title: s["name"].as_str().unwrap_or_default().to_string(),
            artist: s["ar"]
                .as_array()
                .map(|ars| {
                    ars.iter()
                        .filter_map(|a| a["name"].as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .unwrap_or_default(),
            album: s["al"]["name"].as_str().unwrap_or_default().to_string(),
            cover_url: s["al"]["picUrl"].as_str().map(|u| u.replace("http://", "https://")),
        })
        .collect()
}

/// 解析 linuxapi 歌词响应 `lrc.lyric` → 歌词文本（无词/空 → None，供 C2 换源）。
pub fn parse_lyric_response(json: &serde_json::Value) -> Option<String> {
    let lyric = json["lrc"]["lyric"].as_str()?;
    if lyric.trim().is_empty() {
        None
    } else {
        Some(lyric.to_string())
    }
}

