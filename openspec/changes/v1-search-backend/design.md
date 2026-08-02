## Context

V1 搜索能力（FR-8）的 Rust 后端：三家源并发搜索、打分去重、惰性拉取。对标 music-tag-web 的 `MusicResource` 工厂 + `smart_tag` 架构。

## Goals / Non-Goals

**Goals:**
- 统一 Trait `MusicSource`：`search(title, artist) -> Vec<SongCandidate>` + `fetch_lyric(song_id) -> Option<String>`。
- 三源并发（`tokio::join_all`）+ 6s 单源超时 + `source_stats`。
- 打分去重 + 惰性拉取 + 网易云 weapi/linuxapi 手写加密。

**Non-Goals:**
- 不做前端候选 UI（`v1-search-ui`）。
- 不做离线降级的状态判定（前端逻辑，`v1-search-ui`）。
- 不做简繁转换（PRD §7：归一化不含简繁）。

## Decisions

- **模块结构**：`src-tauri/src/search/mod.rs`（Trait + 聚合入口）+ `netease.rs` + `qqmusic.rs` + `migu.rs`。
- **统一 Trait**：
  ```rust
  trait MusicSource {
      async fn search(&self, title: &str, artist: &str) -> Vec<SongCandidate>;
      async fn fetch_lyric(&self, song_id: &str) -> Option<String>;
  }
  ```
  `SongCandidate { source: MusicSourceId, id, title, artist, album, cover_url }`。
- **reqwest**：共享 `Client`（伪装 UA），带 6s 超时；`download_cover` 单独 5s 超时 + 响应大小限流。
- **网易云加密**：weapi（搜索）+ linuxapi（取歌词）。参数加密：`aes`/`cbc`（pkcs7）+ `rsa`（公钥加密 secretKey）+ `rand`（随机 16 字节 key）；响应 JSON 解密解析。无 JS 引擎（PRD §7「无第三方依赖」= 无 PyExecJS 类）。
- **QQ 音乐**：`musicu.fcg` JSON 协议（`comm`/`req_1` 参数），纯 HTTP 无加密。
- **咪咕**：`migu/remoting/scr_search_tag` 搜索 + `msgs/{copyrightId}.json` 取歌词，纯 HTTP 无加密。
- **打分**：`title 相等 0.5 + artist 相等 0.4 + title 包含 0.2 + artist 包含 0.1`；归一化 = trim + 全角半角（不做简繁）；按归一化 `(title, artist)` 去重保留最高分。
- **`search_song(title, artist) -> SearchResult`**：`tokio::join_all` 三源 → 打分去重 → 前 N（如 10）条；`source_stats: Vec<(MusicSourceId, usize)>`。
- **`fetch_lyric(source, id)`**：单源取歌词，None 表失败/无词（支撑 C2 前端换源）。
- **`download_cover(url) -> Vec<u8>`**：下载封面 bytes，限流 + 超时；失败返回 Err（前端静默忽略该张候选，FR-8 验收 #12）。

## Risks / Trade-offs

- 网易云接口与加密会随平台变动失效：封装在 `netease.rs`，失效时单源降级不影响其余两家。
- 各家接口返回结构各异：serde 解析各自 model，统一映射为 `SongCandidate`。
- 加密算法手写需严格测试（已知向量/往返），保证与官方 weapi 兼容。
