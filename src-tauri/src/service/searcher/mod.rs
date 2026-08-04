// MusicTag — 三源（网易云 / QQ / 咪咕）并发搜索 + 打分去重聚合 + 惰性拉取（design.md §10.4 / D1–D8）。
//
// 纯业务层无 Tauri 依赖（service 分层不变量 §10.0）：函数接受 `&reqwest::Client` 参数，
// 可脱离 Tauri 直接单测；命令薄壳在 `commands/search.rs` 只做参数接收 + 委托。
//
// 数据流（design.md）：
// - `search_song(title, artist)`：`tokio::join_all`（JoinSet）三源并发 + 单源 6s 超时 →
//   失败降级空列表 + `source_stats`（该源记 0）→ `aggregate` 打分去重排序 → 前 10 条；
// - `fetch_lyric(source, id)`：点选歌词候选拉文本（None = 取词失败/无词，供 C2 换源）；
// - `download_cover(url)`：点选封面下载（5s 超时 + 12MB 响应体限流）。

pub mod crypto;
pub mod migu;
pub mod netease;
pub mod qqmusic;

use crate::model::{MusicSourceId, SearchResult, SongCandidate};
use async_trait::async_trait;
use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::Duration;

/// 单源搜索超时（spec 冻结 6s）。
const SEARCH_TIMEOUT: Duration = Duration::from_secs(6);
/// 封面下载超时（spec 冻结 5s，design.md D2）。
const COVER_TIMEOUT: Duration = Duration::from_secs(5);
/// 封面响应体限流上限（12MB，design.md D2：Content-Length 预检 + 流式读取上限）。
const COVER_LIMIT: usize = 12 * 1024 * 1024;
/// 聚合返回候选上限（design.md D3：前 N = 10，控制 IPC 载荷）。
const TOP_N: usize = 10;

/// 统一搜索源接口（design.md D1：每家一个客户端，统一双接口）。
///
/// `search` 返回 `Result<Vec<SongCandidate>, String>`（v1-search-fixes）：`Err` = 网络/解析失败，
/// `Ok(vec)` = 成功（含空列表）。供聚合区分「全源失败」与「正常空结果」（`all_failed`）。
#[async_trait]
pub trait MusicSource: Send + Sync {
    fn id(&self) -> MusicSourceId;
    async fn search(
        &self,
        client: &reqwest::Client,
        title: &str,
        artist: &str,
    ) -> Result<Vec<SongCandidate>, String>;
    async fn fetch_lyric(&self, client: &reqwest::Client, id: &str) -> Option<String>;
}

/// 共享 HTTP Client（惰性构建一次，design.md D2）：默认浏览器 UA + 6s 总超时。
///
/// 各源在请求级覆盖 UA/Referer（网易云随机 / QQ / 咪咕）。三源并发复用连接池。
pub fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(SEARCH_TIMEOUT)
            .user_agent(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
                 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            )
            .build()
            .expect("构建共享 HTTP Client 失败")
    })
}

/// `search_song(title, artist)`：三源并发搜索 + 打分去重（spec：单源 6s 超时，失败降级空列表）。
pub async fn search_song(client: &reqwest::Client, title: &str, artist: &str) -> SearchResult {
    let sources: Vec<Box<dyn MusicSource>> = vec![
        Box::new(netease::Netease),
        Box::new(qqmusic::QqMusic),
        Box::new(migu::Migu),
    ];
    search_song_with_sources(client, title, artist, sources, SEARCH_TIMEOUT).await
}

/// 并发聚合（可注入源列表与超时，供超时降级单测）。
///
/// `JoinSet` 并行执行各源搜索，`tokio::time::timeout` 包单源超时；超时/失败 → 该源
/// `source_stats` 记 0（D8）+ 计为失败，其余源结果不受影响。
/// `all_failed` = 三源全部失败（无任何源成功）；至少一源成功（含正常空结果）→ false。
async fn search_song_with_sources(
    client: &reqwest::Client,
    title: &str,
    artist: &str,
    sources: Vec<Box<dyn MusicSource>>,
    timeout: Duration,
) -> SearchResult {
    let order = [
        MusicSourceId::Netease,
        MusicSourceId::QqMusic,
        MusicSourceId::Migu,
    ];
    let mut set = tokio::task::JoinSet::new();
    for source in sources {
        let client = client.clone();
        let title = title.to_string();
        let artist = artist.to_string();
        set.spawn(async move {
            let fut = source.search(&client, &title, &artist);
            match tokio::time::timeout(timeout, fut).await {
                Ok(Ok(list)) => (source.id(), Some(list)),
                _ => (source.id(), None), // 超时 / 网络 / 解析失败 → 失败
            }
        });
    }

    // 收集各源结果：成功 → Some(list)（含空列表），失败/超时 → None（v1-search-fixes）。
    // 先为固定来源序各占一位，保证任务异常缺失的源也按「失败」计入 all_failed。
    let mut raw: HashMap<MusicSourceId, Option<Vec<SongCandidate>>> =
        order.iter().map(|id| (*id, None)).collect();
    while let Some(joined) = set.join_next().await {
        if let Ok((id, list)) = joined {
            raw.insert(id, list);
        }
    }

    // source_stats：固定来源顺序（Netease → QqMusic → Migu），记成功返回的候选条数（D8）。
    let source_stats: Vec<(MusicSourceId, usize)> = order
        .iter()
        .map(|id| {
            (
                *id,
                raw.get(id).and_then(|o| o.as_ref()).map_or(0, |l| l.len()),
            )
        })
        .collect();

    // all_failed：三源全部失败（None）→ true；至少一源成功 → false（冷门歌空结果不判离线）。
    let all_failed = raw.values().all(|o| o.is_none());

    let all: Vec<SongCandidate> = raw
        .values()
        .flatten()
        .flat_map(|l| l.iter().cloned())
        .collect();
    let songs = aggregate(title, artist, all);
    SearchResult {
        songs,
        source_stats,
        all_failed,
    }
}

/// `search_source(source, title, artist) -> Vec<SongCandidate>`（v1-search-fixes）：单源搜索，C2 换源用。
///
/// 与 `search_song` 不同：**不做跨源聚合去重**——C2 需要「其他来源对同一首歌的候选」，
/// 聚合去重会把同曲多源候选折叠成一条（Netease 稳定胜出）导致换源找不到其他源。同一 6s
/// 超时；失败/超时 → 空列表（前端跳过该源）。返回该源原始候选（截前 N 条控制 IPC 载荷）。
pub async fn search_source(
    client: &reqwest::Client,
    source: MusicSourceId,
    title: &str,
    artist: &str,
) -> Vec<SongCandidate> {
    let s: Box<dyn MusicSource> = match source {
        MusicSourceId::Netease => Box::new(netease::Netease),
        MusicSourceId::QqMusic => Box::new(qqmusic::QqMusic),
        MusicSourceId::Migu => Box::new(migu::Migu),
    };
    match tokio::time::timeout(SEARCH_TIMEOUT, s.search(client, title, artist)).await {
        Ok(Ok(list)) => list.into_iter().take(TOP_N).collect(),
        _ => Vec::new(),
    }
}

/// `fetch_lyric(source, id) -> Option<String>`：None = 取词失败/无词（C2 换源支撑，spec）。
pub async fn fetch_lyric(
    client: &reqwest::Client,
    source: MusicSourceId,
    id: &str,
) -> Option<String> {
    let s: Box<dyn MusicSource> = match source {
        MusicSourceId::Netease => Box::new(netease::Netease),
        MusicSourceId::QqMusic => Box::new(qqmusic::QqMusic),
        MusicSourceId::Migu => Box::new(migu::Migu),
    };
    s.fetch_lyric(client, id).await
}

/// `download_cover(url) -> Result<Vec<u8>, String>`：请求级 5s 超时 + 响应体 12MB 限流。
///
/// 限流双保险（design.md D2）：`Content-Length > 12MB` 预检直接拒绝；流式读取设 12MB 上限
/// （防内存放大：服务器谎报/不报 Content-Length）。失败 → `Err(中文原因)`，前端静默忽略该张候选。
pub async fn download_cover(client: &reqwest::Client, url: &str) -> Result<Vec<u8>, String> {
    download_cover_with_timeout(client, url, COVER_TIMEOUT).await
}

/// 封面下载（可注入超时，供「挂起服务器 → 超时降级」单测，同 `search_song_with_sources` seam）。
async fn download_cover_with_timeout(
    client: &reqwest::Client,
    url: &str,
    timeout: Duration,
) -> Result<Vec<u8>, String> {
    let mut resp = client
        .get(url)
        .timeout(timeout)
        .send()
        .await
        .map_err(|e| format!("下载封面失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("下载封面失败: HTTP {}", resp.status().as_u16()));
    }
    if let Some(len) = resp.content_length() {
        if len > COVER_LIMIT as u64 {
            return Err("封面响应超过 12MB 限制".to_string());
        }
    }
    let mut buf = Vec::new();
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| format!("读取封面响应失败: {e}"))?
    {
        if buf.len() + chunk.len() > COVER_LIMIT {
            return Err("封面响应超过 12MB 限制".to_string());
        }
        buf.extend_from_slice(&chunk);
    }
    Ok(buf)
}

/// 归一化 `norm(s)`：trim + 全角转半角 + `to_lowercase`（V1 不做简繁，design.md D3）。
pub fn norm(s: &str) -> String {
    s.trim()
        .chars()
        .map(to_halfwidth)
        .flat_map(char::to_lowercase)
        .collect()
}

/// 全角转半角：`\u{FF01}..=\u{FF5E}` → 对应 ASCII；全角空格 `\u{3000}` → 半角空格。
fn to_halfwidth(c: char) -> char {
    match c {
        '\u{3000}' => ' ',
        '\u{FF01}'..='\u{FF5E}' => char::from_u32(c as u32 - 0xFEE0).unwrap_or(c),
        _ => c,
    }
}

/// `title_match(q, t)`（均已归一化）：相等 0.5 / 互相包含 0.2 / 否则 0（spec 权重，design.md D3）。
///
/// 空查询 / 空候选 title 不给分（防空串互相包含的退化命中，与 `artist_match` 对称；
/// 裸文件无 title 标签时查询串为空，不得让所有候选统一得 0.2 分）。
fn title_match(q: &str, t: &str) -> f32 {
    if q.is_empty() || t.is_empty() {
        return 0.0;
    }
    if q == t {
        0.5
    } else if q.contains(t) || t.contains(q) {
        0.2
    } else {
        0.0
    }
}

/// `artist_match(q, a)`（均已归一化）：相等 0.4 / 互相包含 0.1 / 否则 0。
///
/// 候选 artist 含 `,`/`/`（多艺人）→ 对每段分别打分取 **max**（保持权重上限，不求和溢出）。
/// 空查询 / 空候选 artist 不给分（防空串互相包含的退化命中；spec 未定义不自行加项）。
fn artist_match(q: &str, a: &str) -> f32 {
    if q.is_empty() || a.is_empty() {
        return 0.0;
    }
    a.split(['/', ','])
        .map(|seg| seg.trim())
        .filter(|seg| !seg.is_empty())
        .map(|seg| {
            if q == seg {
                0.4
            } else if seg.contains(q) || q.contains(seg) {
                0.1
            } else {
                0.0
            }
        })
        .fold(0.0_f32, f32::max)
}

/// 打分聚合（design.md D3）：过滤 title 零关联 → 打分（title + artist，上限 0.9）→
/// 归一化 `(title, artist)` 去重保留最高分（同分按 Netease→QqMusic→Migu 来源序）→
/// score 降序（同分来源序 + 归一化 title/artist 稳定）→ 前 10 条。
pub fn aggregate(
    query_title: &str,
    query_artist: &str,
    candidates: Vec<SongCandidate>,
) -> Vec<SongCandidate> {
    let qn = norm(query_title);
    let qa = norm(query_artist);

    // 打分 + 过滤 `title_match == 0`（与查询 title 零关联不进候选集，避免噪音）。
    let scored: Vec<(f32, SongCandidate)> = candidates
        .into_iter()
        .filter_map(|c| {
            let t = norm(&c.title);
            let tm = title_match(&qn, &t);
            if tm == 0.0 {
                return None;
            }
            let am = artist_match(&qa, &norm(&c.artist));
            Some((tm + am, c))
        })
        .collect();

    // 去重：归一化 (title, artist) 分组，保留最高分；同分保留来源序更早的一条。
    let mut best: HashMap<(String, String), (f32, usize, SongCandidate)> = HashMap::new();
    for (score, c) in scored {
        let key = (norm(&c.title), norm(&c.artist));
        let rank = source_rank(c.source);
        match best.get_mut(&key) {
            Some(entry) => {
                if score > entry.0 || (score == entry.0 && rank < entry.1) {
                    *entry = (score, rank, c);
                }
            }
            None => {
                best.insert(key, (score, rank, c));
            }
        }
    }

    // score 降序；同分按来源序 → 归一化 title/artist（可复现稳定序）。
    let mut songs: Vec<(f32, SongCandidate)> = best.into_values().map(|(s, _, c)| (s, c)).collect();
    songs.sort_by(|a, b| {
        b.0.partial_cmp(&a.0)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| source_rank(a.1.source).cmp(&source_rank(b.1.source)))
            .then_with(|| norm(&a.1.title).cmp(&norm(&b.1.title)))
            .then_with(|| norm(&a.1.artist).cmp(&norm(&b.1.artist)))
    });
    songs.truncate(TOP_N);
    songs.into_iter().map(|(_, c)| c).collect()
}

/// 来源顺序排名（Netease < QqMusic < Migu，用于同分稳定序）。
fn source_rank(source: MusicSourceId) -> usize {
    match source {
        MusicSourceId::Netease => 0,
        MusicSourceId::QqMusic => 1,
        MusicSourceId::Migu => 2,
    }
}

/// JSON 值转字符串（string / int / uint 兜底；咪咕 `copyrightId` 可能是数字）。
pub(crate) fn json_string(v: &serde_json::Value) -> Option<String> {
    v.as_str()
        .map(String::from)
        .or_else(|| v.as_i64().map(|n| n.to_string()))
        .or_else(|| v.as_u64().map(|n| n.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    fn cand(source: MusicSourceId, id: &str, title: &str, artist: &str) -> SongCandidate {
        SongCandidate {
            source,
            id: id.to_string(),
            title: title.to_string(),
            artist: artist.to_string(),
            album: String::new(),
            cover_url: None,
        }
    }

    // ---- 归一化 ----

    #[test]
    fn norm_trims_fullwidth_and_lowercases() {
        assert_eq!(norm(" 晴天 "), "晴天");
        assert_eq!(norm("ＨＥＬＬＯ　ＷＯＲＬＤ"), "hello world");
        assert_eq!(norm("  AbC　１２３ "), "abc 123");
        // 半角已保序；简繁不转换（V1 不做）
        assert_eq!(norm("晴天"), "晴天");
    }

    // ---- 打分权重 ----

    #[test]
    fn title_match_weights() {
        assert_eq!(title_match("晴天", "晴天"), 0.5, "title 相等 0.5");
        assert_eq!(title_match("晴天", "晴天娃娃"), 0.2, "t⊆q 互相包含 0.2");
        assert_eq!(title_match("晴天娃娃", "晴天"), 0.2, "q⊆t 互相包含 0.2");
        assert_eq!(title_match("晴天", "雨天"), 0.0, "零关联 0");
        // 空查询/空候选 title 不给分（防退化命中，与 artist_match 对称）
        assert_eq!(title_match("", "晴天"), 0.0, "空查询不得退化命中");
        assert_eq!(title_match("晴天", ""), 0.0, "空候选 title 不得命中");
        assert_eq!(title_match("", ""), 0.0);
    }

    #[test]
    fn aggregate_filters_everything_on_empty_title_query() {
        // 空 title 查询（裸文件无标签）→ 任何候选 title 都「包含空串」若不加守卫全得 0.2；
        // 空守卫下 title_match==0 → 全部过滤，返回空而非噪声候选。
        let songs = aggregate(
            "",
            "周杰伦",
            vec![cand(MusicSourceId::Netease, "1", "晴天", "周杰伦")],
        );
        assert!(songs.is_empty(), "空 title 查询不得退化命中所有候选");
    }

    #[test]
    fn artist_match_weights_and_multi_artist_max() {
        assert_eq!(artist_match("周杰伦", "周杰伦"), 0.4, "artist 相等 0.4");
        assert_eq!(
            artist_match("周杰伦", "周杰伦/李健"),
            0.4,
            "多艺人分段取 max"
        );
        assert_eq!(artist_match("周杰伦", "李健,王力宏"), 0.0, "无关联 0");
        assert_eq!(
            artist_match("周杰伦", "王力宏,周杰伦"),
            0.4,
            "多艺人含查询 → 0.4"
        );
        assert_eq!(artist_match("杰伦", "周杰伦"), 0.1, "互相包含 0.1");
        // 空查询/空候选不给分（防退化命中）
        assert_eq!(artist_match("", "周杰伦"), 0.0);
        assert_eq!(artist_match("周杰伦", ""), 0.0);
        assert_eq!(artist_match("", ""), 0.0);
    }

    #[test]
    fn aggregate_filters_zero_title_match() {
        // title 零关联（不含查询词）→ 过滤（spec：title_match==0 不进候选集）
        let songs = aggregate(
            "晴天",
            "周杰伦",
            vec![cand(MusicSourceId::Netease, "1", "海阔天空", "Beyond")],
        );
        assert!(songs.is_empty(), "title_match==0 的候选应被过滤");
    }

    #[test]
    fn aggregate_scores_and_sorts_desc() {
        let songs = aggregate(
            "晴天",
            "周杰伦",
            vec![
                cand(MusicSourceId::Netease, "1", "晴天", "周杰伦"), // 0.5 + 0.4 = 0.9
                cand(MusicSourceId::Netease, "2", "晴天娃娃", "周杰伦"), // 0.2 + 0.4 = 0.6
                cand(MusicSourceId::Netease, "3", "晴天", "周杰伦/李健"), // 0.5 + 分段 max 0.4 = 0.9
                cand(MusicSourceId::Netease, "4", "雨天", "周杰伦"),      // 0.0 → 过滤
            ],
        );
        assert_eq!(songs.len(), 3);
        // 降序：0.9 → 0.9 → 0.6；0.9 同分按 artist 归一化稳定（"周杰伦" < "周杰伦/李健"）
        assert_eq!(songs[0].id, "1");
        assert_eq!(songs[1].id, "3");
        assert_eq!(songs[2].id, "2");
    }

    #[test]
    fn aggregate_dedup_keeps_earliest_source_on_tie() {
        // 同一归一化 (title, artist) 三家都返回 → 同分保留来源序更早（Netease）
        let songs = aggregate(
            "晴天",
            "周杰伦",
            vec![
                cand(MusicSourceId::Migu, "m", "晴天", "周杰伦"),
                cand(MusicSourceId::Netease, "n", "晴天", "周杰伦"),
                cand(MusicSourceId::QqMusic, "q", "晴天", "周杰伦"),
            ],
        );
        assert_eq!(songs.len(), 1);
        assert_eq!(songs[0].id, "n");
        assert_eq!(songs[0].source, MusicSourceId::Netease);
    }

    #[test]
    fn aggregate_limits_to_top_ten() {
        // 15 个不同 title 的候选（title 均包含查询词）→ 前 N=10
        let cands: Vec<SongCandidate> = (1..=15)
            .map(|i| {
                cand(
                    MusicSourceId::Netease,
                    &i.to_string(),
                    &format!("晴天{i}"),
                    "周杰伦",
                )
            })
            .collect();
        let songs = aggregate("晴天", "周杰伦", cands);
        assert_eq!(songs.len(), 10, "应只返回前 10 条");
    }

    #[test]
    fn aggregate_normalizes_fullwidth_query() {
        // 全角查询「ＡＢＣ」→ 归一化 "abc" 匹配候选 "abc"（全角转半角 + 小写）
        let songs = aggregate(
            "ＡＢＣ",
            "Ａ",
            vec![cand(MusicSourceId::Netease, "1", "abc", "a")],
        );
        assert_eq!(songs.len(), 1);
        assert_eq!(songs[0].id, "1");
    }

    // ---- 并发聚合 + 超时降级 ----

    /// 测试用假源：可注入「立即返回」「挂起」（挂起由注入的短超时切断）或「失败」（Err）。
    #[derive(Clone)]
    enum FakeBehavior {
        Return(Vec<SongCandidate>),
        Hang,
        Fail,
    }

    #[derive(Clone)]
    struct FakeSource {
        id: MusicSourceId,
        behavior: FakeBehavior,
    }

    #[async_trait]
    impl MusicSource for FakeSource {
        fn id(&self) -> MusicSourceId {
            self.id
        }
        async fn search(
            &self,
            _client: &reqwest::Client,
            _title: &str,
            _artist: &str,
        ) -> Result<Vec<SongCandidate>, String> {
            match &self.behavior {
                FakeBehavior::Return(list) => Ok(list.clone()),
                FakeBehavior::Hang => {
                    tokio::time::sleep(Duration::from_secs(3600)).await;
                    Ok(Vec::new())
                }
                FakeBehavior::Fail => Err("fake 源失败".into()),
            }
        }
        async fn fetch_lyric(&self, _client: &reqwest::Client, _id: &str) -> Option<String> {
            None
        }
    }

    #[tokio::test]
    async fn search_aggregates_three_sources_and_stats() {
        let client = reqwest::Client::new();
        let sources: Vec<Box<dyn MusicSource>> = vec![
            Box::new(FakeSource {
                id: MusicSourceId::Netease,
                behavior: FakeBehavior::Return(vec![cand(
                    MusicSourceId::Netease,
                    "1",
                    "晴天",
                    "周杰伦",
                )]),
            }),
            Box::new(FakeSource {
                id: MusicSourceId::QqMusic,
                behavior: FakeBehavior::Return(vec![
                    cand(MusicSourceId::QqMusic, "2", "晴天", "周杰伦"),
                    cand(MusicSourceId::QqMusic, "3", "晴天娃娃", "周杰伦"),
                ]),
            }),
            Box::new(FakeSource {
                id: MusicSourceId::Migu,
                behavior: FakeBehavior::Return(vec![cand(
                    MusicSourceId::Migu,
                    "4",
                    "晴天",
                    "周杰伦",
                )]),
            }),
        ];
        let result =
            search_song_with_sources(&client, "晴天", "周杰伦", sources, Duration::from_secs(1))
                .await;
        // source_stats：各家成功返回的候选条数（固定来源序）
        assert_eq!(
            result.source_stats,
            vec![
                (MusicSourceId::Netease, 1),
                (MusicSourceId::QqMusic, 2),
                (MusicSourceId::Migu, 1),
            ]
        );
        // 去重：「晴天/周杰伦」三家各一条 → 只留来源序最早的 Netease；「晴天娃娃」另算
        assert_eq!(result.songs.len(), 2);
        assert_eq!(result.songs[0].id, "1");
        assert_eq!(result.songs[1].id, "3");
        assert!(!result.songs.iter().any(|s| s.source == MusicSourceId::Migu));
        assert!(!result.all_failed, "三源均成功 → 非离线");
    }

    #[tokio::test]
    async fn search_timeout_degrades_hanging_source_to_zero() {
        // 单源 6s 超时语义：挂起源降级空列表 + source_stats 记 0，其余源结果不受影响。
        // 测试注入 50ms 超时（不等真实 6s），FakeBehavior::Hang 睡 1h 由 timeout 切断。
        let client = reqwest::Client::new();
        let sources: Vec<Box<dyn MusicSource>> = vec![
            Box::new(FakeSource {
                id: MusicSourceId::Netease,
                behavior: FakeBehavior::Hang,
            }),
            Box::new(FakeSource {
                id: MusicSourceId::QqMusic,
                behavior: FakeBehavior::Return(vec![cand(
                    MusicSourceId::QqMusic,
                    "2",
                    "晴天",
                    "周杰伦",
                )]),
            }),
            Box::new(FakeSource {
                id: MusicSourceId::Migu,
                behavior: FakeBehavior::Hang,
            }),
        ];
        let result = search_song_with_sources(
            &client,
            "晴天",
            "周杰伦",
            sources,
            Duration::from_millis(50),
        )
        .await;
        assert_eq!(
            result.source_stats,
            vec![
                (MusicSourceId::Netease, 0),
                (MusicSourceId::QqMusic, 1),
                (MusicSourceId::Migu, 0),
            ]
        );
        assert_eq!(result.songs.len(), 1, "其余源结果不受影响");
        assert!(!result.all_failed, "qq 源成功 → 非离线");
    }

    #[tokio::test]
    async fn search_all_fail_returns_empty_and_zero_stats() {
        // 全源失败（断网/超时）→ 空候选 + source_stats 全 0 + all_failed=true（供前端离线判定）
        let client = reqwest::Client::new();
        let sources: Vec<Box<dyn MusicSource>> = vec![
            Box::new(FakeSource {
                id: MusicSourceId::Netease,
                behavior: FakeBehavior::Hang,
            }),
            Box::new(FakeSource {
                id: MusicSourceId::QqMusic,
                behavior: FakeBehavior::Fail,
            }),
            Box::new(FakeSource {
                id: MusicSourceId::Migu,
                behavior: FakeBehavior::Hang,
            }),
        ];
        let result = search_song_with_sources(
            &client,
            "晴天",
            "周杰伦",
            sources,
            Duration::from_millis(50),
        )
        .await;
        assert!(result.songs.is_empty());
        assert_eq!(
            result.source_stats.iter().map(|(_, n)| *n).sum::<usize>(),
            0
        );
        assert!(result.all_failed, "三源全失败 → 离线信号");
    }

    #[tokio::test]
    async fn search_all_succeed_empty_not_offline() {
        // v1-search-fixes（C2/离线误判）：三源**成功但空**（冷门歌无匹配）→ all_failed=false，
        // 不触发会话离线（FR-8.4a「全部源失败」指网络失败，非正常空结果）。
        let client = reqwest::Client::new();
        let sources: Vec<Box<dyn MusicSource>> = vec![
            Box::new(FakeSource {
                id: MusicSourceId::Netease,
                behavior: FakeBehavior::Return(vec![]),
            }),
            Box::new(FakeSource {
                id: MusicSourceId::QqMusic,
                behavior: FakeBehavior::Return(vec![]),
            }),
            Box::new(FakeSource {
                id: MusicSourceId::Migu,
                behavior: FakeBehavior::Return(vec![]),
            }),
        ];
        let result = search_song_with_sources(
            &client,
            "冷门曲",
            "某作者",
            sources,
            Duration::from_millis(50),
        )
        .await;
        assert!(result.songs.is_empty());
        assert_eq!(
            result.source_stats,
            vec![
                (MusicSourceId::Netease, 0),
                (MusicSourceId::QqMusic, 0),
                (MusicSourceId::Migu, 0),
            ]
        );
        assert!(!result.all_failed, "正常空结果不得标记离线");
    }

    #[tokio::test]
    async fn search_mixed_fail_and_empty_not_offline() {
        // 部分源失败、部分源成功空 → 网络可用 → 非离线（all_failed=false）。
        let client = reqwest::Client::new();
        let sources: Vec<Box<dyn MusicSource>> = vec![
            Box::new(FakeSource {
                id: MusicSourceId::Netease,
                behavior: FakeBehavior::Fail,
            }),
            Box::new(FakeSource {
                id: MusicSourceId::QqMusic,
                behavior: FakeBehavior::Return(vec![]),
            }),
            Box::new(FakeSource {
                id: MusicSourceId::Migu,
                behavior: FakeBehavior::Fail,
            }),
        ];
        let result = search_song_with_sources(
            &client,
            "晴天",
            "周杰伦",
            sources,
            Duration::from_millis(50),
        )
        .await;
        assert!(!result.all_failed, "至少一源成功（qq）→ 非离线");
    }

    // ---- download_cover：5s 超时 + 12MB 限流 ----

    /// 启动极简 HTTP 服务器：对每个连接读请求头后写回 `response` 字节，处理一个请求后关闭。
    fn mock_http_once(response: Vec<u8>) -> String {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("绑定本地端口");
        let addr = listener.local_addr().expect("取本地端口");
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut s) = stream else { continue };
                let mut buf = [0u8; 4096];
                let _ = s.read(&mut buf);
                let _ = s.write_all(&response);
                let _ = s.flush();
                break;
            }
        });
        format!("http://{addr}")
    }

    #[tokio::test]
    async fn download_cover_success_returns_bytes() {
        let body = b"\x89PNG\r\n\x1a\ncover bytes".to_vec();
        let mut response =
            format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n", body.len()).into_bytes();
        response.extend_from_slice(&body);
        let url = mock_http_once(response);
        let client = reqwest::Client::new();
        let bytes = download_cover(&client, &url).await.expect("应成功下载");
        assert_eq!(bytes, body);
    }

    #[tokio::test]
    async fn download_cover_rejects_content_length_over_12mb() {
        // Content-Length 预检：>12MB 直接拒绝（不读响应体）
        let response = b"HTTP/1.1 200 OK\r\nContent-Length: 13000000\r\n\r\n".to_vec();
        let url = mock_http_once(response);
        let client = reqwest::Client::new();
        let err = download_cover(&client, &url).await.unwrap_err();
        assert!(
            err.contains("12MB"),
            "Content-Length 超限应拒绝，实际: {err}"
        );
    }

    #[tokio::test]
    async fn download_cover_streaming_cap_rejects_over_12mb() {
        // 流式上限：不报 Content-Length（chunked）但流式超过 12MB → 拒绝（防内存放大）。
        // 构造 13MB chunked 响应（1MB/块），客户端累计到 >12MB 即 Err。
        let mut response = b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n".to_vec();
        for _ in 0..13 {
            response.extend_from_slice(b"100000\r\n");
            response.extend(std::iter::repeat_n(b'x', 1024 * 1024));
            response.extend_from_slice(b"\r\n");
        }
        response.extend_from_slice(b"0\r\n\r\n");
        let url = mock_http_once(response);
        let client = reqwest::Client::new();
        let err = download_cover(&client, &url).await.unwrap_err();
        assert!(err.contains("12MB"), "流式超限应拒绝，实际: {err}");
    }

    #[tokio::test]
    async fn download_cover_times_out_on_hanging_server() {
        // 请求级超时（spec：封面下载单独 5s；测试注入 50ms，不等真实 5s）：
        // 服务器接受连接但挂起不返回 → reqwest 请求级 timeout 切断 → Err（前端静默忽略该张候选）。
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("绑定本地端口");
        let addr = listener.local_addr().expect("取本地端口");
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(_s) = stream else { continue };
                // 读到请求后挂起连接（不写响应），由客户端 timeout 切断。
                std::thread::sleep(Duration::from_secs(3600));
                break;
            }
        });
        let url = format!("http://{addr}");
        let client = reqwest::Client::new();
        let started = std::time::Instant::now();
        let err = download_cover_with_timeout(&client, &url, Duration::from_millis(50))
            .await
            .unwrap_err();
        assert!(
            err.contains("下载封面失败"),
            "挂起服务器应超时报错，实际: {err}"
        );
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "应 50ms 超时即返回，不应等真实 5s/更长"
        );
    }

    #[tokio::test]
    async fn download_cover_rejects_non_success_status() {
        let response = b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n".to_vec();
        let url = mock_http_once(response);
        let client = reqwest::Client::new();
        let err = download_cover(&client, &url).await.unwrap_err();
        assert!(err.contains("404"), "非 2xx 应报 HTTP 状态，实际: {err}");
    }
}
