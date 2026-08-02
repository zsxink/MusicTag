## Context

`v1-search-backend` 已提供 `search_song`/`fetch_lyric`/`download_cover`。本变更实现前端搜索联动（FR-8 + design.md §9、§6.3–6.6）。

## Goals / Non-Goals

**Goals:**
- 选中即搜（仅一次、只补缺失）的触发模型。
- 歌词/封面候选区展示、点选写入、取词换源。
- 离线降级、搜索中/空态、候选生命周期、手动按钮。

**Non-Goals:**
- 不改 Rust 搜索（已由 `v1-search-backend` 完成）。
- 不做搜索结果落盘（V1 点选才填）。

## Decisions

- **触发模型**：`onSongSelect` 里一次判定——检查 `current.lyrics` 空 && `lyrics_source != SidecarLrc` → 搜歌词；`current.cover == null` → 搜封面；两者都满足则 `search_song(title, artist)` 一次（同时喂歌词 + 封面候选，惰性拉取）。删除内容后该 flag 不重算（FR-8.4：删除不再触发）。
- **store 状态**：`searchState: 'idle'|'searching'|'done'`、`lyricCandidates`、`coverCandidates`、`isOffline`（会话级）、`searchedThisSong: boolean`。
- **离线降级（失败首响）**：`search_song` 返回 `source_stats` 全 0 且无候选 → 会话级 `isOffline=true`；后续选中不再自动搜、候选区不出现，显示「离线：仅手动填写」；手动按钮仍可用（用户主动重试）。全源失败只标记一次（FR-8.4a 首响）。
- **取词换源（C2）**：点选候选 `fetch_lyric` 返回 None → 换另一家源（按歌名+作者再搜该源或直接 fetch）重试同一首歌；全源失败显示空态。不自动降级到低分候选。
- **候选生命周期**：切歌即清空 `lyricCandidates`/`coverCandidates`/`searchedThisSong=false`（FR-8.14）。
- **封面失败静默**：`download_cover` Err / 解码压缩失败 → 该张候选标记 failed 静默移除，其余不受影响（验收 #12）。
- **UI 组件**：`LyricCandidate`（来源标签 + 歌名—作者，hover 琥珀）、`CoverCandidate`（3×N 网格 + 左下角来源角标）、`cand-status`（「搜索中…」+ 转圈）、`cand-empty`（空态文案）。
- **手动按钮**：歌词区 head 与 textarea 之间、封面区封面框下方（design.md §6.2 `.search-trigger` 虚线按钮）。

## Risks / Trade-offs

- 自动搜索每次选中都触发（缺失时）：依赖离线降级避免断网时反复等待 6s。
- 候选点选后歌词仍可编辑：`fetch_lyric` 拉回文本填入 textarea 即进入用户可改状态，dirty 判定自然生效。
