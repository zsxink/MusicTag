// MusicTag — `service/searcher/mod.rs` 五源并发搜索聚合 + 惰性拉取单测（rust-tests-separation 外置）。
//
// 原 `#[cfg(test)] mod tests` + `test_util` 内嵌块整体迁出（production `src/` 零 `#[cfg(test)]`）。
// 覆盖 design.md D1–D8 / D2：
// - `norm`/`title_match`/`artist_match` 归一化与打分权重（空串防退化命中、多艺人分段取 max）；
// - `aggregate` 过滤零关联 → 打分 → 同源去重（保留该源最高分）、跨源不折叠 → 每源 TOP 3 →
//   按来源分组（Netease→QqMusic→Kugou→Lrclib→Itunes）、组内分降序（多源候选展示）；
// - `search_song_with_sources` 并发聚合 + 超时降级（FakeSource 注入 Hang/Fail/Return）；
//   `search_source_with` 单源原始候选（TOP_N 截断，不做聚合去重折叠）；
// - `download_cover*` 5s 超时 + 12MB 限流（Content-Length 预检 + 流式上限）。
// `mock_http_once` 用 `tests/common` 共享工具；fake 源/cand helper 为测试专用，复制进本文件。

mod common;

use app_lib::model::{MusicSourceId, SongCandidate};
use app_lib::service::searcher::{
    MusicSource, PER_SOURCE_TOP, TOP_N, aggregate, album_match, artist_match, download_cover,
    download_cover_with_timeout, join_query_terms, norm, search_song_with_sources,
    search_source_with, title_match,
};
use async_trait::async_trait;
use common::mock_http_once;
use std::sync::{Arc, Mutex};
use std::time::Duration;

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

/// 带 album 的候选构造（search-cover-album：aggregate 专辑打分断言用）。
fn cand_album(
    source: MusicSourceId,
    id: &str,
    title: &str,
    artist: &str,
    album: &str,
) -> SongCandidate {
    SongCandidate {
        source,
        id: id.to_string(),
        title: title.to_string(),
        artist: artist.to_string(),
        album: album.to_string(),
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
        "",
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
        "",
        vec![cand(MusicSourceId::Netease, "1", "海阔天空", "Beyond")],
    );
    assert!(songs.is_empty(), "title_match==0 的候选应被过滤");
}

#[test]
fn aggregate_scores_and_sorts_desc() {
    let songs = aggregate(
        "晴天",
        "周杰伦",
        "",
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
fn aggregate_keeps_each_source_on_same_song() {
    // 同一归一化 (title, artist) 多源都返回 → 跨源不折叠，三源各自保留、按来源分组序
    // （Netease → QqMusic → Kugou），不再同分只留来源序最早的一条。
    let songs = aggregate(
        "晴天",
        "周杰伦",
        "",
        vec![
            cand(MusicSourceId::Kugou, "k", "晴天", "周杰伦"),
            cand(MusicSourceId::Netease, "n", "晴天", "周杰伦"),
            cand(MusicSourceId::QqMusic, "q", "晴天", "周杰伦"),
        ],
    );
    assert_eq!(songs.len(), 3, "跨源不折叠：三源各自保留");
    assert_eq!(songs[0].id, "n");
    assert_eq!(songs[0].source, MusicSourceId::Netease);
    assert_eq!(songs[1].id, "q");
    assert_eq!(songs[1].source, MusicSourceId::QqMusic);
    assert_eq!(songs[2].id, "k");
    assert_eq!(songs[2].source, MusicSourceId::Kugou);
}

#[test]
fn aggregate_keeps_all_five_sources_on_same_score() {
    // 跨源保留：五家全给同曲同分 → 不再按来源序只留 Netease，而是五条全部保留、
    // 按来源分组序 Netease(0)→QqMusic(1)→Kugou(2)→Lrclib(3)→Itunes(4) 展示。
    let five = vec![
        cand(MusicSourceId::Netease, "n", "晴天", "周杰伦"),
        cand(MusicSourceId::QqMusic, "q", "晴天", "周杰伦"),
        cand(MusicSourceId::Kugou, "k", "晴天", "周杰伦"),
        cand(MusicSourceId::Lrclib, "l", "晴天", "周杰伦"),
        cand(MusicSourceId::Itunes, "i", "晴天", "周杰伦"),
    ];
    let songs = aggregate("晴天", "周杰伦", "", five);
    assert_eq!(songs.len(), 5, "跨源不折叠：五条全部保留");
    assert_eq!(songs[0].source, MusicSourceId::Netease);
    assert_eq!(songs[0].id, "n");
    assert_eq!(songs[1].source, MusicSourceId::QqMusic);
    assert_eq!(songs[1].id, "q");
    assert_eq!(songs[2].source, MusicSourceId::Kugou);
    assert_eq!(songs[2].id, "k");
    assert_eq!(songs[3].source, MusicSourceId::Lrclib);
    assert_eq!(songs[3].id, "l");
    assert_eq!(songs[4].source, MusicSourceId::Itunes);
    assert_eq!(songs[4].id, "i");

    // 仅 Lrclib 与 Itunes 同曲 → 两条各自保留（不再按 rank 3<4 折叠成 Lrclib）
    let pub_only = vec![
        cand(MusicSourceId::Lrclib, "l", "晴天", "周杰伦"),
        cand(MusicSourceId::Itunes, "i", "晴天", "周杰伦"),
    ];
    let songs = aggregate("晴天", "周杰伦", "", pub_only);
    assert_eq!(songs.len(), 2, "跨源不折叠：两源各自保留");
    assert_eq!(songs[0].source, MusicSourceId::Lrclib);
    assert_eq!(songs[0].id, "l");
    assert_eq!(songs[1].source, MusicSourceId::Itunes);
    assert_eq!(songs[1].id, "i");
}

#[test]
fn aggregate_limits_per_source_to_top_three() {
    // 每源 TOP 3：单源 15 个不同 title 的候选（title 均包含查询词）→ 该源只保留 TOP 3，
    // 不再全局截断到 TOP_N=10（aggregate 内已无全局截断；TOP_N 只服务单源 search_source）。
    let cands: Vec<SongCandidate> = (1..=15)
        .map(|i| {
            cand(
                MusicSourceId::Netease,
                &i.to_string(),
                &format!("晴天{i:02}"),
                "周杰伦",
            )
        })
        .collect();
    let songs = aggregate("晴天", "周杰伦", "", cands);
    assert_eq!(songs.len(), PER_SOURCE_TOP, "每源只保留 TOP 3");
    // 组内同分按归一化 title 稳定序（零填充保证 01 < 02 < 03）：晴天01 → 晴天02 → 晴天03
    assert_eq!(songs[0].id, "1");
    assert_eq!(songs[1].id, "2");
    assert_eq!(songs[2].id, "3");
}

#[test]
fn aggregate_normalizes_fullwidth_query() {
    // 全角查询「ＡＢＣ」→ 归一化 "abc" 匹配候选 "abc"（全角转半角 + 小写）
    let songs = aggregate(
        "ＡＢＣ",
        "Ａ",
        "",
        vec![cand(MusicSourceId::Netease, "1", "abc", "a")],
    );
    assert_eq!(songs.len(), 1);
    assert_eq!(songs[0].id, "1");
}

#[test]
fn aggregate_dedups_same_source_keeps_highest_score() {
    // 同源去重：同一来源、同一归一化 (title, artist) 的两个版本（album 不同 → 分不同）
    // → 只保留该源得分最高一条；另一来源返回同曲 → 跨源不折叠、各自保留。
    let songs = aggregate(
        "晴天",
        "周杰伦",
        "叶惠美",
        vec![
            cand_album(MusicSourceId::Netease, "1", "晴天", "周杰伦", "依然范特西"), // 0.9
            cand_album(MusicSourceId::Netease, "2", "晴天", "周杰伦", "叶惠美"), // 1.2（album 匹配）
            cand(MusicSourceId::QqMusic, "q", "晴天", "周杰伦"), // 0.9，跨源保留
        ],
    );
    assert_eq!(songs.len(), 2, "同源折叠为 1 条 + 跨源 QQ 1 条 = 2 条");
    assert_eq!(songs[0].id, "2", "同源同曲保留得分最高（album 匹配）那条");
    assert_eq!(songs[0].source, MusicSourceId::Netease);
    assert_eq!(songs[1].id, "q", "跨源不折叠，QQ 各自保留");
    assert_eq!(songs[1].source, MusicSourceId::QqMusic);
}

#[test]
fn aggregate_limits_each_source_to_top_three() {
    // 每源 TOP 3 + 来源分组：两源各 5 条不同 title → 每源只留 3 条、共 6 条，
    // 全部 Netease 组在前、QqMusic 组在后（跨源不折叠、来源分组拼接）。
    let netease: Vec<SongCandidate> = (1..=5)
        .map(|i| {
            cand(
                MusicSourceId::Netease,
                &format!("n{i}"),
                &format!("晴天{i}"),
                "周杰伦",
            )
        })
        .collect();
    let qq: Vec<SongCandidate> = (1..=5)
        .map(|i| {
            cand(
                MusicSourceId::QqMusic,
                &format!("q{i}"),
                &format!("晴天{i}"),
                "周杰伦",
            )
        })
        .collect();
    let mut all = netease;
    all.extend(qq);
    let songs = aggregate("晴天", "周杰伦", "", all);
    assert_eq!(songs.len(), PER_SOURCE_TOP * 2, "两源各 TOP 3，共 6 条");
    let sources: Vec<MusicSourceId> = songs.iter().map(|s| s.source).collect();
    assert_eq!(
        sources,
        vec![
            MusicSourceId::Netease,
            MusicSourceId::Netease,
            MusicSourceId::Netease,
            MusicSourceId::QqMusic,
            MusicSourceId::QqMusic,
            MusicSourceId::QqMusic,
        ],
        "按来源分组：Netease 3 条在前、QqMusic 3 条在后"
    );
}

#[test]
fn aggregate_groups_by_source_then_score_desc() {
    // 来源分组 + 组内分降序：Netease 组在前（0.9），QqMusic 组内 0.9 在 0.6 前，
    // Itunes 组垫底——跨源不按 score 混排，先按来源分组、组内再分降序。
    let songs = aggregate(
        "晴天",
        "周杰伦",
        "",
        vec![
            cand(MusicSourceId::QqMusic, "q2", "晴天娃娃", "周杰伦"), // 0.6
            cand(MusicSourceId::Netease, "n1", "晴天", "周杰伦"), // 0.9
            cand(MusicSourceId::QqMusic, "q1", "晴天", "周杰伦"), // 0.9
            cand(MusicSourceId::Itunes, "i1", "晴天", "周杰伦"), // 0.9
        ],
    );
    assert_eq!(songs.len(), 4);
    assert_eq!(songs[0].id, "n1", "Netease 组在前");
    assert_eq!(songs[1].id, "q1", "QqMusic 组内 0.9 在 0.6 前");
    assert_eq!(songs[2].id, "q2", "QqMusic 组内 0.6 在后");
    assert_eq!(songs[3].id, "i1", "Itunes 组在最后");
}

#[test]
fn aggregate_stable_within_group_by_norm_title_artist() {
    // 同分组同分 → 按归一化 title/artist 稳定序（可复现，不依赖 HashMap 迭代序）。
    // 同 QqMusic 组：0.9（晴天）在前；两个 0.6（"晴天mv" < "晴天娃娃"）按归一化 title 排。
    let songs = aggregate(
        "晴天",
        "周杰伦",
        "",
        vec![
            cand(MusicSourceId::QqMusic, "q3", "晴天娃娃", "周杰伦"), // 0.2+0.4=0.6
            cand(MusicSourceId::QqMusic, "q1", "晴天", "周杰伦"), // 0.5+0.4=0.9
            cand(MusicSourceId::QqMusic, "q2", "晴天mv", "周杰伦"), // 0.2+0.4=0.6
        ],
    );
    assert_eq!(songs.len(), 3);
    assert_eq!(songs[0].id, "q1", "组内分降序 0.9 在最前");
    assert_eq!(songs[1].id, "q2", "同分按归一化 title 稳定序（晴天mv < 晴天娃娃）");
    assert_eq!(songs[2].id, "q3");
}

// ---- 查询关键词拼接（search-cover-album D2）----

#[test]
fn join_query_terms_combines_non_empty_segments() {
    // 三字段齐全 → 段间单空格
    assert_eq!(
        join_query_terms("晴天", "周杰伦", "叶惠美"),
        "晴天 周杰伦 叶惠美"
    );
    // album 为空 → 回退 title + artist（不改动无专辑文件搜索路径）
    assert_eq!(join_query_terms("晴天", "周杰伦", ""), "晴天 周杰伦");
    // artist 为空 → 仅 title
    assert_eq!(join_query_terms("晴天", "", ""), "晴天");
    // 全空 → 空串（后端过滤不搜，spec「字段缺失回退」）
    assert_eq!(join_query_terms("", "", ""), "");
    // 段内 trim（首尾空格不产生多余空格，段间仍单空格）
    assert_eq!(
        join_query_terms(" 晴天 ", " 周杰伦 ", " 叶惠美 "),
        "晴天 周杰伦 叶惠美"
    );
}

#[test]
fn join_query_terms_artist_or_title_empty_keeps_remaining_terms() {
    // spec「字段缺失回退」逐分支：仅歌手空 → 关键词退化为「歌名 专辑」；仅歌名空 →
    // 退化为「歌手 专辑」（空 title 前端已守卫不发起搜索，join 仍须正确跳过缺失段）。
    assert_eq!(join_query_terms("晴天", "", "叶惠美"), "晴天 叶惠美");
    assert_eq!(join_query_terms("", "周杰伦", "叶惠美"), "周杰伦 叶惠美");
    // 歌手 + 专辑缺失 → 仅 title；title + 专辑缺失 → 仅 artist
    assert_eq!(join_query_terms("晴天", "", ""), "晴天");
    assert_eq!(join_query_terms("", "周杰伦", ""), "周杰伦");
}

// ---- 专辑打分（search-cover-album D3）----

#[test]
fn album_match_weights() {
    assert_eq!(album_match("叶惠美", "叶惠美"), 0.3, "album 相等 0.3");
    assert_eq!(album_match("叶惠美", "依然范特西"), 0.0, "不相等 0");
    // 空查询 / 空候选 album 不给分（防空串互相相等退化，与 title/artist 同套守卫）
    assert_eq!(album_match("", "叶惠美"), 0.0);
    assert_eq!(album_match("叶惠美", ""), 0.0);
    assert_eq!(album_match("", ""), 0.0);
    // 归一化由 norm 完成（album_match 收已归一化值，与 title/artist 同套语义）：
    // 全角转半角 + 小写后相等 → 0.3
    assert_eq!(album_match(&norm("ＹＥＨＵＩＭＥＩ"), &norm("yehuimei")), 0.3);
}

#[test]
fn aggregate_album_match_prefers_same_album() {
    // 同 title/artist 两候选：album 匹配的 0.9+0.3=1.2 > 不匹配的 0.9 → 去重后保留专辑匹配那条
    let songs = aggregate(
        "晴天",
        "周杰伦",
        "叶惠美",
        vec![
            cand_album(MusicSourceId::Netease, "1", "晴天", "周杰伦", "依然范特西"),
            cand_album(MusicSourceId::Netease, "2", "晴天", "周杰伦", "叶惠美"),
        ],
    );
    assert_eq!(songs.len(), 1);
    assert_eq!(songs[0].id, "2", "同专辑候选应优先");
    assert_eq!(songs[0].album, "叶惠美");
}

#[test]
fn aggregate_album_not_scored_when_query_or_candidate_album_empty() {
    // 查询 album 空 → album 维度不计分，排序仍由 title/artist 决定（spec「album 加分仅限非空」）
    let songs = aggregate(
        "晴天",
        "周杰伦",
        "",
        vec![
            cand_album(MusicSourceId::Netease, "1", "晴天", "周杰伦", "叶惠美"),
            cand_album(MusicSourceId::Netease, "2", "晴天", "周杰伦", "依然范特西"),
        ],
    );
    assert_eq!(songs.len(), 1, "同曲同分去重折叠（album 不计分）");
    assert_eq!(songs[0].id, "1", "同分保留先到（HashMap 首插），album 不参与仲裁");

    // 候选 album 空但查询 album 非空 → 候选不因 album 空被拉低（album_match=0，title/artist 主导）
    let songs = aggregate(
        "晴天",
        "周杰伦",
        "叶惠美",
        vec![cand(MusicSourceId::Netease, "1", "晴天", "周杰伦")],
    );
    assert_eq!(songs.len(), 1);
    assert_eq!(songs[0].id, "1", "album 空候选仍以 title/artist 分入选");
}

// ---- 并发聚合 + 超时降级 ----

/// 测试用假源：可注入「立即返回」「挂起」（挂起由注入的短超时切断）、「失败」（Err）或
/// 「记录」（search-cover-album 管线测试：把收到的 title/artist/album 三元组记入共享 Vec）。
#[derive(Clone)]
enum FakeBehavior {
    Return(Vec<SongCandidate>),
    Hang,
    Fail,
    Record(Arc<Mutex<Vec<(String, String, String)>>>),
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
        title: &str,
        artist: &str,
        album: &str,
    ) -> Result<Vec<SongCandidate>, String> {
        match &self.behavior {
            FakeBehavior::Return(list) => Ok(list.clone()),
            FakeBehavior::Hang => {
                tokio::time::sleep(Duration::from_secs(3600)).await;
                Ok(Vec::new())
            }
            FakeBehavior::Fail => Err("fake 源失败".into()),
            FakeBehavior::Record(seen) => {
                seen.lock()
                    .unwrap()
                    .push((title.to_string(), artist.to_string(), album.to_string()));
                Ok(Vec::new())
            }
        }
    }
    async fn fetch_lyric(&self, _client: &reqwest::Client, _id: &str) -> Option<String> {
        None
    }
}

#[tokio::test]
async fn search_aggregates_five_sources_and_stats() {
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
            id: MusicSourceId::Kugou,
            behavior: FakeBehavior::Return(vec![cand(
                MusicSourceId::Kugou,
                "4",
                "晴天",
                "周杰伦",
            )]),
        }),
        Box::new(FakeSource {
            id: MusicSourceId::Lrclib,
            behavior: FakeBehavior::Return(vec![cand(
                MusicSourceId::Lrclib,
                "5",
                "晴天",
                "周杰伦",
            )]),
        }),
        Box::new(FakeSource {
            id: MusicSourceId::Itunes,
            behavior: FakeBehavior::Return(vec![cand(
                MusicSourceId::Itunes,
                "6",
                "晴天",
                "周杰伦",
            )]),
        }),
    ];
    let result = search_song_with_sources(
        &client,
        "晴天",
        "周杰伦",
        "",
        sources,
        Duration::from_secs(1),
    )
    .await;
    // source_stats：各家成功返回的候选条数（固定五源来源序，search-sources-renewal D8）
    assert_eq!(
        result.source_stats,
        vec![
            (MusicSourceId::Netease, 1),
            (MusicSourceId::QqMusic, 2),
            (MusicSourceId::Kugou, 1),
            (MusicSourceId::Lrclib, 1),
            (MusicSourceId::Itunes, 1),
        ]
    );
    // 跨源保留：「晴天/周杰伦」五家各一条全部保留（不再折叠成 Netease 一条），
    // 按来源分组 Netease → QqMusic → Kugou → Lrclib → Itunes；QQ 的「晴天娃娃」0.6 在其组内次位。
    assert_eq!(result.songs.len(), 6, "五家「晴天」各保留 + QQ「晴天娃娃」= 6 条");
    assert_eq!(result.songs[0].id, "1");
    assert_eq!(result.songs[1].id, "2");
    assert_eq!(result.songs[2].id, "3");
    assert_eq!(result.songs[3].id, "4");
    assert_eq!(result.songs[4].id, "5");
    assert_eq!(result.songs[5].id, "6");
    let sources: Vec<MusicSourceId> = result.songs.iter().map(|s| s.source).collect();
    assert_eq!(
        sources,
        vec![
            MusicSourceId::Netease,
            MusicSourceId::QqMusic,
            MusicSourceId::QqMusic,
            MusicSourceId::Kugou,
            MusicSourceId::Lrclib,
            MusicSourceId::Itunes,
        ],
        "各源候选按来源分组并排展示"
    );
    assert!(!result.all_failed, "五源均成功 → 非离线");
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
            id: MusicSourceId::Kugou,
            behavior: FakeBehavior::Hang,
        }),
    ];
    let result = search_song_with_sources(
        &client,
        "晴天",
        "周杰伦",
        "",
        sources,
        Duration::from_millis(50),
    )
    .await;
    assert_eq!(
        result.source_stats,
        vec![
            (MusicSourceId::Netease, 0),
            (MusicSourceId::QqMusic, 1),
            (MusicSourceId::Kugou, 0),
            (MusicSourceId::Lrclib, 0),
            (MusicSourceId::Itunes, 0),
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
            id: MusicSourceId::Kugou,
            behavior: FakeBehavior::Hang,
        }),
        Box::new(FakeSource {
            id: MusicSourceId::Lrclib,
            behavior: FakeBehavior::Fail,
        }),
        Box::new(FakeSource {
            id: MusicSourceId::Itunes,
            behavior: FakeBehavior::Hang,
        }),
    ];
    let result = search_song_with_sources(
        &client,
        "晴天",
        "周杰伦",
        "",
        sources,
        Duration::from_millis(50),
    )
    .await;
    assert!(result.songs.is_empty());
    assert_eq!(
        result.source_stats.iter().map(|(_, n)| *n).sum::<usize>(),
        0
    );
    assert!(result.all_failed, "五源全失败 → 离线信号");
}

#[tokio::test]
async fn search_all_succeed_empty_not_offline() {
    // v1-search-fixes（C2/离线误判）：五源**成功但空**（冷门歌无匹配）→ all_failed=false，
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
            id: MusicSourceId::Kugou,
            behavior: FakeBehavior::Return(vec![]),
        }),
        Box::new(FakeSource {
            id: MusicSourceId::Lrclib,
            behavior: FakeBehavior::Return(vec![]),
        }),
        Box::new(FakeSource {
            id: MusicSourceId::Itunes,
            behavior: FakeBehavior::Return(vec![]),
        }),
    ];
    let result = search_song_with_sources(
        &client,
        "冷门曲",
        "某作者",
        "",
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
            (MusicSourceId::Kugou, 0),
            (MusicSourceId::Lrclib, 0),
            (MusicSourceId::Itunes, 0),
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
            id: MusicSourceId::Kugou,
            behavior: FakeBehavior::Fail,
        }),
        Box::new(FakeSource {
            id: MusicSourceId::Lrclib,
            behavior: FakeBehavior::Return(vec![]),
        }),
        Box::new(FakeSource {
            id: MusicSourceId::Itunes,
            behavior: FakeBehavior::Fail,
        }),
    ];
    let result = search_song_with_sources(
        &client,
        "晴天",
        "周杰伦",
        "",
        sources,
        Duration::from_millis(50),
    )
    .await;
    assert!(!result.all_failed, "至少一源成功（qq/lrclib）→ 非离线");
}

#[tokio::test]
async fn search_song_passes_album_to_sources() {
    // search-cover-album 管线：`search_song_with_sources` 必须把 album 透传给各源 `search`。
    // Record 行为把收到的三元组记入共享 Vec，断言 album 原样到达（空 album 也透传）。
    let client = reqwest::Client::new();
    let seen: Arc<Mutex<Vec<(String, String, String)>>> = Arc::new(Mutex::new(Vec::new()));
    let sources: Vec<Box<dyn MusicSource>> = vec![
        Box::new(FakeSource {
            id: MusicSourceId::Netease,
            behavior: FakeBehavior::Record(seen.clone()),
        }),
        Box::new(FakeSource {
            id: MusicSourceId::QqMusic,
            behavior: FakeBehavior::Record(seen.clone()),
        }),
    ];
    let result = search_song_with_sources(
        &client,
        "晴天",
        "周杰伦",
        "叶惠美",
        sources,
        Duration::from_millis(50),
    )
    .await;
    assert!(!result.all_failed, "Record 成功 → 非离线");
    let mut recorded = seen.lock().unwrap().clone();
    recorded.sort(); // JoinSet 完成序不确定，排序后断言
    assert_eq!(
        recorded,
        vec![
            ("晴天".to_string(), "周杰伦".to_string(), "叶惠美".to_string()),
            ("晴天".to_string(), "周杰伦".to_string(), "叶惠美".to_string()),
        ],
        "album 应原样透传给各源 search"
    );
}

#[tokio::test]
async fn search_source_returns_raw_candidates_and_empty_on_fail() {
    // CR v1-search-fixes：单源 search_source 返回**原始候选**（不做聚合去重折叠），
    // TOP_N 截断；失败 / 超时 → 空列表（C2 跳过该源）。
    let client = reqwest::Client::new();
    // 15 个归一化同曲候选（聚合去重会折叠成 1 条）——search_source 必须保留全部（截前 10）
    let many: Vec<SongCandidate> = (1..=15)
        .map(|i| cand(MusicSourceId::QqMusic, &i.to_string(), "晴天", "周杰伦"))
        .collect();
    let ok: Box<dyn MusicSource> = Box::new(FakeSource {
        id: MusicSourceId::QqMusic,
        behavior: FakeBehavior::Return(many),
    });
    let got =
        search_source_with(&client, ok, "晴天", "周杰伦", "", Duration::from_millis(50)).await;
    assert_eq!(
        got.len(),
        TOP_N,
        "单源原始候选不被聚合去重折叠，仅 TOP_N 截断"
    );
    assert!(got.iter().all(|c| c.source == MusicSourceId::QqMusic));

    // 失败 → 空
    let fail: Box<dyn MusicSource> = Box::new(FakeSource {
        id: MusicSourceId::Kugou,
        behavior: FakeBehavior::Fail,
    });
    assert!(
        search_source_with(&client, fail, "x", "y", "", Duration::from_millis(50))
            .await
            .is_empty()
    );
    // 超时 → 空
    let hang: Box<dyn MusicSource> = Box::new(FakeSource {
        id: MusicSourceId::Netease,
        behavior: FakeBehavior::Hang,
    });
    assert!(
        search_source_with(&client, hang, "x", "y", "", Duration::from_millis(50))
            .await
            .is_empty()
    );
}

#[tokio::test]
async fn search_source_passes_album_to_source() {
    // search-cover-album：`search_source_with`（C2 换源单源路径）必须把 album 透传给源 `search`
    // ——与多源 `search_song_with_sources` 同契约（spec「单源返回」查询关键词综合 title+artist+album）。
    let client = reqwest::Client::new();
    let seen: Arc<Mutex<Vec<(String, String, String)>>> = Arc::new(Mutex::new(Vec::new()));
    let source: Box<dyn MusicSource> = Box::new(FakeSource {
        id: MusicSourceId::QqMusic,
        behavior: FakeBehavior::Record(seen.clone()),
    });
    let got =
        search_source_with(&client, source, "晴天", "周杰伦", "叶惠美", Duration::from_millis(50))
            .await;
    assert!(got.is_empty(), "Record 源返回空列表");
    assert_eq!(
        seen.lock().unwrap().clone(),
        vec![("晴天".to_string(), "周杰伦".to_string(), "叶惠美".to_string())],
        "单源 search_source 应把 album 原样透传给源 search"
    );
}

// ---- download_cover：5s 超时 + 12MB 限流 ----

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
