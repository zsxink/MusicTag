// MusicTag — `service/searcher/netease.rs` 网易云客户端单测（rust-tests-separation 外置）。
//
// 原 `#[cfg(test)] mod tests` 内嵌块整体迁出（production `src/` 零 `#[cfg(test)]`）。
// 覆盖 design.md D4/D5 与 search-sources-renewal D1：
// - `search_payload`/`lyric_payload` linuxapi 转发结构（method=POST + url + params）+ 加密形状；
// - `parse_search_response` / `parse_lyric_response` / `is_error_response`（风控 code≠200 → 源失败）；
// - HTTP 非 2xx → Err 分支（mock server 404）。
// 被测函数经 `app_lib::service::searcher::netease::`；`mock_http_once` 用 `tests/common` 共享工具。

mod common;

use app_lib::service::searcher::netease::{
    CLOUDSEARCH_URL, Netease, is_error_response, lyric_payload, parse_lyric_response,
    parse_search_response, search_payload,
};
use app_lib::service::searcher::{MusicSource, crypto};
use app_lib::model::MusicSourceId;
use common::mock_http_once;

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
fn lyric_payload_forwards_to_song_lyric_via_linuxapi() {
    // spec「网易云加密」：取词 payload 走 linuxapi 转发 `/api/song/lyric`——method=POST、
    // url 指向 `/api/song/lyric`、params 带 id/lv/kv/tv（-1 = 全取）。
    let payload: serde_json::Value = serde_json::from_str(&lyric_payload("33875191")).unwrap();
    assert_eq!(payload["method"], "POST");
    assert_eq!(payload["url"], "https://music.163.com/api/song/lyric");
    assert_eq!(payload["params"]["id"], "33875191");
    assert_eq!(payload["params"]["lv"], -1);
    assert_eq!(payload["params"]["kv"], -1);
    assert_eq!(payload["params"]["tv"], -1);
    // linuxapi 加密产物形状：偶数长度 hex 大写（AES-ECB 密文 hex 大写）
    let eparams = crypto::linuxapi(&lyric_payload("33875191"));
    assert!(eparams.len().is_multiple_of(2));
    assert!(
        eparams
            .chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit()),
        "eparams 应为大写 hex，实际: {eparams}"
    );
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

#[tokio::test]
async fn http_error_status_returns_err() {
    // Tester 回归：各源 HTTP 非 2xx → Err 分支（源失败降级），mock server 404。
    // 构造源指向 mock URL（forward_url），search 返回 Err 且消息含 404。
    let response = b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n".to_vec();
    let url = mock_http_once(response);
    let netease = Netease { forward_url: url };
    let client = reqwest::Client::new();
    let err = netease.search(&client, "晴天", "周杰伦").await.unwrap_err();
    assert!(err.contains("404"), "非 2xx 应报 HTTP 状态，实际: {err}");
}
