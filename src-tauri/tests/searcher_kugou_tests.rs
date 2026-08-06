// MusicTag — `service/searcher/kugou.rs` 酷狗客户端单测（rust-tests-separation 外置）。
//
// 原 `#[cfg(test)] mod tests` 内嵌块整体迁出（production `src/` 零 `#[cfg(test)]`）。
// 覆盖 search-sources-renewal D3：
// - `signature` 已知向量锁算法（secret 前后包裹按字母序 key=value 的 md5）；
// - `search_params` 恒按 key 字母序产出 + 关键固定参数结构守卫；
// - `parse_search_response` / `is_error_response`（签名错 20006 → 源失败）；
// - `parse_lyric_search` / `parse_lyric_download`（两步取词解析）；
// - HTTP 非 2xx → Err 分支（mock server 404）。
// 被测函数经 `app_lib::service::searcher::kugou::`；`mock_http_once` 用 `tests/common` 共享工具。

mod common;

use app_lib::service::searcher::kugou::{
    Kugou, is_error_response, parse_lyric_download, parse_lyric_search, parse_search_response,
    search_params, signature,
};
use app_lib::service::searcher::MusicSource;
use app_lib::model::MusicSourceId;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use common::{mock_http_capture, mock_http_once};

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
fn search_params_accepts_joined_query_keyword() {
    // search-cover-album：查询关键词综合 title + artist + album，经 `join_query_terms` 拼接后
    // 传入 `search_params`（构造函数签名 keyword 不变，锚点不漂移）→ `keyword` 为拼接串。
    let params = search_params("晴天 周杰伦 叶惠美");
    let map: std::collections::HashMap<_, _> = params
        .iter()
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();
    assert_eq!(map.get("keyword"), Some(&"晴天 周杰伦 叶惠美"));
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

#[tokio::test]
async fn search_uses_joined_keyword_in_http_request() {
    // search-cover-album 三字段齐全（spec：酷狗 `keyword` = 「晴天 周杰伦 叶惠美」）。
    // 与 QQ/iTunes/LRCLIB/网易云同对称：mock 服务器捕获**实际发出的请求目标**，断言
    // `keyword` 参数为 join_query_terms 拼接串——验证 `Kugou::search()` 内部真的调用了
    // join_query_terms（而非只测 search_params 纯构造函数能收拼接串）。
    let response =
        b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"status\":1,\"error_code\":0,\"data\":{\"lists\":[]}}"
            .to_vec();
    let (url, captured) = mock_http_capture(response);
    let kugou = Kugou {
        search_url: url,
        lyric_search_url: String::new(),
        lyric_download_url: String::new(),
    };
    let client = reqwest::Client::new();
    kugou.search(&client, "晴天", "周杰伦", "叶惠美").await.unwrap();
    let target = captured.lock().unwrap().clone();
    let full = format!("{}{}", &kugou.search_url, target);
    let parsed = reqwest::Url::parse(&full).expect("捕获请求目标应为合法 URL");
    let params: std::collections::HashMap<String, String> =
        parsed.query_pairs().into_owned().collect();
    assert_eq!(
        params.get("keyword").map(String::as_str),
        Some("晴天 周杰伦 叶惠美")
    );
    assert!(params.contains_key("signature"), "签名参数应随请求发出");

    // album 为空 → keyword 回退 title + artist（不改动无专辑文件搜索路径）
    let (url2, captured2) = mock_http_capture(
        b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"status\":1,\"error_code\":0,\"data\":{\"lists\":[]}}"
            .to_vec(),
    );
    let kugou2 = Kugou {
        search_url: url2,
        lyric_search_url: String::new(),
        lyric_download_url: String::new(),
    };
    kugou2.search(&client, "晴天", "周杰伦", "").await.unwrap();
    let target2 = captured2.lock().unwrap().clone();
    let full2 = format!("{}{}", &kugou2.search_url, target2);
    let parsed2 = reqwest::Url::parse(&full2).expect("捕获请求目标应为合法 URL");
    let params2: std::collections::HashMap<String, String> =
        parsed2.query_pairs().into_owned().collect();
    assert_eq!(
        params2.get("keyword").map(String::as_str),
        Some("晴天 周杰伦")
    );
}

#[tokio::test]
async fn http_error_status_returns_err() {
    // Tester 回归：各源 HTTP 非 2xx → Err 分支（源失败降级），mock server 404。
    // 构造源指向 mock URL（search_url），search 返回 Err 且消息含 404。
    let response = b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n".to_vec();
    let url = mock_http_once(response);
    let kugou = Kugou {
        search_url: url,
        lyric_search_url: String::new(),
        lyric_download_url: String::new(),
    };
    let client = reqwest::Client::new();
    let err = kugou.search(&client, "晴天", "周杰伦", "").await.unwrap_err();
    assert!(err.contains("404"), "非 2xx 应报 HTTP 状态，实际: {err}");
}
