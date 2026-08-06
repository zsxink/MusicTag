// MusicTag — `service/searcher/qqmusic.rs` QQ 音乐客户端单测（rust-tests-separation 外置）。
//
// 原 `#[cfg(test)] mod tests` 内嵌块整体迁出（production `src/` 零 `#[cfg(test)]`）。
// 覆盖 search-sources-renewal D2：
// - `parse_search_response` 字段映射（songmid 作 id / singer 逗号连接 / 空 album 兜底未分类专辑 /
//   albummid 封面模板 / 无 songmid 回退 songid）；
// - `is_error_response`（HTTP 200 但 code≠0 → 源失败）；
// - `parse_lyric_response` base64 → utf-8（空/坏 → None）；
// - HTTP 非 2xx → Err 分支（mock server 404）。
// 被测函数经 `app_lib::service::searcher::qqmusic::`；`mock_http_once` 用 `tests/common` 共享工具。

mod common;

use app_lib::service::searcher::qqmusic::{
    QqMusic, is_error_response, parse_lyric_response, parse_search_response,
};
use app_lib::service::searcher::MusicSource;
use app_lib::model::MusicSourceId;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use common::mock_http_once;

#[test]
fn parses_search_response_full_fields() {
    // client_search_cp 响应：`data.song.list[]`，顶层 `code:0`
    let json = serde_json::json!({
        "code": 0,
        "data": {
            "song": {
                "list": [{
                    "songid": 97773,
                    "songmid": "0039MnYb0qxYhV",
                    "songname": "晴天",
                    "singer": [{"name": "周杰伦"}],
                    "albumname": "叶惠美",
                    "albummid": "000MkMni19ClKG"
                }]
            }
        }
    });
    let songs = parse_search_response(&json);
    assert_eq!(songs.len(), 1);
    let s = &songs[0];
    assert_eq!(s.source, MusicSourceId::QqMusic);
    assert_eq!(
        s.id, "0039MnYb0qxYhV",
        "候选 id 应为 songmid（取歌词用 songmid）"
    );
    assert_eq!(s.title, "晴天");
    assert_eq!(s.artist, "周杰伦");
    assert_eq!(s.album, "叶惠美");
    assert_eq!(
        s.cover_url.as_deref(),
        Some("https://y.qq.com/music/photo_new/T002R300x300M000000MkMni19ClKG.jpg")
    );
}

#[test]
fn parses_search_response_multiple_singers_comma_joined() {
    let json = serde_json::json!({
        "data": {"song": {"list": [{
            "songmid": "m1", "songname": "t",
            "singer": [{"name": "A"}, {"name": "B"}],
            "albumname": "al", "albummid": ""
        }]}}
    });
    let songs = parse_search_response(&json);
    assert_eq!(songs[0].artist, "A, B");
}

#[test]
fn is_error_response_detects_business_rejection() {
    // CR v1-search-fixes：HTTP 200 但 code≠0（限流/风控）→ 源失败，不误算「成功空」
    assert!(is_error_response(&serde_json::json!({"code": -1})));
    assert!(
        !is_error_response(&serde_json::json!({"code": 0, "data": {}})),
        "code 0 成功"
    );
    assert!(
        !is_error_response(&serde_json::json!({"data": {}})),
        "malformed 无 code → 按成功空"
    );
}

#[test]
fn parses_search_response_empty_album_falls_back_to_uncategorized() {
    // albumname 空 → `未分类专辑`；albummid 空 → cover_url None
    let json = serde_json::json!({
        "data": {"song": {"list": [{
            "songmid": "m1", "songname": "t", "singer": [], "album": {}
        }]}}
    });
    let songs = parse_search_response(&json);
    assert_eq!(songs[0].album, "未分类专辑");
    assert_eq!(songs[0].cover_url, None);
    assert_eq!(songs[0].artist, "");
}

#[test]
fn parses_search_response_falls_back_to_numeric_id_when_songmid_missing() {
    let json = serde_json::json!({
        "data": {"song": {"list": [{
            "songid": 97773, "songname": "t", "singer": [], "albumname": "al"
        }]}}
    });
    let songs = parse_search_response(&json);
    assert_eq!(songs[0].id, "97773");
}

#[test]
fn parses_search_response_missing_list_returns_empty() {
    assert!(parse_search_response(&serde_json::json!({"data": {}})).is_empty());
    assert!(parse_search_response(&serde_json::json!({"code": -1})).is_empty());
}

#[test]
fn parses_lyric_response_base64_decodes_utf8() {
    let text = "[00:00.00]作词：方文山\n[00:01.00]晴天\n";
    let b64 = BASE64.encode(text);
    let json = serde_json::json!({"retcode": 0, "songmid": "004D3pK90wGyM2", "lyric": b64});
    assert_eq!(parse_lyric_response(&json).as_deref(), Some(text));
}

#[test]
fn parses_lyric_response_missing_or_empty_returns_none() {
    // 空 lyric / 缺失 / 坏 base64 → None（C2 换源）
    assert_eq!(
        parse_lyric_response(&serde_json::json!({"lyric": ""})),
        None
    );
    assert_eq!(parse_lyric_response(&serde_json::json!({})), None);
    assert_eq!(
        parse_lyric_response(&serde_json::json!({"lyric": "@@@not-base64@@@"})),
        None
    );
}

#[tokio::test]
async fn http_error_status_returns_err() {
    // Tester 回归：各源 HTTP 非 2xx → Err 分支（源失败降级），mock server 404。
    // 构造源指向 mock URL（search_url），search 返回 Err 且消息含 404。
    let response = b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n".to_vec();
    let url = mock_http_once(response);
    let qq = QqMusic {
        search_url: url,
        lyric_url_base: String::new(),
    };
    let client = reqwest::Client::new();
    let err = qq.search(&client, "晴天", "周杰伦", "").await.unwrap_err();
    assert!(err.contains("404"), "非 2xx 应报 HTTP 状态，实际: {err}");
}
