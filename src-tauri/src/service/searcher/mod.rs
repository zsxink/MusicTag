// MusicTag — 五源（网易云 / QQ / 酷狗 / LRCLIB / iTunes）并发搜索 + 打分去重聚合 + 惰性拉取
// （design.md §10.4 / D1–D8，search-sources-renewal：三源 → 五源）。
//
// 纯业务层无 Tauri 依赖（service 分层不变量 §10.0）：函数接受 `&reqwest::Client` 参数，
// 可脱离 Tauri 直接单测；命令薄壳在 `commands/search.rs` 只做参数接收 + 委托。
// `search_song_with_sources`/`search_source_with`/`download_cover_with_timeout`/`to_halfwidth`/
// `title_match`/`artist_match`/`source_rank`/`TOP_N` 提 `pub`：rust-tests-separation 单测外置
// `tests/searcher_mod_tests.rs`（集成测试是独立 crate，仅 `pub` 可见；design.md 原 `pub(crate)`
// 方案经实测 E0603 不可行，改为 `pub`）。原 mock HTTP 工具迁 `tests/common/`。
//
// 数据流（design.md）：
// - `search_song(title, artist)`：`tokio::join_all`（JoinSet）五源并发 + 单源 6s 超时 →
//   失败降级空列表 + `source_stats`（该源记 0）→ `aggregate` 打分去重排序 → 前 10 条；
// - `fetch_lyric(source, id)`：点选歌词候选拉文本（None = 取词失败/无词，供 C2 换源；
//   iTunes 恒 None，不参与 C2 取词链）；
// - `download_cover(url)`：点选封面下载（5s 超时 + 12MB 响应体限流）。

pub mod crypto;
pub mod itunes;
pub mod kugou;
pub mod lrclib;
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
///
/// `pub`：供 `src-tauri/tests/searcher_mod_tests.rs` 断言 `search_source_with` 的 TOP_N 截断
/// （rust-tests-separation 单测外置；集成测试是独立 crate，仅 `pub` 可见）。
pub const TOP_N: usize = 10;

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
/// 各源在请求级覆盖 UA/Referer（网易云随机 / QQ / 酷狗 / LRCLIB 描述性 UA）。五源并发复用连接池。
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

/// `search_song(title, artist)`：五源并发搜索 + 打分去重（spec：单源 6s 超时，失败降级空列表）。
pub async fn search_song(client: &reqwest::Client, title: &str, artist: &str) -> SearchResult {
    let sources: Vec<Box<dyn MusicSource>> = vec![
        Box::new(netease::Netease::default()),
        Box::new(qqmusic::QqMusic::default()),
        Box::new(kugou::Kugou::default()),
        Box::new(lrclib::Lrclib::default()),
        Box::new(itunes::Itunes::default()),
    ];
    search_song_with_sources(client, title, artist, sources, SEARCH_TIMEOUT).await
}

/// 并发聚合（可注入源列表与超时，供超时降级单测）。
///
/// `JoinSet` 并行执行各源搜索，`tokio::time::timeout` 包单源超时；超时/失败 → 该源
/// `source_stats` 记 0（D8）+ 计为失败，其余源结果不受影响。
/// `all_failed` = 五源全部失败（无任何源成功）；至少一源成功（含正常空结果）→ false。
pub async fn search_song_with_sources(
    client: &reqwest::Client,
    title: &str,
    artist: &str,
    sources: Vec<Box<dyn MusicSource>>,
    timeout: Duration,
) -> SearchResult {
    let order = [
        MusicSourceId::Netease,
        MusicSourceId::QqMusic,
        MusicSourceId::Kugou,
        MusicSourceId::Lrclib,
        MusicSourceId::Itunes,
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

    // source_stats：固定来源顺序（Netease → QqMusic → Kugou → Lrclib → Itunes），记成功返回的候选条数（D8）。
    let source_stats: Vec<(MusicSourceId, usize)> = order
        .iter()
        .map(|id| {
            (
                *id,
                raw.get(id).and_then(|o| o.as_ref()).map_or(0, |l| l.len()),
            )
        })
        .collect();

    // all_failed：五源全部失败（None）→ true；至少一源成功 → false（冷门歌空结果不判离线）。
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
        MusicSourceId::Netease => Box::new(netease::Netease::default()),
        MusicSourceId::QqMusic => Box::new(qqmusic::QqMusic::default()),
        MusicSourceId::Kugou => Box::new(kugou::Kugou::default()),
        MusicSourceId::Lrclib => Box::new(lrclib::Lrclib::default()),
        MusicSourceId::Itunes => Box::new(itunes::Itunes::default()),
    };
    search_source_with(client, s, title, artist, SEARCH_TIMEOUT).await
}

/// 单源搜索实现（可注入源与超时，供单测复用 FakeSource）。失败/超时 → 空列表。
pub async fn search_source_with(
    client: &reqwest::Client,
    source: Box<dyn MusicSource>,
    title: &str,
    artist: &str,
    timeout: Duration,
) -> Vec<SongCandidate> {
    match tokio::time::timeout(timeout, source.search(client, title, artist)).await {
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
        MusicSourceId::Netease => Box::new(netease::Netease::default()),
        MusicSourceId::QqMusic => Box::new(qqmusic::QqMusic::default()),
        MusicSourceId::Kugou => Box::new(kugou::Kugou::default()),
        MusicSourceId::Lrclib => Box::new(lrclib::Lrclib::default()),
        MusicSourceId::Itunes => Box::new(itunes::Itunes::default()),
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
pub async fn download_cover_with_timeout(
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
pub fn title_match(q: &str, t: &str) -> f32 {
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
pub fn artist_match(q: &str, a: &str) -> f32 {
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
/// 归一化 `(title, artist)` 去重保留最高分（同分按 Netease→QqMusic→Kugou→Lrclib→Itunes 来源序）→
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

/// 来源顺序排名（Netease < QqMusic < Kugou < Lrclib < Itunes，search-sources-renewal D8：
/// 中文源前置、公共源垫底，同分去重/排序天然偏好中文平台）。
fn source_rank(source: MusicSourceId) -> usize {
    match source {
        MusicSourceId::Netease => 0,
        MusicSourceId::QqMusic => 1,
        MusicSourceId::Kugou => 2,
        MusicSourceId::Lrclib => 3,
        MusicSourceId::Itunes => 4,
    }
}

/// JSON 值转字符串（string / int / uint 兜底；酷狗 `FileHash`/取词候选 `id` 可能是数字）。
pub(crate) fn json_string(v: &serde_json::Value) -> Option<String> {
    v.as_str()
        .map(String::from)
        .or_else(|| v.as_i64().map(|n| n.to_string()))
        .or_else(|| v.as_u64().map(|n| n.to_string()))
}
