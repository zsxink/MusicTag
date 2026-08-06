// MusicTag — `service/searcher/lrclib.rs` LRCLIB 客户端单测（rust-tests-separation 外置）。
//
// 原 `#[cfg(test)] mod tests` 内嵌块整体迁出（production `src/` 零 `#[cfg(test)]`）。
// 覆盖 search-sources-renewal D4：
// - `parse_search_response` 字段映射（id 数字 → id，trackName/artistName/albumName，无封面）；
// - `parse_lyric_response` syncedLyrics 优先、空回退 plainLyrics、都空 → None（C2 换源）；
// - HTTP 非 2xx → Err 分支（mock server 404）。
// 被测函数经 `app_lib::service::searcher::lrclib::`；`mock_http_once` 用 `tests/common` 共享工具。

mod common;

use app_lib::service::searcher::lrclib::{Lrclib, parse_lyric_response, parse_search_response};
use app_lib::service::searcher::MusicSource;
use app_lib::model::MusicSourceId;
use common::{mock_http_capture, mock_http_once};

#[test]
fn parses_search_response_full_fields() {
    let json = serde_json::json!([
        {
            "id": 36847354,
            "trackName": "晴天",
            "artistName": "周杰伦",
            "albumName": "葉惠美",
            "duration": 299.0,
            "syncedLyrics": "[00:00.00]晴天",
            "plainLyrics": "晴天"
        }
    ]);
    let songs = parse_search_response(&json);
    assert_eq!(songs.len(), 1);
    let s = &songs[0];
    assert_eq!(s.source, MusicSourceId::Lrclib);
    assert_eq!(s.id, "36847354");
    assert_eq!(s.title, "晴天");
    assert_eq!(s.artist, "周杰伦");
    assert_eq!(s.album, "葉惠美");
    assert_eq!(s.cover_url, None, "LRCLIB 无封面 URL");
}

#[test]
fn parses_search_response_empty_array_or_object_returns_empty() {
    assert!(parse_search_response(&serde_json::json!([])).is_empty());
    assert!(parse_search_response(&serde_json::json!({"error": "not found"})).is_empty());
}

#[test]
fn parses_lyric_prefers_synced_falls_back_to_plain() {
    let json = serde_json::json!({
        "syncedLyrics": "[00:00.00]晴天（同步）",
        "plainLyrics": "晴天（纯文本）"
    });
    assert_eq!(
        parse_lyric_response(&json).as_deref(),
        Some("[00:00.00]晴天（同步）"),
        "syncedLyrics 优先"
    );

    // synced 为空 → 回退 plainLyrics
    let json2 = serde_json::json!({
        "syncedLyrics": "",
        "plainLyrics": "晴天（纯文本）"
    });
    assert_eq!(
        parse_lyric_response(&json2).as_deref(),
        Some("晴天（纯文本）"),
        "syncedLyrics 空回退 plainLyrics"
    );
}

#[test]
fn parses_lyric_both_empty_returns_none() {
    // 无词/空 → None（C2 换源触发点）
    assert_eq!(parse_lyric_response(&serde_json::json!({})), None);
    assert_eq!(
        parse_lyric_response(&serde_json::json!({"syncedLyrics": "", "plainLyrics": "  "})),
        None
    );
    assert_eq!(
        parse_lyric_response(&serde_json::json!({"syncedLyrics": null, "plainLyrics": null})),
        None
    );
}

#[tokio::test]
async fn search_adds_album_name_param_when_album_non_empty() {
    // search-cover-album：LRCLIB API 原生分参数——`track_name`/`artist_name` 恒传，
    // album 非空追加 `album_name`（空则省略，回退现行为）。
    // mock 服务器捕获请求目标，`Url::query_pairs()` 解码断言。
    let response =
        b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n[]".to_vec();
    let (url, captured) = mock_http_capture(response);
    let lrclib = Lrclib {
        search_url: url,
        lyric_url_base: String::new(),
    };
    let client = reqwest::Client::new();
    lrclib.search(&client, "晴天", "周杰伦", "叶惠美").await.unwrap();
    let target = captured.lock().unwrap().clone();
    let full = format!("{}{}", &lrclib.search_url, target);
    let parsed = reqwest::Url::parse(&full).expect("捕获请求目标应为合法 URL");
    let params: std::collections::HashMap<String, String> =
        parsed.query_pairs().into_owned().collect();
    assert_eq!(
        params.get("track_name").map(String::as_str),
        Some("晴天")
    );
    assert_eq!(
        params.get("artist_name").map(String::as_str),
        Some("周杰伦")
    );
    assert_eq!(
        params.get("album_name").map(String::as_str),
        Some("叶惠美")
    );

    // album 为空 → 省略 `album_name`（保持旧请求形状）
    let (url2, captured2) = mock_http_capture(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n[]".to_vec());
    let lrclib2 = Lrclib {
        search_url: url2,
        lyric_url_base: String::new(),
    };
    lrclib2.search(&client, "晴天", "周杰伦", "").await.unwrap();
    let target2 = captured2.lock().unwrap().clone();
    let full2 = format!("{}{}", &lrclib2.search_url, target2);
    let parsed2 = reqwest::Url::parse(&full2).expect("捕获请求目标应为合法 URL");
    let params2: std::collections::HashMap<String, String> =
        parsed2.query_pairs().into_owned().collect();
    assert_eq!(
        params2.get("track_name").map(String::as_str),
        Some("晴天")
    );
    assert_eq!(
        params2.get("artist_name").map(String::as_str),
        Some("周杰伦")
    );
    assert_eq!(
        params2.get("album_name"),
        None,
        "album 为空应省略 album_name 参数"
    );
}

#[tokio::test]
async fn http_error_status_returns_err() {
    // Tester 回归：各源 HTTP 非 2xx → Err 分支（源失败降级），mock server 404。
    // 构造源指向 mock URL（search_url），search 返回 Err 且消息含 404。
    let response = b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n".to_vec();
    let url = mock_http_once(response);
    let lrclib = Lrclib {
        search_url: url,
        lyric_url_base: String::new(),
    };
    let client = reqwest::Client::new();
    let err = lrclib.search(&client, "晴天", "周杰伦", "").await.unwrap_err();
    assert!(err.contains("404"), "非 2xx 应报 HTTP 状态，实际: {err}");
}
