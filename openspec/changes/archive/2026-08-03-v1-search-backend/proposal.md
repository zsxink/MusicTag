## Why

V1 的自动搜索（FR-8）需要 Rust 侧三源（网易云 + QQ + 咪咕）并发搜索聚合的能力：`search_song(title, artist)` 返回去重排序候选，`fetch_lyric(source, id)` 取歌词文本，`download_cover(url)` 下载封面。这是纯后端能力，独立于 UI，可独立 CR/合并。

## What Changes

- **多源搜索模块**：`search/{mod,netease,qqmusic,migu}.rs` + 统一 Trait `MusicSource`：`search(title, artist) -> Vec<SongCandidate>` + `fetch_lyric(song_id) -> Option<String>`。
- **网易云**：weapi 搜索 + linuxapi 取歌词，`aes`/`cbc`/`rsa`/`rand` 手写加密（无 JS 引擎）。
- **QQ 音乐**：`musicu.fcg` JSON 协议（纯 HTTP，无加密）。
- **咪咕**：`migu/remoting/scr_search_tag`（纯 HTTP，无加密）。
- **并发聚合**：`tokio::join_all` 三家并发（每家 6s 超时，失败降级为空列表并记入 `source_stats`）。
- **打分去重**：`title 相等 0.5 + artist 相等 0.4 + title 包含 0.2 + artist 包含 0.1`；归一化 = trim + 全角半角；按归一化 `(title, artist)` 去重保留最高分；前 N 条返回。
- **惰性拉取**：候选秒出（封面 URL 随搜索带出），歌词文本点选候选行才 `fetch_lyric`，封面点选才 `download_cover`（单独 5s 超时 + 响应限流）。
- **取词失败自动换源（C2）**：`fetch_lyric` 点选候选取词失败（None）→ 前端侧自动换另一家来源重试同一首歌（本变更提供单源 `fetch_lyric`；换源编排由 `v1-search-ui` 聚合前端逻辑，Rust 侧返回 source_stats 供兜底）。

## Capabilities

### New Capabilities
- `search-sources`: 三源并发搜索 + 打分去重 + 惰性拉取（歌词/封面）

### Modified Capabilities
（无）

## 关联 Issue

- GitHub Issue：`#14`（变更前已建，作为本变更锚点；分支提交 `feat(14): ...`、PR `Closes #14`）

## Impact

- 新增 Rust 依赖：`reqwest`（共享 Client，伪装 UA）、`serde_json`、`tokio`（并发）、`aes`/`cbc`/`rsa`/`rand`（网易云加密）、`base64`（QQ 歌词解码）。
- 契约落点：`MusicSourceId` 枚举（Netease/QqMusic/Migu）、`SongCandidate`/`SearchResult`/`SearchError` struct；`search_song`/`fetch_lyric`/`download_cover` command。
- **实现参照**：xhongc/music-tag-web（music_resource.py / encrypt.py / qm.py / task/utils.py），Rust 移植保持接口、参数、加密算法一致；详见 design.md 的 Decisions 实现参照节。
- 纯 backend，无前端改动；`v1-search-ui` 在前端消费这些 command。
