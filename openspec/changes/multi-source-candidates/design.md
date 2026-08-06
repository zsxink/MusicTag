# Design — multi-source-candidates（Issue #115）

## Context

搜索候选目前由 `aggregate()`（`src-tauri/src/service/searcher/mod.rs:365`）统一处理：五源并发结果拼成 `Vec<SongCandidate>` 后，按归一化 `(title, artist)` 做**跨源全局去重**，同曲多源折叠成一条（同分时来源序 0=Netease 最先者赢），全局 TOP_N=10。

问题（Issue #113 修复后实测）：对**封面**候选，跨源去重让候选来源单一化——「安泊猜想」整张专辑，QQ/iTunes 明明有 https 封面也被折叠掉，只剩网易云一家可点选。用户拍板：**各家源内部聚合去重、跨源不折叠，不同来源候选全列出给用户选**（歌词 + 封面统一生效）。

约束：V1「结果不自动写盘」语义不变（候选列表、手动点选）；`search_source`（C2 换源，单源原始候选，绕过 `aggregate`）不受影响；前端候选 shape、来源 badge、点选逻辑均已支持多源，**前端零结构改动**。

## Goals / Non-Goals

### Goals
- 歌词 + 封面候选统一改为「同源去重、跨源全保留」，多源并排展示。
- 每源 TOP 3、按来源分组排序，保证列表稳定可复现、不至于过长。
- 契约 shape 不变（`search_song` 签名、`SearchResult`、`SongCandidate`），前端零结构改动。

### Non-Goals
- 不改 `search_source`（C2 换源单源路径）。
- 不改五源并发/超时/离线判定逻辑（`search_song_with_sources` 不动）。
- 不改前端点选/取词/下载/C2 换源逻辑（`pickLyricCandidate`/`pickCoverCandidate` 不动）。
- 不做「按源折叠/展开」等新 UI 控件（候选多源展示是既有组件自然支持的）。

## 技术方案（Technical Approach）

### 模块边界与数据流

- **改动面收敛在 `src-tauri/src/service/searcher/mod.rs` 的 `aggregate()` 一个函数**（line 365）。`aggregate` 之前的打分/过滤、并发/超时/`all_failed` 判定，与之后的 `SearchResult` 组装**全部不动**。
- 数据流不变：`search_song`（line 83）→ `search_song_with_sources`（line 104）五源并发 → 收集 `all: Vec<SongCandidate>` → `aggregate(title, artist, album, all)` → `SearchResult { songs, source_stats, all_failed }`。
- 单源路径 `search_source`/`search_source_with`（line 177 / 195）**不动**：本就是单源原始候选、绕过 `aggregate`，天然只有本源候选；`take(TOP_N)` 的 IPC 载荷控制保留。

### `aggregate()` 内部重构（签名不变，纯内部变更）

公开面不变（`pub fn aggregate(query_title, query_artist, query_album, candidates: Vec<SongCandidate>) -> Vec<SongCandidate>`），内部四步：

1. **打分 + 过滤零关联**（不变）：title 相等 0.5 / artist 相等 0.4 / title 包含 0.2 / artist 包含 0.1 / album 相等 0.3（album 仅对非空计分）；`title_match == 0` 的候选过滤（防空串退化命中）。
2. **去重 key 改为 `(MusicSourceId, norm(title), norm(artist))`**：
   - `MusicSourceId` 已实现 `Hash + Eq`（`search_song_with_sources` line 136 已用于 `HashMap<MusicSourceId, _>`），key 直接可用，**无 derive 变更**。
   - **同源**：同曲 → 同一 key → 保留该源得分最高一条；同分 → 保留先到（HashMap 首插，`score > entry.0` 才替换——key 含 source 后同 key 内 rank 恒等，原「同分按来源序」比较退化为首插语义，与既有 `aggregate_album_not_scored...`「同分保留先到（HashMap 首插）」断言一致，**无行为回归**）。
   - **跨源**：source 不同 → key 不同 → 各自保留。
3. **每源 TOP 3**：去重后按 `MusicSourceId` 分组，每组按 score 降序（同分 → 归一化 title → artist 稳定序，保证可复现）截 `PER_SOURCE_TOP = 3`。
4. **按来源分组拼接**：组序 `source_rank` 升序（Netease→QqMusic→Kugou→Lrclib→Itunes），即「来源分组 + 组内分降序」；上限 5×3=15 条。

**实现姿势**：去重结果进 `HashMap<MusicSourceId, Vec<(f32, SongCandidate)>>` → 各 vec 排序后截 3 → 按 `source_rank` 拼接。**替代姿势**（去重后整体按 `(source_rank asc, score desc, norm title, norm artist)` 排序、再逐源计数保留前 3）结果等价，选分组式更直白易测。

### 常量分工（关键：TOP_N 语义收窄）

- **新增** `pub const PER_SOURCE_TOP: usize = 3`（供外置测试断言，同 `TOP_N` 提 `pub` 的惯例，`src-tauri/tests/searcher_mod_tests.rs` 引用）。
- **保留** `pub const TOP_N: usize = 10`，但**语义收窄为只服务单源路径** `search_source_with`（line 204 `take(TOP_N)`，C2 换源单源原始候选的 IPC 载荷上限仍 10）。`aggregate` 不再 `truncate(TOP_N)`——「全局 TOP 10」被「每源 TOP 3 + 来源分组」取代。该常量注释同步改写，防后续实现误把全局截断加回 `aggregate`。

### 数据流图

```
search_song → search_song_with_sources（五源并发/超时/all_failed 不变）
  → raw: HashMap<MusicSourceId, Option<Vec<SongCandidate>>>
  → all → aggregate（打分过滤 → (source,title,artist) 去重 → 每源 TOP3 → 来源分组拼接）
  → songs（≤15 条、多源并存）→ SearchResult{songs, source_stats, all_failed}
```

`source_stats`（各家成功返回的**原始**条数）语义不变——跨源不折叠不影响计数；`all_failed`（五源全失败）逻辑未动。

### 契约与前端

- IPC 契约不变：`search_song(title, artist, album) -> SearchResult`、`SearchResult`/`SongCandidate` shape 不变，仅 `songs` 内容变多。
- 前端**零结构改动**依据：`store/song.ts` 封面候选 = `result.songs.filter(s => s.cover_url !== null)`（line 429 / 475，逐条过滤、无长度/来源顺序假设）；`LyricCandidate`/`CoverCandidate` 已带来源 badge + 点选逻辑；store 测试已有多源 fixture（`song.test.ts` line 1124-1125 netease+qqmusic 封面并存断言）。列表变长由候选区折叠（FR-8.15「隐藏候选 ▲」）兜底。

## 关键技术决策

### D1: 去重 key 从 `(title, artist)` → `(source, title, artist)`

`aggregate()` 的去重 `HashMap` key 由 `(norm(title), norm(artist))` 改为 `(source, norm(title), norm(artist))`：
- **同源**：同 key → 保留该源得分最高一条（原逻辑不变，同分首插无回归）。
- **跨源**：不同 source → 不同 key → 各自保留、互不折叠。

**备选方案**：不碰 `aggregate()`，新增 `aggregate_per_source()` 供封面搜索专用。**否决**：歌词和封面共用 `search_song` 一条路，用户要求两者统一生效；改 key 一处生效、语义一致，避免两套聚合逻辑漂移。技术细节：`MusicSourceId` 已 `Hash + Eq`（line 136 既有 HashMap 用法），key 直接可组。

### D2: 每源保留 TOP 3（新增 `PER_SOURCE_TOP`，`TOP_N` 保留给单源）

去重后按来源分组，每组保留该源得分最高 TOP 3。上限 = 5×3 = 15 条。新增 `pub const PER_SOURCE_TOP: usize = 3`；`TOP_N = 10` 保留给 `search_source_with`（单源原始候选载荷上限，既有测试 line 674 依赖），二者职责分开、不混用。

**备选方案**：全局 TOP_N 不变、只改去重 key。**否决**：五源全命中时列表会到 50 条（每源原始 10 条），候选区过长失去点选效率；每源 TOP 3 是「够选不乱」的折中，精确匹配通常每源 1 条即可，3 条覆盖同名多版本。

### D3: 排序改为「来源分组 + 组内分降序」

排序键从「score 降序 → source_rank → title/artist」改为「source_rank 升序（来源分组）→ 组内 score 降序 → norm title → norm artist」。即列表按 网易云→QQ→酷狗→LRCLIB→iTunes 分组，组内按分降序（同分按归一化 title/artist 稳定，可复现）。

**备选方案**：维持「score 降序 → source_rank」。**否决**：多源候选语义下，用户需要「一眼分清是哪家」——按来源分组，badge 连贯、候选与来源对应关系清晰；score 混排会把各家插在一起，观感散乱。

### D4: 契约与前端零改动

`search_song(title, artist, album) -> SearchResult`、`SongCandidate{source,id,title,artist,album,cover_url}` 均不变，仅 `songs` 内容变多。前端 `manualSearch` 的 `filter(cover_url !== null)`（store line 429/475）逐条过滤、无长度/来源假设；`LyricCandidate`/`CoverCandidate` 的来源 badge + 点选逻辑已支持多源（store 测试已有多源 fixture）。候选列表变长由候选区折叠（FR-8.15）兜底。

## 变更域判断与依赖顺序（Change Domain & Dependency）

- **变更域：纯后端（backend）**。改动全部落在 Rust `service/searcher/mod.rs` 的 `aggregate()` + 外置单测 `src-tauri/tests/searcher_mod_tests.rs`；前端**零代码改动**（仅回归验证）。
- **依赖顺序：无跨前后端串行**。不存在「前端依赖后端新结构」的代码依赖——`SearchResult`/`SongCandidate` shape 未变，前端不消费任何新字段/新排序假设。
- **按 7 角色流水线**：纯后端仅 Rust-Dev 单角色实施（自适应组织规则）；完成后 Verify 跑 `npm run test` + `npm run build` 确认前端零回归；contract 守卫 `command-contract.test.ts` 确认 `search_song` 签名未变。**未显式创建 worktree，禁止并写**——本变更为单一函数改动，无并行面。
- **验证顺序**：Rust TDD（先改失败测试 → 实现 → 全绿）→ 前端回归（npm run test/build，零代码改动）→ 契约守卫 → `openspec validate --strict --no-interactive`。

## Risks / Trade-offs

- [候选列表变长（歌词最多 15 条）] → 候选区本就可折叠（FR-8.15「隐藏候选 ▲」），列表变长可控；每源 TOP 3 已压上限。
- [跨源不折叠后，同曲多源在歌词候选里「重复出现」] → 这是**有意为之**（用户拍板：不同来源都列出给用户选）；各条带来源 badge，点哪条用哪家的词（来源平台清晰）。
- [排序语义变化影响既有测试] → `aggregate` 去重/排序断言从「跨源折叠」改「同源折叠、跨源保留」，更新 `tests/searcher_mod_tests.rs` 相应断言（TDD：先改失败测试再实现）。受影响用例见 tasks 2.3 清单；`aggregate_scores_and_sorts_desc` / `aggregate_album_*` 只含单源 fixture，应保持通过（防误伤）。
- [TOP_N 语义收窄被误用] → 保留 `TOP_N` 仅服务单源路径，新增 `PER_SOURCE_TOP`，常量注释同步改写，防后续实现误把全局截断加回 `aggregate`。

## Migration Plan

- 纯后端行为变更，无数据迁移、无持久化影响。
- 部署 = 合入 main → v0.1.1 重发布（含 Issue #113 https 修复，PR #114 已合入）。

## Open Questions

- 无（行为、上限、排序均已由用户拍板确认）。
