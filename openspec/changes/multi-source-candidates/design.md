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

## Decisions

### D1: 去重 key 从 `(title, artist)` → `(source, title, artist)`

`aggregate()` 的去重 `HashMap` key 由 `(norm(title), norm(artist))` 改为 `(source, norm(title), norm(artist))`。这样：
- **同源**：同一来源内同曲 → 同一 key → 保留该源得分最高一条（原逻辑不变）。
- **跨源**：不同 source → 不同 key → 各自保留，互不折叠。

**备选方案**：不碰 `aggregate()`，新增 `aggregate_per_source()` 供封面搜索专用。**否决**：歌词和封面共用 `search_song` 一条路，用户要求两者统一生效；改 key 一处生效、语义一致，避免两套聚合逻辑漂移。

### D2: 每源保留 TOP 3

去重后按来源分组，每组保留该源得分最高 TOP 3。上限 = 5×3 = 15 条（原 TOP_N=10）。

**备选方案**：全局 TOP_N 不变、只改去重 key。**否决**：五源全命中时列表会到 50 条（每源原始 10 条），候选区过长失去点选效率；每源 TOP 3 是「够选不乱」的折中，精确匹配通常每源 1 条即可，3 条覆盖同名多版本。

### D3: 排序改为「来源分组 + 组内分降序」

排序键从「score 降序 → source_rank → title/artist」改为「source_rank 升序（来源分组）→ score 降序」。即列表按 网易云→QQ→酷狗→LRCLIB→iTunes 分组，组内按分降序。

**备选方案**：维持「score 降序 → source_rank」。**否决**：多源候选语义下，用户需要「一眼分清是哪家」——按来源分组，badge 连贯、候选与来源对应关系清晰；score 混排会把各家插在一起，观感散乱。

### D4: 契约与前端零改动

`search_song(title, artist, album) -> SearchResult`、`SongCandidate{source,id,title,artist,album,cover_url}` 均不变，仅 `songs` 内容变多。前端 `manualSearch` 的 `filter(cover_url !== null)` 后自然展示多源封面；`LyricCandidate`/`CoverCandidate` 的来源 badge + 点选逻辑已支持。

## Risks / Trade-offs

- [候选列表变长（歌词最多 15 条）] → 候选区本就可折叠（FR-8.15「隐藏候选 ▲」），列表变长可控；每源 TOP 3 已压上限。
- [跨源不折叠后，同曲多源在歌词候选里「重复出现」] → 这是**有意为之**（用户拍板：不同来源都列出给用户选）；各条带来源 badge，点哪条用哪家的词（来源平台清晰）。
- [排序语义变化影响既有测试] → `aggregate` 去重/排序断言从「跨源折叠」改「同源折叠、跨源保留」，更新 `tests/searcher_*_tests.rs` 相应断言（TDD：先改失败测试再实现）。

## Migration Plan

- 纯后端行为变更，无数据迁移、无持久化影响。
- 部署 = 合入 main → v0.1.1 重发布（含 Issue #113 https 修复，PR #114 已合入）。

## Open Questions

- 无（行为、上限、排序均已由用户拍板确认）。
