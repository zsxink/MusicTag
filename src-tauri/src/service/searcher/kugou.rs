// MusicTag — 酷狗客户端（complexsearch.kugou.com MD5 签名搜索 + lyrics.kugou.com 两步取词，
// search-sources-renewal D3，替代已废弃的咪咕）。
//
// 2026-08 实测：咪咕 scr_search_tag/getLyric 全死（301 → SPA HTML），酷狗两接口可用：
// - 搜索：GET `complexsearch.kugou.com/v2/search/song`，query 参数字母序拼接 →
//   secret `NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt` 前后包裹 → `md5` 摘要（小写 hex）做 `signature`；
//   不传 `callback` → 服务器返回**纯 JSON**（非 JSONP 包裹），解析 `data.lists[]`；
//   `error_code` 非 0（如 20006 签名错）→ 计为源失败；
// - 取词：两步 —— `lyrics.kugou.com/search?ver=1&man=yes&client=pc&hash=<FileHash>` 拿候选
//   `id`+`accesskey` → `lyrics.kugou.com/download?id=&accesskey=&fmt=lrc&charset=utf8` 返回 base64 LRC。
// 签名纯 Rust 实现（`md5` 依赖，无 JS 引擎）；已知向量单测锁算法（与 crypto.rs weapi/linuxapi 同哲学）。
// 单源失败一律降级为空列表 / None。

use crate::model::{MusicSourceId, SongCandidate};
use crate::service::searcher::{crypto, json_string, MusicSource};
use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};

pub struct Kugou;

/// 酷狗复杂搜索接口签名 secret（search-sources-renewal D3）。
const SIGN_SECRET: &str = "NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt";

const SEARCH_URL: &str = "http://complexsearch.kugou.com/v2/search/song";
const LYRIC_SEARCH_URL: &str = "http://lyrics.kugou.com/search";
const LYRIC_DOWNLOAD_URL: &str = "http://lyrics.kugou.com/download";

const KUGOU_UA: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const KUGOU_REFERER: &str = "https://www.kugou.com/";

/// 当前 epoch 毫秒（clienttime/mid/uuid 的形状，酷狗签名需毫秒级时间戳）。
fn now_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// 生成 32 位小写 hex（mid/uuid：随机字节取 md5，酷狗 web 同款设备指纹形状，每次请求随机）。
fn random_md5_hex() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 16];
    rand::rng().fill_bytes(&mut bytes);
    let digest = md5::compute(bytes);
    crypto::hex_encode(digest.as_ref())
}

/// 酷狗 MD5 签名（search-sources-renewal D3）：查询参数按字母序拼接 `key=value`，secret 前后包裹 → md5 小写 hex。
///
/// 已知向量锁算法（与 crypto.rs weapi/linuxapi 同哲学）——参数须**已按 key 字母序**传入。
fn signature(params: &[(String, String)]) -> String {
    let mut s = String::with_capacity(64 + params.len() * 24);
    s.push_str(SIGN_SECRET);
    for (k, v) in params {
        s.push_str(k);
        s.push('=');
        s.push_str(v);
    }
    s.push_str(SIGN_SECRET);
    let digest = md5::compute(s.as_bytes());
    crypto::hex_encode(digest.as_ref())
}

/// 构建搜索 query 参数（**已按 key 字母序**，供签名 + URL 直接使用）。
///
/// 值与酷狗 web 实测请求一致：`srcappid=2919`、`appid=1014`、`clientver=1000`（web 端）、
/// `userid=0`（免登录）、`dfid=-`；不传 `callback` → 纯 JSON 响应。`mid`/`uuid` 随机生成。
fn search_params(keyword: &str) -> Vec<(String, String)> {
    let clienttime = now_millis().to_string();
    let mid = random_md5_hex();
    vec![
        ("appid".to_string(), "1014".to_string()),
        ("bitrate".to_string(), "0".to_string()),
        ("clienttime".to_string(), clienttime),
        ("clientver".to_string(), "1000".to_string()),
        ("dfid".to_string(), "-".to_string()),
        ("filter".to_string(), "10".to_string()),
        ("inputtype".to_string(), "0".to_string()),
        ("iscorrection".to_string(), "1".to_string()),
        ("isfuzzy".to_string(), "0".to_string()),
        ("keyword".to_string(), keyword.to_string()),
        ("mid".to_string(), mid.clone()),
        ("page".to_string(), "1".to_string()),
        ("pagesize".to_string(), "10".to_string()),
        ("platform".to_string(), "WebFilter".to_string()),
        ("privilege_filter".to_string(), "0".to_string()),
        ("srcappid".to_string(), "2919".to_string()),
        ("token".to_string(), String::new()),
        ("userid".to_string(), "0".to_string()),
        ("uuid".to_string(), mid),
    ]
}

#[async_trait]
impl MusicSource for Kugou {
    fn id(&self) -> MusicSourceId {
        MusicSourceId::Kugou
    }

    async fn search(
        &self,
        client: &reqwest::Client,
        title: &str,
        _artist: &str,
    ) -> Result<Vec<SongCandidate>, String> {
        let mut params = search_params(title);
        let sig = signature(&params);
        params.push(("signature".to_string(), sig));
        let url =
            reqwest::Url::parse_with_params(SEARCH_URL, &params).expect("构造酷狗搜索 URL 失败");
        let resp = match client
            .get(url)
            .header("User-Agent", KUGOU_UA)
            .header("Referer", KUGOU_REFERER)
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => return Err(format!("酷狗搜索请求失败: {e}")),
        };
        if !resp.status().is_success() {
            return Err(format!("酷狗搜索失败: HTTP {}", resp.status().as_u16()));
        }
        let json: serde_json::Value = match resp.json().await {
            Ok(v) => v,
            Err(e) => return Err(format!("酷狗搜索响应解析失败: {e}")),
        };
        // 业务错误码（HTTP 200 但 error_code≠0，如 20006 签名错）：计为源失败，不误算「成功空」。
        if is_error_response(&json) {
            return Err(format!("酷狗搜索被拒: error_code={}", json["error_code"]));
        }
        Ok(parse_search_response(&json))
    }

    async fn fetch_lyric(&self, client: &reqwest::Client, id: &str) -> Option<String> {
        // 两步取词：/search（hash 即候选 FileHash，实测单独即可命中）拿候选 id+accesskey →
        // /download 取 base64 LRC。惰性拉取语义：点选才走这两次请求。
        let search_url = reqwest::Url::parse_with_params(
            LYRIC_SEARCH_URL,
            &[
                ("ver", "1"),
                ("man", "yes"),
                ("client", "pc"),
                ("keyword", ""),
                ("hash", id),
            ],
        )
        .ok()?;
        let resp = client
            .get(search_url)
            .header("User-Agent", KUGOU_UA)
            .header("Referer", KUGOU_REFERER)
            .send()
            .await
            .ok()?;
        let json: serde_json::Value = resp.json().await.ok()?;
        let (lyric_id, accesskey) = parse_lyric_search(&json)?;
        let dl_url = reqwest::Url::parse_with_params(
            LYRIC_DOWNLOAD_URL,
            &[
                ("ver", "1"),
                ("client", "pc"),
                ("fmt", "lrc"),
                ("charset", "utf8"),
                ("id", lyric_id.as_str()),
                ("accesskey", accesskey.as_str()),
            ],
        )
        .ok()?;
        let resp2 = client
            .get(dl_url)
            .header("User-Agent", KUGOU_UA)
            .header("Referer", KUGOU_REFERER)
            .send()
            .await
            .ok()?;
        let json2: serde_json::Value = resp2.json().await.ok()?;
        parse_lyric_download(&json2)
    }
}

/// 业务错误响应判定：HTTP 200 但 `error_code` 非 0（签名错 20006 等）→ 真。
///
/// 成功/正常空结果都带 `error_code:0`；仅 `error_code` 缺失（malformed）不算错误（按成功空兜底）。
fn is_error_response(json: &serde_json::Value) -> bool {
    json["error_code"].as_i64().is_some_and(|c| c != 0)
}

/// 解析 complexsearch 搜索响应 `data.lists[]` → 候选。
///
/// 映射（search-sources-renewal D3）：`FileHash` → id；`SongName` → title；`SingerName` → artist；
/// `AlbumName` → album；封面缺省 None（酷狗搜索响应无封面 URL，点选走 download_cover 需另行构造，
/// V1 封面搜索由其他源/前端兜底）。空字段兜底空串 / None（Rust 不 trim）。
fn parse_search_response(json: &serde_json::Value) -> Vec<SongCandidate> {
    let lists = match json["data"]["lists"].as_array() {
        Some(a) => a,
        None => return Vec::new(),
    };
    lists
        .iter()
        .map(|it| SongCandidate {
            source: MusicSourceId::Kugou,
            id: json_string(&it["FileHash"]).unwrap_or_default(),
            title: it["SongName"].as_str().unwrap_or_default().to_string(),
            artist: it["SingerName"].as_str().unwrap_or_default().to_string(),
            album: it["AlbumName"].as_str().unwrap_or_default().to_string(),
            cover_url: None,
        })
        .collect()
}

/// 解析 `/search` 候选第一个：`id` + `accesskey`（两步取词第一步，供 `/download`）。
///
/// `id` 可能是字符串或数字（json_string 兜底）；无候选 / 缺字段 → None（C2 换源触发点）。
fn parse_lyric_search(json: &serde_json::Value) -> Option<(String, String)> {
    let candidate = json["candidates"].as_array()?.first()?;
    let id = json_string(&candidate["id"])?;
    let accesskey = candidate["accesskey"].as_str()?.to_string();
    Some((id, accesskey))
}

/// 解析 `/download` 响应：`content` base64 → utf-8 LRC 文本（空/坏 base64 → None）。
fn parse_lyric_download(json: &serde_json::Value) -> Option<String> {
    let b64 = json["content"].as_str()?;
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
    fn signature_matches_known_vector_simple() {
        // 已知向量（Python md5 独立计算，search-sources-renewal D3 锁算法）：
        // secret + "a=1b=2" + secret 的 md5。参数已按字母序。
        let params = vec![
            ("a".to_string(), "1".to_string()),
            ("b".to_string(), "2".to_string()),
        ];
        assert_eq!(signature(&params), "70ccbef64fdcc9271fe883d1d7f07395");
    }

    #[test]
    fn signature_matches_known_vector_full_params() {
        // 已知向量（Python md5 独立计算）：完整搜索参数（含固定 clienttime/mid/uuid）→ 固定签名。
        let params = vec![
            ("appid", "1014"),
            ("bitrate", "0"),
            ("clienttime", "1750000000000"),
            ("clientver", "1000"),
            ("dfid", "-"),
            ("filter", "10"),
            ("inputtype", "0"),
            ("iscorrection", "1"),
            ("isfuzzy", "0"),
            ("keyword", "晴天"),
            ("mid", "5f4dcc3b5aa765d61d8327deb882cf99"),
            ("page", "1"),
            ("pagesize", "10"),
            ("platform", "WebFilter"),
            ("privilege_filter", "0"),
            ("srcappid", "2919"),
            ("token", ""),
            ("userid", "0"),
            ("uuid", "5f4dcc3b5aa765d61d8327deb882cf99"),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect::<Vec<_>>();
        assert_eq!(signature(&params), "2b7db96c5ea2bac081c729d038250fb7");
    }

    #[test]
    fn signature_wraps_secret_around_sorted_kv() {
        // 结构守卫：secret 前后包裹按字母序拼接的 key=value（与 design D3 逐字一致）
        let params = vec![
            ("b".to_string(), "2".to_string()),
            ("a".to_string(), "1".to_string()),
        ];
        // 注意：signature 假定已排序，故传入乱序会产生与「已排序」不同的签名——本测试用已排序的输入
        let sorted = {
            let mut p = params.clone();
            p.sort();
            p
        };
        assert_ne!(
            signature(&params),
            signature(&sorted),
            "乱序输入应产生不同签名（签名依赖参数顺序）"
        );
    }

    #[test]
    fn search_params_are_sorted_by_key() {
        // 签名要求参数按 key 字母序拼接——守卫 search_params 恒产出已排序列表
        let params = search_params("晴天");
        let mut sorted = params.clone();
        sorted.sort_by(|a, b| a.0.cmp(&b.0));
        assert_eq!(params, sorted, "search_params 必须按 key 字母序产出");
        // 结构守卫：关键固定参数存在
        let map: std::collections::HashMap<_, _> = params
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_str()))
            .collect();
        assert_eq!(map.get("srcappid"), Some(&"2919"));
        assert_eq!(map.get("appid"), Some(&"1014"));
        assert_eq!(map.get("clientver"), Some(&"1000"));
        assert_eq!(map.get("userid"), Some(&"0"));
        assert_eq!(map.get("dfid"), Some(&"-"));
        assert_eq!(map.get("keyword"), Some(&"晴天"));
        assert_eq!(map.get("pagesize"), Some(&"10"));
        assert_eq!(
            map.get("mid"),
            map.get("uuid"),
            "mid 与 uuid 同值（web 设备指纹形状）"
        );
        assert_eq!(map.get("mid").unwrap().len(), 32, "mid 应为 32 位小写 hex");
        assert!(
            map.get("clienttime").unwrap().len() > 10,
            "clienttime 应为毫秒级时间戳"
        );
    }

    #[test]
    fn parses_search_response_full_fields() {
        let json = serde_json::json!({
            "status": 1,
            "error_code": 0,
            "data": {
                "lists": [{
                    "FileHash": "B3A52A7A958BF0AED0EBFBA2E9A818B7",
                    "SongName": "晴天",
                    "SingerName": "周杰伦",
                    "AlbumName": "叶惠美"
                }]
            }
        });
        let songs = parse_search_response(&json);
        assert_eq!(songs.len(), 1);
        let s = &songs[0];
        assert_eq!(s.source, MusicSourceId::Kugou);
        assert_eq!(s.id, "B3A52A7A958BF0AED0EBFBA2E9A818B7");
        assert_eq!(s.title, "晴天");
        assert_eq!(s.artist, "周杰伦");
        assert_eq!(s.album, "叶惠美");
        assert_eq!(s.cover_url, None, "酷狗搜索响应无封面 URL");
    }

    #[test]
    fn parses_search_response_missing_lists_returns_empty() {
        assert!(parse_search_response(&serde_json::json!({"data": {}})).is_empty());
        assert!(parse_search_response(&serde_json::json!({"error_code": 20006})).is_empty());
    }

    #[test]
    fn is_error_response_detects_signature_rejection() {
        // CR v1-search-fixes：签名错 20006 等业务拒绝是 HTTP 200 + error_code≠0，必须判「源失败」
        assert!(
            is_error_response(
                &serde_json::json!({"error_code": 20006, "error_msg": "err signature"})
            ),
            "20006 签名错应判失败"
        );
        assert!(is_error_response(&serde_json::json!({"error_code": -1})));
        assert!(
            !is_error_response(
                &serde_json::json!({"status": 1, "error_code": 0, "data": {"lists": []}})
            ),
            "error_code 0 成功"
        );
        assert!(
            !is_error_response(&serde_json::json!({"data": {}})),
            "malformed 无 error_code → 按成功空"
        );
    }

    #[test]
    fn parses_lyric_search_candidates() {
        let json = serde_json::json!({
            "candidates": [{
                "id": "274944371",
                "accesskey": "2A7B35884B3C20E9D3281686BA59A3F8",
                "song": "晴天",
                "singer": "周杰伦"
            }]
        });
        let (id, accesskey) = parse_lyric_search(&json).expect("应有候选");
        assert_eq!(id, "274944371");
        assert_eq!(accesskey, "2A7B35884B3C20E9D3281686BA59A3F8");
    }

    #[test]
    fn parses_lyric_search_numeric_id_fallback() {
        // id 可能是数字（json_string 兜底）
        let json = serde_json::json!({"candidates": [{"id": 274944371, "accesskey": "ABC"}]});
        let (id, _) = parse_lyric_search(&json).expect("应有候选");
        assert_eq!(id, "274944371");
    }

    #[test]
    fn parses_lyric_search_missing_returns_none() {
        assert_eq!(parse_lyric_search(&serde_json::json!({})), None);
        assert_eq!(
            parse_lyric_search(&serde_json::json!({"candidates": []})),
            None
        );
        assert_eq!(
            parse_lyric_search(&serde_json::json!({"candidates": [{"accesskey": "ABC"}]})),
            None,
            "缺 id → None"
        );
    }

    #[test]
    fn parses_lyric_download_base64_decodes_utf8() {
        let text = "[ti:晴天]\n[ar:周杰伦]\n[00:00.00]晴天\n";
        let json = serde_json::json!({"id": "274944371", "content": BASE64.encode(text)});
        assert_eq!(parse_lyric_download(&json).as_deref(), Some(text));
    }

    #[test]
    fn parses_lyric_download_missing_or_empty_returns_none() {
        assert_eq!(parse_lyric_download(&serde_json::json!({})), None);
        assert_eq!(
            parse_lyric_download(&serde_json::json!({"content": ""})),
            None
        );
        assert_eq!(
            parse_lyric_download(&serde_json::json!({"content": "@@@not-base64@@@"})),
            None
        );
    }
}
