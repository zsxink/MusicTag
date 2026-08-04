// MusicTag — 网易云客户端（linuxapi 转发搜索 + 取词，design.md D4 / D5，search-sources-renewal）。
//
// 2026-08 起 weapi 搜索路径被风控空响应，改走 linuxapi 转发 `/api/linux/forward`（复用取词链路）：
// - 搜索：POST `/api/linux/forward`，form `eparams` = `crypto::linuxapi(json!({"method":"POST",
//   "url":"https://music.163.com/api/cloudsearch/pc","params":{"s":title,"type":1,"limit":10,"offset":0}}))`
//   → 响应结构 `result.songs[]` 与 weapi 相同，解析代码零改动；
// - 取词：POST `api/song/lyric?lv=-1&kv=-1&tv=-1`，linuxapi 加密 body `{ id, method:POST }` → `lrc.lyric`。
// 单源失败一律降级为空列表 / None（不 panic、不影响其余源）。

use crate::model::{MusicSourceId, SongCandidate};
use crate::service::searcher::{crypto, MusicSource};
use async_trait::async_trait;
use rand::Rng;

pub struct Netease;

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

const SEARCH_URL: &str = "https://music.163.com/api/linux/forward";
const LYRIC_URL: &str = "https://music.163.com/api/song/lyric?lv=-1&kv=-1&tv=-1";

/// 网易云搜索 linuxapi 转发的目标接口（`/api/cloudsearch/pc`，响应结构与 weapi 相同）。
const CLOUDSEARCH_URL: &str = "https://music.163.com/api/cloudsearch/pc";

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
        _artist: &str,
    ) -> Result<Vec<SongCandidate>, String> {
        // linuxapi 转发：`eparams` = AES-ECB 加密 `{ method, url, params }`（复用取词链路，
        // 与 `crypto::linuxapi` 已知向量单测锁定，search-sources-renewal D1）。
        let eparams = crypto::linuxapi(&search_payload(title));
        let resp = match client
            .post(SEARCH_URL)
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
        // linuxapi：AES-ECB 加密 `{ id, method:POST }`（lv/kv/tv 走 URL query）
        let eparams =
            crypto::linuxapi(&serde_json::json!({"id": id, "method": "POST"}).to_string());
        let resp = client
            .post(LYRIC_URL)
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
fn search_payload(title: &str) -> String {
    serde_json::json!({
        "method": "POST",
        "url": CLOUDSEARCH_URL,
        "params": {"s": title, "type": 1, "limit": 10, "offset": 0},
    })
    .to_string()
}

/// 业务错误响应判定（CR v1-search-fixes）：HTTP 200 但 `code` 非 200（风控 50000005 等）→ 真。
///
/// 成功/正常空结果都带 `code:200`；仅 `code` 缺失（malformed）不算错误（按成功空兜底）。
fn is_error_response(json: &serde_json::Value) -> bool {
    json["code"].as_i64().is_some_and(|c| c != 200)
}

/// 解析搜索响应 `result.songs[]`（linuxapi 转发 `/api/cloudsearch/pc`，结构与 weapi 相同）→ 候选。
///
/// 映射（design.md 任务 2.4）：`id` / `name` → title；`ar[].name` → artist（逗号连接）；
/// `al.name` → album；`al.picUrl` → cover_url。空字段兜底为空串 / None（Rust 不 trim）。
fn parse_search_response(json: &serde_json::Value) -> Vec<SongCandidate> {
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
            cover_url: s["al"]["picUrl"].as_str().map(String::from),
        })
        .collect()
}

/// 解析 linuxapi 歌词响应 `lrc.lyric` → 歌词文本（无词/空 → None，供 C2 换源）。
fn parse_lyric_response(json: &serde_json::Value) -> Option<String> {
    let lyric = json["lrc"]["lyric"].as_str()?;
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
    fn search_payload_forwards_to_cloudsearch_via_linuxapi() {
        // search-sources-renewal D1：搜索 payload 走 linuxapi 转发 `/api/cloudsearch/pc`，
        // method=POST、params 带 s/type/limit/offset；eparams 为 hex 大写（AES-ECB 形状）。
        let payload: serde_json::Value = serde_json::from_str(&search_payload("晴天")).unwrap();
        assert_eq!(payload["method"], "POST");
        assert_eq!(payload["url"], CLOUDSEARCH_URL);
        assert_eq!(payload["params"]["s"], "晴天");
        assert_eq!(payload["params"]["type"], 1);
        assert_eq!(payload["params"]["limit"], 10);
        assert_eq!(payload["params"]["offset"], 0);
        // linuxapi 加密产物形状：hex 大写、长度偶数（AES-ECB 密文 hex）
        let eparams = crypto::linuxapi(&search_payload("晴天"));
        assert!(eparams.len().is_multiple_of(2));
        assert!(eparams.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn parses_search_response_full_fields() {
        let json = serde_json::json!({
            "result": {
                "songs": [{
                    "id": 33875191,
                    "name": "晴天",
                    "ar": [{"name": "周杰伦"}],
                    "al": {"name": "叶惠美", "picUrl": "https://p2.music.126.net/ab/cover.jpg"}
                }]
            }
        });
        let songs = parse_search_response(&json);
        assert_eq!(songs.len(), 1);
        let s = &songs[0];
        assert_eq!(s.source, MusicSourceId::Netease);
        assert_eq!(s.id, "33875191");
        assert_eq!(s.title, "晴天");
        assert_eq!(s.artist, "周杰伦");
        assert_eq!(s.album, "叶惠美");
        assert_eq!(
            s.cover_url.as_deref(),
            Some("https://p2.music.126.net/ab/cover.jpg")
        );
    }

    #[test]
    fn parses_search_response_multiple_artists_comma_joined() {
        // 多艺人 `ar[].name` → 逗号连接
        let json = serde_json::json!({
            "result": {"songs": [{
                "id": 1,
                "name": "t",
                "ar": [{"name": "A"}, {"name": "B"}],
                "al": {"name": "al"}
            }]}
        });
        let songs = parse_search_response(&json);
        assert_eq!(songs[0].artist, "A, B");
    }

    #[test]
    fn parses_search_response_empty_fields_fallback() {
        // 空 name / 无 ar / 空 al → 空串 + cover_url None 兜底（不 trim）
        let json = serde_json::json!({"result": {"songs": [{"id": 9, "name": "", "al": {}}]}});
        let songs = parse_search_response(&json);
        assert_eq!(songs.len(), 1);
        assert_eq!(songs[0].title, "");
        assert_eq!(songs[0].artist, "");
        assert_eq!(songs[0].album, "");
        assert_eq!(songs[0].cover_url, None);
        assert_eq!(songs[0].id, "9");
    }

    #[test]
    fn parses_search_response_missing_songs_returns_empty() {
        // 无 songs / 整体错误结构 → 空列表（单源降级）
        assert!(parse_search_response(&serde_json::json!({"result": {}})).is_empty());
        assert!(parse_search_response(&serde_json::json!({"code": 400})).is_empty());
    }

    #[test]
    fn is_error_response_detects_business_rejection() {
        // CR v1-search-fixes：风控等业务拒绝是 HTTP 200 + code≠200，必须判为「源失败」而非「成功空」
        assert!(
            is_error_response(&serde_json::json!({"code": 50000005, "msg": "风控"})),
            "风控 50000005 应判错误"
        );
        assert!(is_error_response(&serde_json::json!({"code": 400})));
        assert!(
            !is_error_response(&serde_json::json!({"code": 200, "result": {"songs": []}})),
            "code 200 成功"
        );
        assert!(
            !is_error_response(&serde_json::json!({"result": {}})),
            "malformed 无 code → 按成功空"
        );
    }

    #[test]
    fn parses_lyric_response_returns_text() {
        let json = serde_json::json!({"lrc": {"lyric": "[00:00.00]作词：方文山"}});
        assert_eq!(
            parse_lyric_response(&json).as_deref(),
            Some("[00:00.00]作词：方文山")
        );
    }

    #[test]
    fn parses_lyric_response_nolyric_returns_none() {
        // 无词（nolyric）或空 lyric → None（C2 换源触发点）
        assert_eq!(
            parse_lyric_response(&serde_json::json!({"nolyric": true})),
            None
        );
        assert_eq!(
            parse_lyric_response(&serde_json::json!({"lrc": {"lyric": ""}})),
            None
        );
        assert_eq!(parse_lyric_response(&serde_json::json!({})), None);
    }
}
