## 1. Rust：加密原语与网易云客户端

- [ ] 1.1 实现 AES-CBC（pkcs7）+ RSA 加密工具模块，含单元测试（往返/已知向量）
- [ ] 1.2 实现网易云 weapi 参数加密（`aes`/`cbc`/`rsa`/`rand`，随机 16 字节 key + 公钥加密）
- [ ] 1.3 实现网易云搜索（weapi）：title+artist → `Vec<SongCandidate>`
- [ ] 1.4 实现网易云取歌词（linuxapi）：song_id → `Option<String>`
- [ ] 1.5 网易云加密与搜索测试（构造 mock 响应，验证加密参数结构与解析）

## 2. Rust：QQ + 咪咕客户端

- [ ] 2.1 实现 QQ 音乐搜索（`musicu.fcg` JSON 协议）：→ `Vec<SongCandidate>`
- [ ] 2.2 实现 QQ 音乐取歌词：song_id → `Option<String>`
- [ ] 2.3 实现咪咕搜索（`scr_search_tag`）：→ `Vec<SongCandidate>`
- [ ] 2.4 实现咪咕取歌词（`msgs/{id}.json`）：→ `Option<String>`
- [ ] 2.5 各客户端解析测试（mock 响应结构）

## 3. Rust：聚合 + 打分 + 惰性拉取

- [ ] 3.1 定义 `MusicSourceId`/`SongCandidate`/`SearchResult`/`SearchError` struct 与 serde
- [ ] 3.2 `search/mod.rs`：统一 Trait `MusicSource` + `search_song` 聚合入口（`tokio::join_all` 三源并发）
- [ ] 3.3 单源 6s 超时 + 失败降级空列表 + `source_stats`
- [ ] 3.4 打分函数：title/artist 相等 + 包含权重；归一化（trim + 全角半角）+ 去重保留最高分
- [ ] 3.5 `download_cover(url) -> Result<Vec<u8>, String>`：5s 超时 + 响应限流
- [ ] 3.6 实现 `search_song`/`fetch_lyric`/`download_cover` command 并注册
- [ ] 3.7 聚合/打分/去重/超时降级测试

## 4. 验证

- [ ] 4.1 `cargo test` + `cargo clippy` 通过（加密、解析、聚合、打分测试）
- [ ] 4.2 真机冒烟（可选）：联网手动调用 `search_song` 确认三家源可搜
