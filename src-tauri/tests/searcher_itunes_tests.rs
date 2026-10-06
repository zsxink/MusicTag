// MusicTag — `service/searcher/itunes.rs` iTunes 客户端单测（rust-tests-separation 外置）。
//
// 原 `#[cfg(test)] mod tests` 内嵌块整体迁出（production `src/` 零 `#[cfg(test)]`）。
// 覆盖 search-sources-renewal D5 + fix-search-sources-locale D3：
// - `parse_search_response` 字段映射 + `artworkUrl100` 高清替换（100x100bb → 600x600bb）；
// - `fetch_lyric` 恒 None（iTunes 无歌词，不入 C2 取词链）；
// - **HK + US 双店面并发**（`country=HK`/`country=US`，店面序固定 HK 在前）、任一成功即
//   `Ok`、两店面全失败才 `Err`、合并后同曲经 `aggregate` 折叠为一条。
//
// **mock 约定（fix-search-sources-locale D3 后）**：`Itunes::search` 一次调用发**两次**请求，
// `mock_http_once` / `mock_http_capture` 各只服务 1 个请求 → 第二个连接被拒。故凡经
// `Itunes::search` 发网的用例一律用 `mock_http_router(routes, 2)`（按 `country=` 分流）。

mod common;

use app_lib::service::searcher::itunes::{Itunes, parse_search_response};
use app_lib::service::searcher::{MusicSource, aggregate, search_song_with_sources};
use app_lib::model::MusicSourceId;
use common::mock_http_router;
use std::time::Duration;

/// 挂起店面保留 TCP 连接直到测试结束；成功店面独立应答，不依赖请求到达顺序。
fn mock_hanging_storefront(
    successful_body: Option<&'static str>,
) -> (
    String,
    std::sync::Arc<std::sync::Mutex<Vec<std::net::TcpStream>>>,
) {
    use std::io::{Read, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let held = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let held_for_server = held.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming().take(2) {
            let mut stream = stream.unwrap();
            let held = held_for_server.clone();
            std::thread::spawn(move || {
                let mut request = [0; 8192];
                let count = stream.read(&mut request).unwrap();
                let request = String::from_utf8_lossy(&request[..count]);
                if request.contains("country=HK") {
                    if let Some(body) = successful_body {
                        stream.write_all(&http_json(body)).unwrap();
                        return;
                    }
                }
                held.lock().unwrap().push(stream);
            });
        }
    });
    (url, held)
}

#[tokio::test]
async fn search_song_preserves_success_when_other_storefront_times_out() {
    let (url, held) = mock_hanging_storefront(Some(
        r#"{"resultCount":1,"results":[{"trackId":1,"trackName":"晴天","artistName":"周杰倫","collectionName":"葉惠美"}]}"#,
    ));
    let mut sources = four_failing_stubs();
    sources.push(Box::new(Itunes {
        search_url: url,
        ..Default::default()
    }));
    let result = search_song_with_sources(
        &reqwest::Client::new(),
        "晴天",
        "周杰伦",
        "叶惠美",
        sources,
        Duration::from_millis(300),
    )
    .await;
    assert_eq!(
        held.lock().unwrap().len(),
        1,
        "US connection must still be pending, not failed"
    );
    assert!(
        !result.all_failed,
        "HK succeeded before the deadline; US timeout must not mark iTunes failed"
    );
    assert_eq!(
        result.source_stats.last(),
        Some(&(MusicSourceId::Itunes, 1))
    );
    assert_eq!(result.songs.len(), 1);
    assert_eq!(
        result.songs[0].artist, "周杰倫",
        "candidate text stays unchanged"
    );
}

#[tokio::test]
async fn search_song_preserves_successful_empty_storefront_at_deadline() {
    let (url, held) = mock_hanging_storefront(Some(r#"{"resultCount":0,"results":[]}"#));
    let mut sources = four_failing_stubs();
    sources.push(Box::new(Itunes {
        search_url: url,
        ..Default::default()
    }));
    let result = search_song_with_sources(
        &reqwest::Client::new(),
        "冷门歌",
        "",
        "",
        sources,
        Duration::from_millis(300),
    )
    .await;
    assert_eq!(held.lock().unwrap().len(), 1);
    assert!(
        !result.all_failed,
        "successful empty HK response must not cause session offline"
    );
    assert!(result.songs.is_empty());
    assert_eq!(
        result.source_stats.last(),
        Some(&(MusicSourceId::Itunes, 0))
    );
}

#[tokio::test]
async fn search_source_preserves_completed_storefront_at_deadline() {
    let (url, held) = mock_hanging_storefront(Some(
        r#"{"resultCount":1,"results":[{"trackId":1,"trackName":"晴天","artistName":"周杰倫"}]}"#,
    ));
    let songs = app_lib::service::searcher::search_source_with(
        &reqwest::Client::new(),
        Box::new(Itunes {
            search_url: url,
            ..Default::default()
        }),
        "晴天",
        "周杰伦",
        "",
        Duration::from_millis(300),
    )
    .await;
    assert_eq!(held.lock().unwrap().len(), 1);
    assert_eq!(
        songs.len(),
        1,
        "single-source search must retain the completed storefront too"
    );
}

#[tokio::test]
async fn search_song_both_storefronts_hanging_reaches_deadline_as_failure() {
    let (url, held) = mock_hanging_storefront(None);
    let mut sources = four_failing_stubs();
    sources.push(Box::new(Itunes {
        search_url: url,
        ..Default::default()
    }));
    let result = tokio::time::timeout(
        Duration::from_secs(2),
        search_song_with_sources(
            &reqwest::Client::new(),
            "晴天",
            "",
            "",
            sources,
            Duration::from_millis(300),
        ),
    )
    .await
    .expect("both hanging storefronts must still obey the source deadline");
    assert_eq!(held.lock().unwrap().len(), 2);
    assert!(result.all_failed);
    assert!(result.songs.is_empty());
}


/// HTTP 200 + JSON 响应字节（`body` 已是 JSON 文本）。
fn http_json(body: &str) -> Vec<u8> {
    format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
        body.len(),
        body
    )
    .into_bytes()
}

/// 指定 HTTP 状态码 + 空响应体（供 404 / 500 场景）。
fn http_status(code: u16, reason: &str) -> Vec<u8> {
    format!("HTTP/1.1 {code} {reason}\r\nContent-Length: 0\r\n\r\n").into_bytes()
}

/// 本文件专用的最小假源：只用于给 `search_song_with_sources` 凑满「五源」形状，
/// 让 iTunes 的店面成败成为**唯一变量**（否则未传入的源在 `raw` 里预置为 `None`、
/// 会被一并计入 `all_failed`，断言就没有区分力）。
struct StubSource {
    id: MusicSourceId,
    fail: bool,
}

#[async_trait::async_trait]
impl MusicSource for StubSource {
    fn id(&self) -> MusicSourceId {
        self.id
    }
    async fn search(
        &self,
        _client: &reqwest::Client,
        _title: &str,
        _artist: &str,
        _album: &str,
    ) -> Result<Vec<app_lib::model::SongCandidate>, String> {
        if self.fail {
            Err("stub 源失败".into())
        } else {
            Ok(Vec::new())
        }
    }
    async fn fetch_lyric(&self, _client: &reqwest::Client, _id: &str) -> Option<String> {
        None
    }
}

/// 其余四源全部失败的桩（配合一个真 iTunes，构成完整五源形状）。
fn four_failing_stubs() -> Vec<Box<dyn MusicSource>> {
    vec![
        Box::new(StubSource {
            id: MusicSourceId::Netease,
            fail: true,
        }),
        Box::new(StubSource {
            id: MusicSourceId::QqMusic,
            fail: true,
        }),
        Box::new(StubSource {
            id: MusicSourceId::Kugou,
            fail: true,
        }),
        Box::new(StubSource {
            id: MusicSourceId::Lrclib,
            fail: true,
        }),
    ]
}

/// 从 mock 捕获的请求目标里取某个查询参数值（目标形如 `/?p=1&n=10&country=HK&…`）。
fn query_param(target: &str, key: &str) -> Option<String> {
    let parsed = reqwest::Url::parse(&format!("http://mock.local{target}")).ok()?;
    parsed
        .query_pairs()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v.into_owned())
}

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
async fn search_uses_joined_keyword_in_term_param() {
    // search-cover-album：`term` = title + artist + album 拼接（综合三段，段间单空格）。
    //
    // fix-search-sources-locale 后 `search()` 发**两次**请求（HK + US 各一次）→ 用
    // `mock_http_router(.., 2)` 应答两次。**不**再断言 `country=CN`（该硬编码已删除），
    // 改为断言 `term` 在**两个店面上都一致**（共用同一 base URL 与同一 term 构造）。
    let (url, captured) = mock_http_router(|_| http_json(r#"{"resultCount":0,"results":[]}"#), 2);
    let itunes = Itunes {
        search_url: url,
        ..Default::default()
    };
    let client = reqwest::Client::new();
    itunes
        .search(&client, "晴天", "周杰伦", "叶惠美")
        .await
        .unwrap();
    let targets = captured.lock().unwrap().clone();
    assert_eq!(targets.len(), 2, "HK + US 两店面应各发一次请求");
    for target in &targets {
        assert_eq!(
            query_param(target, "term").as_deref(),
            Some("晴天 周杰伦 叶惠美"),
            "term 应为 title + artist + album 拼接串（两店面一致）: {target}"
        );
        assert_eq!(query_param(target, "media").as_deref(), Some("music"));
        assert_eq!(query_param(target, "entity").as_deref(), Some("song"));
    }

    // album 为空 → term 回退 title + artist（与现行为一致）
    let (url2, captured2) =
        mock_http_router(|_| http_json(r#"{"resultCount":0,"results":[]}"#), 2);
    let itunes2 = Itunes {
        search_url: url2,
        ..Default::default()
    };
    itunes2.search(&client, "晴天", "周杰伦", "").await.unwrap();
    let targets2 = captured2.lock().unwrap().clone();
    assert_eq!(targets2.len(), 2);
    for target in &targets2 {
        assert_eq!(
            query_param(target, "term").as_deref(),
            Some("晴天 周杰伦"),
            "album 为空 → term 回退 title + artist: {target}"
        );
    }
}

#[tokio::test]
async fn search_queries_hk_and_us_storefronts_and_concatenates_in_storefront_order() {
    // spec「双店面并发搜索」+「合并与店面序」（D3）：
    // - 并发发起两次请求，`country` 分别为 `HK` 与 `US`（**不再使用 CN**）；
    // - `media=music`、`entity=song`、`term` 综合 title + artist + album；
    // - 两店面结果**按 HK 在前、US 在后**拼接返回（JoinSet 完成序不定，实现按下标回填槽位）。
    //
    // HK 返繁体条目、US 返简体条目（真实语种错配形态）：「HK 在前」断言在**实现返回的候选序**上，
    // 不断言 mock 捕获目标的到达顺序（HK 不保证先到）。
    //
    // **fixture 早检**：`parse_search_response` 吃的是 `results[]`（trackName/artistName/
    // collectionName/artworkUrl100）；先断言解析出预期条数，再叠加顺序/合并断言。
    let (url, captured) = mock_http_router(
        |target| {
            if target.contains("country=HK") {
                http_json(
                    r#"{"resultCount":1,"results":[{"trackId":1,"trackName":"稻香","artistName":"周杰倫","collectionName":"葉惠美","artworkUrl100":"https://is1-ssl.mzstatic.com/hk/100x100bb.jpg"}]}"#,
                )
            } else {
                http_json(
                    r#"{"resultCount":1,"results":[{"trackId":2,"trackName":"稻香","artistName":"周杰伦","collectionName":"叶惠美","artworkUrl100":"https://is1-ssl.mzstatic.com/us/100x100bb.jpg"}]}"#,
                )
            }
        },
        2,
    );
    let itunes = Itunes {
        search_url: url,
        ..Default::default()
    };
    let client = reqwest::Client::new();
    let songs = itunes.search(&client, "稻香", "周杰伦", "叶惠美").await.unwrap();

    // 早检：两店面各 1 条，合计 2 条（未折叠——折叠发生在 `aggregate`，不在本方法内）
    assert_eq!(songs.len(), 2, "两店面各 1 条应原样拼接返回");
    assert_eq!(songs[0].source, MusicSourceId::Itunes);
    assert_eq!(songs[1].source, MusicSourceId::Itunes);

    // 请求 2 次，`country` 分别命中 HK 与 US（按**到达顺序**查集合，不断言谁先到）
    let targets = captured.lock().unwrap().clone();
    assert_eq!(targets.len(), 2, "双店面并发应恰好发两次请求");
    let countries: Vec<String> = targets
        .iter()
        .filter_map(|t| query_param(t, "country"))
        .collect();
    assert_eq!(countries.len(), 2, "每次请求都应带 country 参数: {targets:?}");
    assert!(
        countries.iter().any(|c| c == "HK"),
        "应发一次 country=HK: {countries:?}"
    );
    assert!(
        countries.iter().any(|c| c == "US"),
        "应发一次 country=US: {countries:?}"
    );
    assert!(
        !countries.iter().any(|c| c == "CN"),
        "不应再使用硬编码的 country=CN: {countries:?}"
    );

    // **店面序**：实现返回的候选序 HK 在前（繁体「周杰倫」那条），US 在后
    assert_eq!(songs[0].artist, "周杰倫", "HK（繁体）候选应排在 US 之前");
    assert_eq!(songs[0].id, "1");
    assert_eq!(songs[1].artist, "周杰伦");
    assert_eq!(songs[1].id, "2");
}

#[tokio::test]
async fn search_partial_storefront_success_returns_ok_with_successful_candidates_only() {
    // spec「部分成功」：仅一个店面成功（另一店面报错）→ 返回成功店面的候选，该源计为成功
    //（**不计入 `all_failed`**，离线降级依赖此口径）。
    let (url, _captured) = mock_http_router(
        |target| {
            if target.contains("country=HK") {
                http_status(500, "Internal Server Error")
            } else {
                http_json(
                    r#"{"resultCount":1,"results":[{"trackId":2,"trackName":"晴天","artistName":"周杰伦","collectionName":"叶惠美","artworkUrl100":"https://is1-ssl.mzstatic.com/us/100x100bb.jpg"}]}"#,
                )
            }
        },
        2,
    );
    let itunes = Itunes {
        search_url: url,
        ..Default::default()
    };
    let client = reqwest::Client::new();
    let songs = itunes.search(&client, "晴天", "周杰伦", "叶惠美").await.unwrap();
    // 早检：只含成功店面的候选，失败店面不贡献任何条目
    assert_eq!(songs.len(), 1, "只应含成功店面的候选");
    assert_eq!(songs[0].id, "2");
    assert_eq!(songs[0].artist, "周杰伦");
}

#[tokio::test]
async fn search_song_partial_storefront_success_not_counted_in_all_failed() {
    // spec「部分成功」+ search-ui delta「离线降级」的**成对**判别断言：
    // 同样是「其余四源全失败」，iTunes **一个**店面成功时 `all_failed=false`（不判离线、
    // `source_stats` 记合并后条数）；iTunes **两店面全失败**时该源才计失败（`all_failed=true`）。
    // 两条并置才钉住「iTunes 仅两店面全失败才计为失败」这条口径。
    let client = reqwest::Client::new();

    // ① HK 500 / US 200 → iTunes 计成功
    let (ok_url, _c1) = mock_http_router(
        |target| {
            if target.contains("country=HK") {
                http_status(500, "Internal Server Error")
            } else {
                http_json(
                    r#"{"resultCount":1,"results":[{"trackId":2,"trackName":"晴天","artistName":"周杰伦","collectionName":"叶惠美","artworkUrl100":"https://is1-ssl.mzstatic.com/us/100x100bb.jpg"}]}"#,
                )
            }
        },
        2,
    );
    let mut sources = four_failing_stubs();
    sources.push(Box::new(Itunes {
        search_url: ok_url,
        ..Default::default()
    }));
    let result = search_song_with_sources(
        &client,
        "晴天",
        "周杰伦",
        "叶惠美",
        sources,
        Duration::from_secs(5),
    )
    .await;
    assert_eq!(
        result.source_stats,
        vec![
            (MusicSourceId::Netease, 0),
            (MusicSourceId::QqMusic, 0),
            (MusicSourceId::Kugou, 0),
            (MusicSourceId::Lrclib, 0),
            (MusicSourceId::Itunes, 1),
        ],
        "部分成功 → iTunes 记合并后条数（该源计成功）"
    );
    assert!(
        !result.all_failed,
        "iTunes 只有一个店面失败时该源计为成功，不得触发 all_failed（离线判定）"
    );
}

#[tokio::test]
async fn search_both_storefronts_failing_returns_err_with_both_storefront_ids() {
    // spec「双店面全部失败」：**两店面均失败**才 Err（错误消息含两个店面标识，
    // 实现为 `format!("{storefront}: {e}")` 用 `；` 连接）。
    let (url, captured) = mock_http_router(|_| http_status(500, "Internal Server Error"), 2);
    let itunes = Itunes {
        search_url: url,
        ..Default::default()
    };
    let client = reqwest::Client::new();
    let err = itunes
        .search(&client, "晴天", "周杰伦", "")
        .await
        .unwrap_err();
    assert_eq!(
        captured.lock().unwrap().len(),
        2,
        "两个店面都应真的收到 500（本用例不靠「第二个连接被拒」侥幸判失败）"
    );
    assert!(err.contains("500"), "错误消息应含 HTTP 状态: {err}");
    assert!(
        err.contains("HK") && err.contains("US"),
        "错误消息应同时含两个店面标识: {err}"
    );
}

#[tokio::test]
async fn search_song_both_storefronts_failing_counts_source_as_failed() {
    // spec「双店面全部失败」：两店面均失败 → 该源计为失败、`source_stats` 记 0、
    // 计入 `all_failed`（映射 search-ui delta「离线降级」：iTunes 仅两店面全失败才算失败）。
    // 与上面的部分成功用例并置，才真正钉住这条口径。
    let (url, _captured) = mock_http_router(|_| http_status(500, "Internal Server Error"), 2);
    let mut sources = four_failing_stubs();
    sources.push(Box::new(Itunes {
        search_url: url,
        ..Default::default()
    }));
    let client = reqwest::Client::new();
    let result = search_song_with_sources(
        &client,
        "晴天",
        "周杰伦",
        "",
        sources,
        Duration::from_secs(5),
    )
    .await;
    assert_eq!(
        result.source_stats,
        vec![
            (MusicSourceId::Netease, 0),
            (MusicSourceId::QqMusic, 0),
            (MusicSourceId::Kugou, 0),
            (MusicSourceId::Lrclib, 0),
            (MusicSourceId::Itunes, 0),
        ],
        "两店面全失败 → iTunes 记 0（spec「双店面全部失败」）"
    );
    assert!(result.songs.is_empty(), "全部失败 → 无候选");
    assert!(
        result.all_failed,
        "其余四源也失败 → 五源全失败，离线信号成立"
    );
}

#[tokio::test]
async fn search_merge_dedups_same_song_across_storefronts_in_aggregate() {
    // spec「繁简同曲同源折叠」+「合并与店面序」：HK 返「稻香/周杰倫」、US 返「稻香/周杰伦」
    // → 经 `aggregate()` 后 iTunes 组内**只剩一条**（归一化 key 相同、跨源不折叠但**同源**折叠）。
    //
    // fixture 早检：先断言 `search()` 合并后确有 2 条（未折叠），再断言 `aggregate` 折叠为 1 条。
    let (url, _captured) = mock_http_router(
        |target| {
            if target.contains("country=HK") {
                http_json(
                    r#"{"resultCount":1,"results":[{"trackId":1,"trackName":"稻香","artistName":"周杰倫","collectionName":"葉惠美","artworkUrl100":"https://is1-ssl.mzstatic.com/hk/100x100bb.jpg"}]}"#,
                )
            } else {
                http_json(
                    r#"{"resultCount":1,"results":[{"trackId":2,"trackName":"稻香","artistName":"周杰伦","collectionName":"叶惠美","artworkUrl100":"https://is1-ssl.mzstatic.com/us/100x100bb.jpg"}]}"#,
                )
            }
        },
        2,
    );
    let itunes = Itunes {
        search_url: url,
        ..Default::default()
    };
    let client = reqwest::Client::new();
    let merged = itunes.search(&client, "稻香", "周杰伦", "叶惠美").await.unwrap();
    assert_eq!(merged.len(), 2, "合并阶段不折叠（繁简折叠在 aggregate 的同源去重里）");

    let songs = aggregate("稻香", "周杰伦", "叶惠美", merged);
    assert_eq!(songs.len(), 1, "iTunes 组内同曲（繁/简）折叠为一条");
    assert_eq!(songs[0].source, MusicSourceId::Itunes);
    // 同分保留**先出现**的一条（即店面序在前的 HK 繁体条目）
    assert_eq!(songs[0].id, "1", "同分应保留先出现的 HK 条目");
    assert_eq!(
        songs[0].artist, "周杰倫",
        "候选展示文本保持远端原文，不被折叠改写"
    );
}

#[tokio::test]
async fn http_error_status_returns_err() {
    // Tester 回归：各源 HTTP 非 2xx → Err 分支（源失败降级），mock server 404。
    //
    // **fix-search-sources-locale 后的新契约**：iTunes 发两次请求（HK + US），
    // **两店面均失败才 Err**。此处用 `mock_http_router(.., 2)` 让**两个店面都真的收到 404**
    // ——否则（沿用只服务一次请求的 `mock_http_once`）第二个连接被拒也会被算作失败，
    // `.unwrap_err()` 仍能「假通过」，钉不住新契约。
    let (url, captured) = mock_http_router(|_| http_status(404, "Not Found"), 2);
    let itunes = Itunes {
        search_url: url,
        ..Default::default()
    };
    let client = reqwest::Client::new();
    let err = itunes
        .search(&client, "晴天", "周杰伦", "")
        .await
        .unwrap_err();
    assert_eq!(
        captured.lock().unwrap().len(),
        2,
        "两个店面都应真的收到 404（本用例不靠连接被拒侥幸判失败）"
    );
    assert!(
        err.contains("404"),
        "两店面全失败 → Err，消息含 HTTP 状态: {err}"
    );
    assert!(
        err.contains("HK") && err.contains("US"),
        "两店面全失败 → Err，消息同时含两个店面标识: {err}"
    );
}
