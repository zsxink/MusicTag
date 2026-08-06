// MusicTag — `service/searcher/netease.rs` 网易云客户端单测（rust-tests-separation 外置）。
//
// 原 `#[cfg(test)] mod tests` 内嵌块整体迁出（production `src/` 零 `#[cfg(test)]`）。
// 覆盖 design.md D4/D5 与 search-sources-renewal D1：
// - `search_payload`/`lyric_payload` linuxapi 转发结构（method=POST + url + params）+ 加密形状；
// - `parse_search_response` / `parse_lyric_response` / `is_error_response`（风控 code≠200 → 源失败）；
// - HTTP 非 2xx → Err 分支（mock server 404）。
// 被测函数经 `app_lib::service::searcher::netease::`；`mock_http_once` 用 `tests/common` 共享工具。

mod common;

use aes::cipher::generic_array::GenericArray;
use aes::cipher::{BlockDecrypt, KeyInit};
use app_lib::service::searcher::netease::{
    CLOUDSEARCH_URL, Netease, is_error_response, lyric_payload, parse_lyric_response,
    parse_search_response, search_payload,
};
use app_lib::service::searcher::{MusicSource, crypto};
use app_lib::model::MusicSourceId;
use common::mock_http_once;
use std::sync::{Arc, Mutex};

/// 启动极简 HTTP 服务器：读入完整请求（头 + body）后写回 `response`，返回 `(mock_url, 捕获文本)`。
///
/// 网易云走 POST form（`eparams` 在 body 而非请求目标），`common::mock_http_capture` 只捕获
/// 目标段不够用——本 helper 捕获整段原始请求，供「search() 内 join_query_terms 拼接是否真的
/// 进 eparams」断言（search-cover-album 三字段齐全场景）。
fn mock_http_capture_full(response: Vec<u8>) -> (String, Arc<Mutex<String>>) {
    use std::io::{Read, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("绑定本地端口");
    let addr = listener.local_addr().expect("取本地端口");
    let captured = Arc::new(Mutex::new(String::new()));
    let captured_for_thread = captured.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut s) = stream else { continue };
            // 循环读直到「完整头部 + Content-Length 声明的正文」都收到：reqwest 常把 POST body
            // 拆成第二个 TCP 段，单次 read 只拿到 header（拿不到 body 就无法断言 eparams）。
            let mut request = Vec::new();
            let mut buf = [0u8; 8192];
            loop {
                let n = s.read(&mut buf).unwrap_or(0);
                if n == 0 {
                    break;
                }
                request.extend_from_slice(&buf[..n]);
                // header 终止符 `\r\n\r\n` 出现后，按 Content-Length 判断正文是否收全
                let header_end = request
                    .windows(4)
                    .position(|w| w == b"\r\n\r\n")
                    .map(|p| p + 4);
                let expected = header_end.and_then(|he| {
                    let head = String::from_utf8_lossy(&request[..he]);
                    head.lines()
                        .find(|l| l.to_ascii_lowercase().starts_with("content-length:"))
                        .and_then(|l| l.split_once(':').map(|(_, v)| v.trim().parse::<usize>().ok()))
                        .flatten()
                        .map(|cl| he + cl)
                });
                if let Some(e) = expected {
                    if request.len() >= e {
                        break;
                    }
                }
            }
            *captured_for_thread.lock().unwrap() = String::from_utf8_lossy(&request).to_string();
            let _ = s.write_all(&response);
            let _ = s.flush();
            break;
        }
    });
    (format!("http://{addr}"), captured)
}

/// hex 解码（eparams 为 hex 大写密文）。
fn hex_decode(s: &str) -> Vec<u8> {
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).expect("eparams 应为 hex"))
        .collect()
}

/// AES-128-ECB 解密（PKCS7 去填充）——与 `crypto::aes_ecb_encrypt` 往返，供断言搜索关键词真实进入 eparams。
fn aes_ecb_decrypt(data: &[u8], key: &[u8]) -> String {
    let cipher = aes::Aes128::new_from_slice(key).expect("AES-128 密钥须为 16 字节");
    let mut buf = data.to_vec();
    for chunk in buf.chunks_exact_mut(16) {
        cipher.decrypt_block(GenericArray::from_mut_slice(chunk));
    }
    let pad = *buf.last().expect("非空密文") as usize;
    buf.truncate(buf.len() - pad);
    String::from_utf8(buf).expect("解密应为 UTF-8 JSON")
}

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
fn search_payload_accepts_joined_query_keyword() {
    // search-cover-album：查询关键词综合 title + artist + album，经 `join_query_terms` 拼接后
    // 传入 `search_payload`（构造函数签名 keyword 不变，锚点不漂移）→ `params.s` 为拼接串。
    let payload: serde_json::Value =
        serde_json::from_str(&search_payload("晴天 周杰伦 叶惠美")).unwrap();
    assert_eq!(payload["params"]["s"], "晴天 周杰伦 叶惠美");
    // album 为空 → 回退 title + artist（不改动无专辑文件搜索路径）
    let payload2: serde_json::Value = serde_json::from_str(&search_payload("晴天 周杰伦")).unwrap();
    assert_eq!(payload2["params"]["s"], "晴天 周杰伦");
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
    let err = netease.search(&client, "晴天", "周杰伦", "").await.unwrap_err();
    assert!(err.contains("404"), "非 2xx 应报 HTTP 状态，实际: {err}");
}

#[tokio::test]
async fn http_200_business_rejection_returns_err() {
    // Tester 失败路径：风控等业务拒绝是 **HTTP 200 + code≠200**（非 404）——这是 v1-search-fixes
    // 锁过的离线误判源头：若判成「成功空」，全源被风控时 all_failed=false、离线降级失效。
    // search() 必须走 `is_error_response` → Err（源失败），而不是 Ok(空列表)。
    let body = r#"{"code": 50000005, "msg": "网易云风控"}"#;
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    )
    .into_bytes();
    let url = mock_http_once(response);
    let netease = Netease { forward_url: url };
    let client = reqwest::Client::new();
    let err = netease.search(&client, "晴天", "周杰伦", "").await.unwrap_err();
    assert!(
        err.contains("50000005"),
        "业务拒绝（code≠200）应报 code 而非当成功空，实际: {err}"
    );
}

#[tokio::test]
async fn search_encrypts_joined_keyword_into_eparams() {
    // search-cover-album 三字段齐全端到端：`join_query_terms` 拼出的「歌名 歌手 专辑」必须真实
    // 进入加密 eparams（而不仅是 search_payload 构造函数签名层）——mock 捕获整段请求，
    // hex 解码 + AES-ECB(LINUXKEY) 解密回 payload，断言 `params.s` 为拼接串。
    let body = r#"{"code": 200, "result": {"songs": []}}"#;
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    )
    .into_bytes();
    let (url, captured) = mock_http_capture_full(response);
    let netease = Netease { forward_url: url };
    let client = reqwest::Client::new();
    let got = netease
        .search(&client, "晴天", "周杰伦", "叶惠美")
        .await
        .expect("code 200 空结果应 Ok(空列表)");
    assert!(got.is_empty());

    let raw = captured.lock().unwrap().clone();
    let body_part = raw
        .split("\r\n\r\n")
        .nth(1)
        .expect("POST form 请求应含 body 段");
    let eparams = body_part
        .trim()
        .strip_prefix("eparams=")
        .expect("body 应为 eparams=<hex> form");
    let cipher = hex_decode(eparams);
    let decrypted = aes_ecb_decrypt(&cipher, crypto::LINUXKEY);
    let json: serde_json::Value =
        serde_json::from_str(&decrypted).expect("eparams 解密后应为 JSON payload");
    assert_eq!(
        json["params"]["s"],
        "晴天 周杰伦 叶惠美",
        "三字段查询关键词应加密进 eparams（params.s）"
    );
    assert_eq!(json["url"], CLOUDSEARCH_URL);
    assert_eq!(json["method"], "POST");
}
