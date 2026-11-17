// MusicTag — 搜索源非法 URL 与聚合隔离测试（rust-review-hardening 4.2，Issue #194）。
//
// 覆盖 delta spec `search-sources` ADDED「搜索源与加密 helper 对非法输入不 panic」的
// 「注入的搜索 URL 无法解析」scenario（design.md §4.4.1 / §7.3）：
// - QQ 音乐 / 酷狗 / LRCLIB / iTunes 注入非法 `search_url`（`"://bad"`，无 scheme）后
//   调用 `search()` → 返回 `Err`，消息含源名与「搜索 URL 构造失败」，进程不 panic；
// - 聚合层 `search_song_with_sources` 把该源按失败处理：`source_stats` 记 0，
//   其余源（`StubSource`）候选保留、`all_failed == false`；
// - 四个真源全部注入非法 URL → `source_stats` 全 0、`all_failed == true`
//   （失败分类与网络失败一致）。
//
// **不发真实网络请求**：非法 URL 在 `Url::parse_with_params` 阶段即失败，不会进入 `send()`；
// `StubSource` 立即返回固定候选。聚合测试用 2s 短超时，仅作兜底。
//
// production `src/` 零 `#[cfg(test)]`，本文件按 rust-tests-separation 惯例放 `tests/`。

use app_lib::model::{MusicSourceId, SearchResult, SongCandidate};
use app_lib::service::searcher::itunes::Itunes;
use app_lib::service::searcher::kugou::Kugou;
use app_lib::service::searcher::lrclib::Lrclib;
use app_lib::service::searcher::qqmusic::QqMusic;
use app_lib::service::searcher::{search_song_with_sources, MusicSource};
use async_trait::async_trait;
use std::time::Duration;

/// 注入的非法 base URL：缺 scheme，`Url::parse_with_params` 在发请求前即返回解析错误。
const INVALID_URL: &str = "://bad";

/// 聚合测试的短超时（兜底；非法 URL 与 Stub 都不应消耗它）。
const AGGREGATION_TIMEOUT: Duration = Duration::from_secs(2);

fn client() -> reqwest::Client {
    reqwest::Client::new()
}

/// 从 `source_stats` 取指定源的候选计数（固定五源来源序，必须存在）。
fn stat(result: &SearchResult, source: MusicSourceId) -> usize {
    result
        .source_stats
        .iter()
        .find(|(id, _)| *id == source)
        .map(|(_, count)| *count)
        .unwrap_or_else(|| panic!("source_stats 应包含 {source:?}"))
}

/// 断言 `search()` 对非法 URL 返回该源中文 `Err`（而非 panic / Ok）。
///
/// 测试正常返回本身即「进程未 panic」的证据；断言消息同时锁定源名与统一文案前缀，
/// 保证用户可诊断、四源不互相混淆。
async fn assert_invalid_url_err(source: &dyn MusicSource, source_name: &str) {
    let err = source
        .search(&client(), "晴天", "周杰伦", "叶惠美")
        .await
        .expect_err("非法搜索 URL 必须返回 Err，不得 panic 或伪装成成功");
    assert!(
        err.contains(source_name),
        "错误消息应含源名「{source_name}」，实际: {err}"
    );
    assert!(
        err.contains("搜索 URL 构造失败"),
        "错误消息应含「搜索 URL 构造失败」，实际: {err}"
    );
}

// ---- 四源各自：非法 URL → Err（不 panic） ----

#[tokio::test]
async fn invalid_search_url_returns_err_without_panic_qqmusic() {
    let source = QqMusic {
        search_url: INVALID_URL.to_string(),
        ..QqMusic::default()
    };
    assert_invalid_url_err(&source, "QQ 音乐").await;
}

#[tokio::test]
async fn invalid_search_url_returns_err_without_panic_kugou() {
    let source = Kugou {
        search_url: INVALID_URL.to_string(),
        ..Kugou::default()
    };
    assert_invalid_url_err(&source, "酷狗").await;
}

#[tokio::test]
async fn invalid_search_url_returns_err_without_panic_lrclib() {
    let source = Lrclib {
        search_url: INVALID_URL.to_string(),
        ..Lrclib::default()
    };
    assert_invalid_url_err(&source, "LRCLIB").await;
}

#[tokio::test]
async fn invalid_search_url_returns_err_without_panic_itunes() {
    // iTunes 在店面循环内构造 URL：首个店面（HK）非法即返回该源 Err，不继续请求。
    let source = Itunes {
        search_url: INVALID_URL.to_string(),
        ..Itunes::default()
    };
    assert_invalid_url_err(&source, "iTunes").await;
}

// ---- 聚合隔离：非法源记 0，其他源不受影响 ----

/// 本地假源：立即返回固定候选（不走网络），用于证明聚合中非法真源不拖累其他源。
struct StubSource {
    id: MusicSourceId,
    candidates: Vec<SongCandidate>,
}

#[async_trait]
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
    ) -> Result<Vec<SongCandidate>, String> {
        Ok(self.candidates.clone())
    }

    async fn fetch_lyric(&self, _client: &reqwest::Client, _id: &str) -> Option<String> {
        None
    }
}

#[tokio::test]
async fn invalid_source_is_isolated_in_aggregation() {
    // Stub 占用 Netease 位（成功 1 条），QQ 真源注入非法 URL（失败）→
    // 非法源 source_stats 记 0，Stub 候选保留，all_failed=false（其他源结果不受影响）。
    let sources: Vec<Box<dyn MusicSource>> = vec![
        Box::new(StubSource {
            id: MusicSourceId::Netease,
            candidates: vec![SongCandidate {
                source: MusicSourceId::Netease,
                id: "stub-1".to_string(),
                title: "晴天".to_string(),
                artist: "周杰伦".to_string(),
                album: String::new(),
                cover_url: None,
            }],
        }),
        Box::new(QqMusic {
            search_url: INVALID_URL.to_string(),
            ..QqMusic::default()
        }),
    ];
    let result = search_song_with_sources(
        &client(),
        "晴天",
        "周杰伦",
        "",
        sources,
        AGGREGATION_TIMEOUT,
    )
    .await;

    assert_eq!(
        stat(&result, MusicSourceId::QqMusic),
        0,
        "非法 URL 的 QQ 源在聚合中应记 0 条候选"
    );
    assert_eq!(
        stat(&result, MusicSourceId::Netease),
        1,
        "Stub 源成功返回的候选计数应保留"
    );
    assert!(
        result
            .songs
            .iter()
            .any(|s| s.source == MusicSourceId::Netease && s.id == "stub-1"),
        "Stub 源候选应保留在聚合结果中，实际: {:?}",
        result.songs
    );
    assert!(
        !result.all_failed,
        "至少一个源成功 → 不得标记全源失败（非法源失败不得拖垮其他源）"
    );
}

#[tokio::test]
async fn all_invalid_sources_set_all_failed() {
    // 四个带 `search_url` 的真源全部注入非法 URL：均按失败处理（未提供网易云时其槽位
    // 也按固定来源序计为失败）→ source_stats 全 0、无候选、all_failed=true，
    // 与网络失败同一失败分类（供前端会话离线降级）。
    let sources: Vec<Box<dyn MusicSource>> = vec![
        Box::new(QqMusic {
            search_url: INVALID_URL.to_string(),
            ..QqMusic::default()
        }),
        Box::new(Kugou {
            search_url: INVALID_URL.to_string(),
            ..Kugou::default()
        }),
        Box::new(Lrclib {
            search_url: INVALID_URL.to_string(),
            ..Lrclib::default()
        }),
        Box::new(Itunes {
            search_url: INVALID_URL.to_string(),
            ..Itunes::default()
        }),
    ];
    let result = search_song_with_sources(
        &client(),
        "晴天",
        "周杰伦",
        "",
        sources,
        AGGREGATION_TIMEOUT,
    )
    .await;

    assert!(
        result.source_stats.iter().all(|(_, count)| *count == 0),
        "全部源失败时 source_stats 应全 0，实际: {:?}",
        result.source_stats
    );
    assert!(
        result.songs.is_empty(),
        "全部源失败时不应产生候选，实际: {:?}",
        result.songs
    );
    assert!(
        result.all_failed,
        "四个真源全部非法 URL → all_failed 应为 true（与网络失败一致）"
    );
}
