## Why

Issue #115（本机实测 + 用户拍板）：搜索候选目前走 `aggregate()` **跨源全局去重**——按归一化 `(title, artist)` 折叠同曲多源、来源序最先者赢（网易云→QQ→酷狗→LRCLIB→iTunes）。对**歌词**合理（避免同曲多源刷屏），但对**封面**让候选来源单一化：例如「安泊猜想」整张专辑，QQ/iTunes 明明有 https 封面候选也被折叠掉（Issue #113 修复后，该专辑仍只剩网易云一家封面可点选）。用户要求：**各家源内部聚合去重、跨源不折叠**，把不同来源的候选**都列出来给用户选**（歌词 + 封面统一生效）。

## What Changes

- **聚合去重粒度调整**（`aggregate()`）：去重 key 从 `(title, artist)` → `(source, title, artist)`——**同源内**同曲保留该源得分最高一条；**跨源不折叠**，网易云/QQ/酷狗/LRCLIB/iTunes 各保留自己的候选。
- **候选上限**：每源保留 TOP 3（最多 5×3=15 条）；排序按来源分组（Netease→QqMusic→Kugou→Lrclib→Itunes），组内按分降序。
- **契约不变**：`search_song(title, artist, album)` 签名与 `SearchResult` 结构不变，仅 `songs` 内容变多（多源候选）。
- **前端零结构改动**：`LyricCandidate`/`CoverCandidate` 已有来源 badge + 点选逻辑，列表变多源自动生效；`pickLyricCandidate`（点选→取词→C2 换源）、`pickCoverCandidate`（点选→下载）不动。
- **`search_source`（C2 换源）不受影响**：它本就是单源原始候选、绕过跨源聚合，天然只有本源候选。
- **产品行为变更同步**（V1 拍板文档）：`docs/V1-PRD.md` FR-8.6「聚合」、`docs/design/design.md` 聚合打分段、记忆 `music-tag-v1-spec.md`、主规格 `openspec/specs/search-sources/spec.md` 的「去重」语义从「跨源折叠」改为「同源折叠、跨源全保留」。

## Capabilities

### New Capabilities

（无——不新增独立能力，聚合语义并入既有 `search-sources` 能力）

### Modified Capabilities

- `search-sources`: 「打分去重排序」Requirement 的去重语义从「跨源折叠（两家源返回同一首歌 → 仅保留最高分一条）」改为「**同源折叠、跨源全保留**（两家源各保留自己的候选，来源 badge 展示、供用户点选）」，候选上限从全局 TOP_N=10 改为**每源 TOP 3**、按来源分组排序。

## 关联 Issue

GitHub Issue：`#115`（分支提交 `feat(115): ...`、PR `Closes #115`）

## Impact

- `src-tauri/src/service/searcher/mod.rs`：`aggregate()` 去重 key 改为 `(source, title, artist)`；排序改为按来源分组；每源 TOP 3。
- `src-tauri/tests/searcher_*_tests.rs`：`aggregate` 去重/排序断言从「跨源折叠」改为「同源折叠、跨源保留」。
- 前端：**零改动**（候选 shape、badge、点选逻辑均已支持多源）。
- 契约文档：`docs/V1-PRD.md`（FR-8.6）、`docs/design/design.md`（聚合打分段 §搜索）、记忆 `music-tag-v1-spec.md`、`openspec/specs/search-sources/spec.md` 主规格 delta。
- 测试：Rust `tests/searcher_*_tests.rs` 聚合断言更新；`npm run test` / `npm run build` 回归确认前端零改动。
