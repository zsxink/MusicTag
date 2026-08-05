// MusicTag — `service/searcher/itunes.rs` iTunes 客户端单测（rust-tests-separation 外置）。
//
// 原 `#[cfg(test)] mod tests` 内嵌块整体迁出（production `src/` 零 `#[cfg(test)]`）。
// 覆盖 search-sources-renewal D5：
// - `parse_search_response` 字段映射 + `artworkUrl100` 高清替换（100x100bb → 600x600bb）；
// - `fetch_lyric` 恒 None（iTunes 无歌词，不入 C2 取词链）；
// - HTTP 非 2xx → Err 分支（mock server 404）。
// 被测函数经 `app_lib::service::searcher::itunes::`；`mock_http_once` 用 `tests/common` 共享工具。

mod common;

use app_lib::service::searcher::itunes::{Itunes, parse_search_response};
use app_lib::service::searcher::MusicSource;
use app_lib::model::MusicSourceId;
use common::mock_http_once;

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

#[tokio::test]
async fn fetch_lyric_always_returns_none() {
    // spec「无歌词降级」：iTunes 无歌词，`fetch_lyric` 恒 None（前端 C2 换其他源取词；
    // iTunes 不入 C2_SOURCE_ORDER，点选其候选会立即触发换源）。
    let client = reqwest::Client::new();
    let itunes = Itunes::default();
    assert_eq!(itunes.fetch_lyric(&client, "1584471135").await, None);
    assert_eq!(itunes.fetch_lyric(&client, "").await, None);
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

#[tokio::test]
async fn http_error_status_returns_err() {
    // Tester 回归：各源 HTTP 非 2xx → Err 分支（源失败降级），mock server 404。
    // 构造源指向 mock URL（search_url），search 返回 Err 且消息含 404。
    let response = b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n".to_vec();
    let url = mock_http_once(response);
    let itunes = Itunes { search_url: url };
    let client = reqwest::Client::new();
    let err = itunes.search(&client, "晴天", "周杰伦").await.unwrap_err();
    assert!(err.contains("404"), "非 2xx 应报 HTTP 状态，实际: {err}");
}
