## Context

Issue #109：搜索封面结果与歌手、专辑毫无关联。根因——`search_song(title, artist)` / `search_source(source, title, artist)` 的查询构造只用 title（网易云 `params.s`、QQ `w`、酷狗 `keyword` 三源甚至忽略 artist），iTunes 仅 `term = "<title> <artist>"`。五家源的候选**响应**解析均已填充 `SongCandidate.album`（netease `al.name`、qqmusic `albumname`、kugou `AlbumName`、lrclib `albumName`、itunes `collectionName`），但 album 从未回流进查询，导致同名不同专辑的歌排序靠前、封面张冠李戴。

本变更：搜索查询从「title（+artist）」扩展为「title + artist + album」综合透传，`aggregate` 打分纳入 album 维度，同时版本号 `0.1.0` → `0.1.1`。

## Goals / Non-Goals

**Goals:**
- `search_song` / `search_source` 契约增加 `album` 参数，IPC 全链路透传（Rust command → `service/searcher` → 前端 `api/search.ts` → store 调用点）。
- 五源查询构造综合 title + artist + album（`"<title> <artist> <album>"`，段间单空格，空段跳过）；LRCLIB 追加 `album_name` 参数。
- `aggregate` 打分加 `album_match`（相等 0.3，仅对非空 album 计分），综合排序使同专辑候选优先。
- album 为空时**完全回退现行为**，不影响无专辑文件的搜索路径与离线判定。
- 版本号四文件同步 `0.1.0` → `0.1.1`。

**Non-Goals:**
- 不改五源选择、并发、超时、降级、离线判定语义（`all_failed`/`source_stats` 不变）。
- 不改 C2 换源流程本身，只让 `search_source` 查询带上 album。
- 不做批量搜索（V2）、不做专辑维度的独立搜索入口。
- 不调整 `MusicSourceId` 值域、`SongCandidate`/`SearchResult` 出参结构。

## 技术方案

**组件划分与模块边界**（改动面 = command 薄壳层 + 搜索业务层 + 前端接入层，全部是既有文件的增量扩展，无新增模块/文件）：

| 层 | 文件 | 改动 |
|---|---|---|
| Tauri command 薄壳 | `src-tauri/src/commands/search.rs` | `search_song(title, artist, album: String)`、`search_source(source, title, artist, album: String)` 签名加 album，只做参数接收 + 委托，不含查询/打分逻辑 |
| 搜索业务层（trait + 聚合） | `src-tauri/src/service/searcher/mod.rs` | `MusicSource::search` trait 加 `album: &str`；`search_song`/`search_song_with_sources`/`search_source`/`search_source_with`/`aggregate` 签名透传 album；新增 `join_query_terms`（`pub`）与 `album_match` |
| 五源实现 | `src-tauri/src/service/searcher/{netease,qqmusic,kugou,lrclib,itunes}.rs` | 各 `search()` 用 `join_query_terms(title, artist, album)` 构查询关键词；LRCLIB 追加 `album_name` 参数（album 空省略） |
| 前端 api 层 | `src/api/search.ts` | `searchSongs(title, artist, album)` / `searchSource(source, title, artist, album)` invoke 透传 `{ title, artist, album }` |
| 前端 store 层 | `src/store/song.ts` | 3 处调用点透传 album（`autoSearchOnSelect`/`manualSearch` 传 `cur.album`，`pickLyricCandidate` C2 换源传 `cand.album`） |
| 契约文档 | `docs/design/design.md` §10.3 / `docs/V1-PRD.md` §7 + FR-8 / `openspec/specs/search-sources/spec.md` 主规格 / `openspec/config.yaml` | 签名与行为描述同步（四源契约一致） |

**数据流（自动搜索路径）**：

```
autoSearchOnSelect / manualSearch
  → api/search.ts  searchSongs(cur.title, cur.artist, cur.album)
  → IPC  invoke('search_song', { title, artist, album })
  → commands/search.rs  search_song
  → searcher::search_song(client, title, artist, album)
  → search_song_with_sources → JoinSet 并发 5 × source.search(client, title, artist, album)
  → 各源 join_query_terms(title, artist, album) 构关键词（LRCLIB 用 album_name 参数）
  → aggregate(query_title, query_artist, query_album, all) 打分去重排序 → SearchResult
```

**数据流（C2 换源路径）**：

```
pickLyricCandidate(cand, fetchLyric, searchSource)
  → api/search.ts  searchSource(source, cand.title, cand.artist, cand.album)
  → IPC  invoke('search_source', { source, title, artist, album })
  → commands/search.rs  search_source → searcher::search_source → search_source_with
  → 单源 source.search(client, title, artist, album) → 原始候选（不聚合去重）
```

**查询构造约定**（`join_query_terms` 是唯一组合点，D2）：
- 网易云 `params.s` / QQ `w` / 酷狗 `keyword` / iTunes `term` ← 拼接串 `"<title> <artist> <album>"`（空段跳过、段间单空格）；
- LRCLIB `track_name`/`artist_name` 原样传，另按 album 非空追加 `album_name`；
- **join 只发生在各源 `search()` 实现内**：先算 `let kw = join_query_terms(title, artist, album)`，再传入既有纯构造函数（netease `search_payload(&kw)`、kugou `search_params(&kw)`、QQ/iTunes 用 kw 填 `w`/`term`）——payload/param 构造函数签名保持 `keyword: &str` 不变，测试锚点不漂移、改动面最小。

## Decisions

### D1: `MusicSource::search` trait 增加 `album: &str`
`mod.rs` L48-57 trait 签名：`async fn search(&self, client, title, artist) → Result<Vec<SongCandidate>, String>` 增加 `album: &str` 参数。五源 `search` 实现签名同步。

**理由**：统一从 trait 层透传，避免各源自行从某处取 album。现有 `_artist` 被忽略的源（netease/qqmusic/kugou）一并把 artist 也拼进关键词，顺带修复「artist 从未参与查询」的既有问题（Issue 诉求的一部分）。
**备选**：仅对封面源（iTunes）透传 album——被用户否决，要求全源透传。

### D2: 查询关键词拼接 = 空段感知的 join
各源查询构造统一用 `join_query_terms(title, artist, album)`（`mod.rs` 或独立 util），逻辑：非空段用空格 join，全空 → 空串。网易云/QQ/酷狗/iTunes 用拼接串作关键词（`s`/`w`/`keyword`/`term`）；LRCLIB 因 API 原生分参数，用 `track_name`/`artist_name`/`album_name` 三段各自传（album 空则省略 `album_name` 参数）。

**理由**：iTunes/LRCLIB 这类按完整 term 搜索的源，专辑能显著收敛到正确专辑；网易云/QQ/酷狗关键词拼接在工程上零风险（多词搜索天然支持）。
**join 落点**：拼接只发生在各源 `search()` 实现内（先算 `kw` 再喂既有纯构造函数），`search_payload`/`search_params` 等构造函数签名不变——改动面最小，单测锚点（`search_payload("晴天 周杰伦 叶惠美")` → `params.s`）不漂移；`join_query_terms` 放 `mod.rs` 提 `pub`（集成测试外置，需 `pub` 可见，同 `norm`/`title_match` 惯例）。
**备选**：给每源加 album 专属字段（如网易云 `params.s` 只放 title）——不采纳，网易云 `cloudsearch/pc` 无独立 album 参数，只能靠关键词。

### D3: `aggregate` 打分加 `album_match`
打分权重：`title 相等 0.5 + artist 相等 0.4 + title 包含 0.2 + artist 包含 0.1 + album 相等 0.3`。album 相等仅当**查询 album 与候选 album 均非空**时计分（防空串互相包含退化，与既有 `title_match`/`artist_match` 空串守卫同一套 `norm` 语义）。

**理由**：album 是强区分信号，0.3 权重介于 artist 相等与 title 包含之间，可显著提升「同专辑候选优先」而不至于喧宾夺主。
**实现要点**：查询与候选 album 均经 `norm`（trim + 全角半角 + 小写）归一化后比相等（不做包含、不做 `/`/`,` 拆分——spec 只定义「相等 0.3」）；`album_match` 与 title/artist 守卫同套 `norm` 空串语义（任一方为空 → 0 分，QQ 空值兜底串「未分类专辑」天然不与真实专辑相等，不拉低排名）。**打分上限由 0.9 → 1.2**（0.5+0.4+0.3），仅影响排序、无截断语义，`aggregate` 的过滤/去重/TOP_N 逻辑不变。
**风险**：album 拼进关键词后，匹配分自然上升（关键词更精确 → 更可能命中同一专辑曲目），album_match 是第二重保险；两者叠加不冲突。

### D4: 契约扩展与文档同步
- `commands/search.rs`：`search_song(title, artist, album: String)`、`search_source(source, title, artist, album: String)`。
- `searcher::search_song`/`search_source`/`search_source_with`/`aggregate` 签名透传 `album`。
- 前端 `api/search.ts`：`searchSongs(title, artist, album)`、`searchSource(source, title, artist, album)` 透传 invoke 参数 `{ title, artist, album }`。
- `store/song.ts` 三处调用点：`autoSearchOnSelect`/`manualSearch` 传 `cur.album`（当前文件标签专辑），`pickLyricCandidate` C2 换源传 `cand.album`（候选自身专辑）。
- 契约文档：`docs/design/design.md` §10.3 两行签名、`docs/V1-PRD.md` FR-8.5/8.6 相关、`openspec/specs/search-sources/spec.md` 主规格、`openspec/config.yaml` 契约清单（command-contract 守卫四源一致）。

**理由**：四源契约一致是 command-contract-sync 的既定不变量（`lib.rs` 注册 / design.md §10.3 / V1-PRD §7 / config.yaml）。
**守卫机制精度**：`src/styles/command-contract.test.ts` 只按 command **名**（`name(` 形态）与「无参签名」比对——`search_song`/`search_source` 仅增加 album 参数**不会**触发守卫红；同步四源是文档正确性要求（契约表签名陈旧会让后续签名级检查与人工对照失真），故仍须全部更新。

### D5: 版本号四文件同步 `0.1.0` → `0.1.1`
`package.json` / `package-lock.json`（含顶层与 `packages[""]`）/ `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml` 四处 version 字段同步。`Cargo.lock` 若有 root package version 也需同步（`cargo build` 自动处理，显式核对）。

**理由**：Tauri 应用版本号由 `tauri.conf.json` 驱动打包产物，npm/Cargo 各自独立——四处必须一致，否则 `npm run tauri build` 产物与源码版本错位。

## 变更域判断

**判定：both（跨前后端）**。改动横跨 Rust command 签名/trait/五源查询构造/`aggregate` 打分（后端）+ `api/search.ts`/`store/song.ts` 三处调用点与前端测试（前端）+ 契约文档与版本号（两侧元数据）。

**依赖顺序（串行，不建 worktree）**：

1. **Rust 后端先行**：trait/command/五源/`aggregate` 签名改动是契约事实来源，前端 invoke 参数必须与之对齐——先合后端，前端才可编译。
2. **前端接入随后**：`api/search.ts` 透传 + store 三调用点 + 前端测试。
3. **契约文档 + 版本 + 守卫**：design.md §10.3 / V1-PRD §7+FR-8 / config.yaml / 主规格 与版本号同步，随分支一起进 PR（归档在提交 PR 前）。

版本号 `0.1.0 → 0.1.1` 是独立元数据改动，无依赖，但为收口方便并入组 5（版本号同步）与文档一起落。

## 任务拆分建议

按 tasks.md 现有 1–7 组执行，**严格串行**（Rust → 前端 → 版本/文档 → 验证归档）：

- **组 1–3（Rust，先做）**：trait 与 `join_query_terms` 加测试先行（红→绿）；五源查询构造逐源断言；`aggregate` 打分断言。本组完成后 `cargo test` 应全绿。
- **组 4（前端，依赖组 1–3 契约）**：`api/search.ts` + store 三调用点，先改 `search.test.ts`/`song.test.ts` 断言再实现。
- **组 5–6（版本 + 契约文档）**：四处版本号 + 契约表四源同步 + 主规格合入；命令守卫按 D4「守卫机制精度」核对（command 名不变，文档同步即可）。
- **组 7（验证归档）**：统一验证基线 → `openspec archive`。

每组的测试改动与本组实现**同 commit**（先红后绿），保证增量可独立验收。

## Risks / Trade-offs

- **关键词过严收敛** → 三字段拼接可能让某些源（尤其 iTunes 对中文专辑名）搜不到 → 应对：album 为空即回退现行为；专辑名生僻时仍可手动删专辑重搜（编辑表单已有该能力），不改变候选列表展示逻辑。
- **album_match 权重引入回归** → 若某候选 album 为 `"未分类专辑"`（QQ 空值兜底），与查询非空 album 不相等不计分，不拉低排名 → 空值兜底串天然不与真实专辑相等，风险可控。
- **契约表签名陈旧** → command 名不变不会触发 `command-contract.test.ts` 守卫红（D4「守卫机制精度」），但四源契约表（design.md §10.3 / PRD §7 / config.yaml / 主规格）若不随签名更新会失真 → 统一在组 5–6 同步。
- **C2 换源语义漂移** → `pickLyricCandidate` 用候选自身 `cand.album` 而非当前歌曲 `cur.album` → 这是正确语义（换源搜索的是「点选那条候选的同一首歌」，其专辑就是候选专辑），design 明示，CR 专项核对。

## Migration Plan

无数据迁移。发布元数据版本号同步、契约透传、查询构造增强均为向后兼容增量（album 为空回退现行为）。回滚 = 还原 `0.1.1` → `0.1.0` 与签名改动（无持久状态）。

## Open Questions

无。
