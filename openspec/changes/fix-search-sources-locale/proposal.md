# Issue 152: 搜索源可用性修复与中英文语种适配

GitHub Issue: `#152`

规格 delta：`specs/search-sources/spec.md`（MODIFIED 打分去重排序 / 酷狗签名搜索 / iTunes 封面源，ADDED QQ 音乐搜索端点 / 繁简归一化）+ `specs/search-ui/spec.md`（MODIFIED 取词失败自动换源（C2）/ 离线降级）。

## Why

实测（真实代码路径 + 真实直连网络）五源中 QQ 与 iTunes **恒定搜不出任何结果**，酷狗**丢掉了响应里本就有封面字段**，导致封面候选实际只剩网易云一家可点：

| 源 | 搜索 | 取词 | 封面 |
|---|---|---|---|
| 网易云 | ✅ | ✅ | ✅ |
| **QQ 音乐** | ❌ 端点 HTTP 500（4/4 失败） | 端点活着但永远触发不到 | ❌ |
| 酷狗 | ✅ | ✅ | ⚪ 解析遗漏（响应有 `Image`） |
| LRCLIB | ✅ | ✅ | ⚪ 设计无 |
| **iTunes** | ❌ `country=CN` 恒 0 条 | ⚪ 设计无 | ❌ 连带失效 |

iTunes 的 `country=CN` 是**结构性空**，与网络/VPN 无关：同一 CN 店面下 `media=podcast`/`media=software` 正常取数，只有 `entity=song`/`entity=album` 返回 0（4 首中文 + 4 首英文 × 2 轮全 0，参数变体 `attribute=songTerm`/`explicit`/`lang=zh_cn`/`limit=200` 一律无效）。

进一步实测发现**语种与店面的匹配关系是双向的**，单店面无论选哪个都会丢一半：

| 查询 | HK | US |
|---|---|---|
| 稻香 周杰伦 | ✅ 稻香/周杰倫/魔杰座 | ❌ 屋顶/Landy Wen、伦/黑加伦 |
| 晴天 周杰伦 | ✅ 晴天/周杰倫/葉惠美 | ❌ Sunny Day/CIP Music |
| Blinding Lights | ⚠️ Abel Tesfaye（本名，非规范艺名） | ✅ The Weeknd |
| Take Five | ⚠️ 戴夫・布魯貝克（音译） | ✅ Dave Brubeck |
| Hello Adele | ⚠️ 翻唱团「Hello Adele Tribute」居首 | ✅ Adele《25》 |

HK 是唯一能稳定拿到中文原曲的店面，但对西方歌会用本地化/别名艺名；US 反之。因此**不做语种猜测，两个店面都查再合并**，由打分决定谁胜出——这同时消除了「猜错语种」这一整类风险（如「周杰伦 / Mojito」这种中文艺人取英文歌名的情况）。

合并后暴露第二个问题：**HK 返回繁体，本地标签通常是简体**，而现有归一化只做 trim + 全角半角 + 小写折叠（`docs/V1-PRD.md:351` 明写「V1 不做简繁转换」），导致 `artist_match("周杰伦", "周杰倫")` 恒为 0，中文歌走 HK 时最强的艺人信号（0.4 分）直接失效。

## What Changes

- **QQ 音乐搜索端点**由 `client_search_cp` 换为 `search_for_qq_cp`（同族接口、同响应结构、零签名，`parse_search_response` 零改动）。实测 4/4 成功、HTTP 200、`code:0`、10 条、`songmid` 10/10、`albummid` 8/10、~0.4s。
- **酷狗解析 `Image` 封面字段**：`{size}` 字面占位符替换为 480、`http://`→`https://`（Issue #113 惯例）、并按 host 过滤掉 `singerimg.kugou.com`（歌手头像，非专辑封面）。实测 40 条中 39 条有 `Image`，其中 `imge.kugou.com` 32 条可用、`singerimg.kugou.com` 7 条须丢弃。
- **iTunes 改为 HK + US 双店面并发搜索并合并候选**：取消 `country=CN`，不再做语种判断；两店候选同属 `MusicSourceId::Itunes`，交由既有打分与同源去重决定排序。两个店面都失败才算该源失败（`source_stats` 记合并后条数）。`search_source('itunes', ...)` 同样查两个店面。
- **归一化新增繁→简折叠**：内嵌 OpenCC 的 `TSCharacters`（字）+ `TSPhrases`（词）表（Apache-2.0），在 `norm()` 里加一步繁→简映射，使繁体远端结果与简体本地标签可匹配；同时折叠同源去重 key 里的繁简重复。**零新增依赖**。
- **聚合输入改为固定来源序**（顺带修复确定性）：`search_song_with_sources` 现用 `raw.values()` 遍历 `HashMap`，顺序不确定；改为按固定来源序展开，并在 iTunes 内部固定「HK 候选在 US 之前」，使同分去重与 TOP 3 截断结果可复现。
- **前端 C2 归一化同步折叠**：`src/store/song.ts` 的 `normalizeForMatch`（C2 换源身份校验，注释明写「对齐 Rust `searcher::norm`」）迁至 `src/lib/normalize.ts` 并接入同一折叠规则。**不做则本变更会引入一个新的可见失败**：双语合并后中文歌会出现 HK 的繁体候选，用户点选它去换源时，`周杰倫 ≠ 周杰伦` 会被判成「同名不同歌」，换源静默失败。
- 同步 `docs/V1-PRD.md`（`:342` QQ 端点、`:345` iTunes 店面、`:351` 归一化与打分）与 `docs/design/design.md`（`:204` 聚合语义、`:374` command 契约）。

## Impact

- **受累代码**：`src-tauri/src/service/searcher/` 的 `mod.rs`（归一化、聚合、来源展开）、`qqmusic.rs`、`kugou.rs`、`itunes.rs`；前端 `src/store/song.ts`（改为引入 `src/lib/normalize.ts`）。
- **新增文件**：`src-tauri/src/service/searcher/simplified.rs`、`src-tauri/src/service/searcher/opencc/{TSCharacters.txt,TSPhrases.txt,README.md}`、`src/lib/simplified.ts`、`src/lib/normalize.ts`（后两者 `?raw` 加载**同一份** OpenCC 表，单一来源、无副本漂移）。
- **契约**：**IPC 契约零变化**——`MusicSourceId` 仍是五变体（双店面合并在 iTunes 源内部完成，不新增枚举值）；`SearchResult`/`SongCandidate` 结构不变；`search_song`/`search_source`/`fetch_lyric`/`download_cover` 签名不变，command 总数仍 17；每源 TOP 3、候选上限 15 条不变。前端改动仅限归一化实现，不涉 `api/` 与组件。
- **测试**：`tests/searcher_itunes_tests.rs`（`:99` 断言 `country=CN`，且 `Itunes { search_url }` 字面构造要为双店面注入改造）、`tests/searcher_kugou_tests.rs`（`cover_url: None` 断言）、`tests/searcher_qqmusic_tests.rs`（端点默认值）、`tests/searcher_mod_tests.rs` 与新增 `tests/searcher_simplified_tests.rs`、`tests/common/mod.rs`（双店面并发需要能应答多次并按 query 分流的 mock，现有助手只服务一个请求），以及前端 `src/lib/{simplified,normalize}.test.ts`、`src/store/song.test.ts`。
- **不触碰 V1 约束**：一次一首、选中即搜、候选手动点选、保存全量覆盖、直接写盘、坏标签只读、离线降级语义均不变。本变更只改「搜得到什么」与「排序是否可信」，不改触发时机与写盘行为。
- **不改写盘数据**：简繁折叠只作用于匹配打分与去重 key，**不转换候选的展示文本**——候选仍原样显示远端返回的 `周杰倫`，用户点选后填入的也是原文。
