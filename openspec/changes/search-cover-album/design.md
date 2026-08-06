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

## Decisions

### D1: `MusicSource::search` trait 增加 `album: &str`
`mod.rs` L48-57 trait 签名：`async fn search(&self, client, title, artist) → Result<Vec<SongCandidate>, String>` 增加 `album: &str` 参数。五源 `search` 实现签名同步。

**理由**：统一从 trait 层透传，避免各源自行从某处取 album。现有 `_artist` 被忽略的源（netease/qqmusic/kugou）一并把 artist 也拼进关键词，顺带修复「artist 从未参与查询」的既有问题（Issue 诉求的一部分）。
**备选**：仅对封面源（iTunes）透传 album——被用户否决，要求全源透传。

### D2: 查询关键词拼接 = 空段感知的 join
各源查询构造统一用 `join_query_terms(title, artist, album)`（`mod.rs` 或独立 util），逻辑：非空段用空格 join，全空 → 空串。网易云/QQ/酷狗/iTunes 用拼接串作关键词（`s`/`w`/`keyword`/`term`）；LRCLIB 因 API 原生分参数，用 `track_name`/`artist_name`/`album_name` 三段各自传（album 空则省略 `album_name` 参数）。

**理由**：iTunes/LRCLIB 这类按完整 term 搜索的源，专辑能显著收敛到正确专辑；网易云/QQ/酷狗关键词拼接在工程上零风险（多词搜索天然支持）。
**备选**：给每源加 album 专属字段（如网易云 `params.s` 只放 title）——不采纳，网易云 `cloudsearch/pc` 无独立 album 参数，只能靠关键词。

### D3: `aggregate` 打分加 `album_match`
打分权重：`title 相等 0.5 + artist 相等 0.4 + title 包含 0.2 + artist 包含 0.1 + album 相等 0.3`。album 相等仅当**查询 album 与候选 album 均非空**时计分（防空串互相包含退化，与既有 `title_match`/`artist_match` 空串守卫同一套 `norm` 语义）。

**理由**：album 是强区分信号，0.3 权重介于 artist 相等与 title 包含之间，可显著提升「同专辑候选优先」而不至于喧宾夺主。
**风险**：album 拼进关键词后，匹配分自然上升（关键词更精确 → 更可能命中同一专辑曲目），album_match 是第二重保险；两者叠加不冲突。

### D4: 契约扩展与文档同步
- `commands/search.rs`：`search_song(title, artist, album: String)`、`search_source(source, title, artist, album: String)`。
- `searcher::search_song`/`search_source`/`search_source_with`/`aggregate` 签名透传 `album`。
- 前端 `api/search.ts`：`searchSongs(title, artist, album)`、`searchSource(source, title, artist, album)` 透传 invoke 参数 `{ title, artist, album }`。
- `store/song.ts` 三处调用点：`autoSearchOnSelect`/`manualSearch` 传 `cur.album`（当前文件标签专辑），`pickLyricCandidate` C2 换源传 `cand.album`（候选自身专辑）。
- 契约文档：`docs/design/design.md` §10.3 两行签名、`docs/V1-PRD.md` FR-8.5/8.6 相关、`openspec/specs/search-sources/spec.md` 主规格、`openspec/config.yaml` 契约清单（command-contract 守卫四源一致）。

**理由**：design.md §10.3 契约表是 command-contract 守卫测试的扫描源，改签名必须同步四源（`lib.rs` 注册 / design.md §10.3 / V1-PRD §7 / config.yaml）。

### D5: 版本号四文件同步 `0.1.0` → `0.1.1`
`package.json` / `package-lock.json`（含顶层与 `packages[""]`）/ `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml` 四处 version 字段同步。`Cargo.lock` 若有 root package version 也需同步（`cargo build` 自动处理，显式核对）。

**理由**：Tauri 应用版本号由 `tauri.conf.json` 驱动打包产物，npm/Cargo 各自独立——四处必须一致，否则 `npm run tauri build` 产物与源码版本错位。

## Risks / Trade-offs

- **关键词过严收敛** → 三字段拼接可能让某些源（尤其 iTunes 对中文专辑名）搜不到 → 应对：album 为空即回退现行为；专辑名生僻时仍可手动删专辑重搜（编辑表单已有该能力），不改变候选列表展示逻辑。
- **album_match 权重引入回归** → 若某候选 album 为 `"未分类专辑"`（QQ 空值兜底），与查询非空 album 不相等不计分，不拉低排名 → 空值兜底串天然不与真实专辑相等，风险可控。
- **契约改动波及命令守卫测试** → `command-contract.test.ts` 扫描 `search_song(title, artist)` 字样会失败 → 同步更新该测试与四源契约文档。
- **C2 换源语义漂移** → `pickLyricCandidate` 用候选自身 `cand.album` 而非当前歌曲 `cur.album` → 这是正确语义（换源搜索的是「点选那条候选的同一首歌」，其专辑就是候选专辑），design 明示，CR 专项核对。

## Migration Plan

无数据迁移。发布元数据版本号同步、契约透传、查询构造增强均为向后兼容增量（album 为空回退现行为）。回滚 = 还原 `0.1.1` → `0.1.0` 与签名改动（无持久状态）。

## Open Questions

无。
