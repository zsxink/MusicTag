# search-sources Specification

## Purpose
MusicTag V1 多源搜索能力（FR-8.5/8.6/8a）：网易云 + QQ 音乐 + 酷狗 + LRCLIB + iTunes 五家并发搜索、打分去重聚合、候选惰性拉取（点选才取歌词/封面）、网易云 linuxapi 加密（搜索/取词均走 `/api/linux/forward` 转发，weapi 搜索路径 2026 起被风控弃用）。后端纯能力，供 `v1-search-ui` 前端搜索联动消费。v1-search-fixes 补充：`SearchResult.all_failed`（区分全源失败与正常空结果，供离线判定）与单源 `search_source`（C2 换源绕过聚合去重）。
## Requirements
### Requirement: 打分去重排序
搜索结果 SHALL 按 title/artist 相等与包含打分，归一化（trim + 全角半角 + 小写折叠）去重保留最高分，按分数排序返回。

#### Scenario: 打分排序
- **WHEN** 多源返回候选
- **THEN** 按打分（title 相等 0.5 + artist 相等 0.4 + title 包含 0.2 + artist 包含 0.1）降序

#### Scenario: 去重
- **WHEN** 两家源返回同一首歌（归一化 title/artist 相同）
- **THEN** 仅保留最高分的一条

#### Scenario: 空查询守卫
- **WHEN** 查询或候选 title/artist 为空
- **THEN** 不给匹配分（防空串互相包含的退化命中），title 零关联的候选被过滤

### Requirement: 候选惰性拉取
候选 SHALL 秒出（封面 URL 随搜索带出）；点选歌词候选才 `fetch_lyric` 取文本，点选封面才 `download_cover` 下载。

#### Scenario: 歌词惰性
- **WHEN** 候选列表展示时
- **THEN** 不预取歌词文本；点选某候选行才 `fetch_lyric(source, id)`

#### Scenario: 封面惰性
- **WHEN** 候选列表展示时
- **THEN** 不预下载封面；点选某候选封面才 `download_cover(url)`（单独 5s 超时）

### Requirement: 单源搜索（C2 换源支撑）
`search_source(source, title, artist)` SHALL 只搜索指定单一来源并返回该源原始候选（不做跨源聚合去重），失败/超时返回空列表，供前端 C2 取词失败换源时拿到「其他来源对同一首歌的候选」。

#### Scenario: 单源返回
- **WHEN** 调用 `search_source('qqmusic', title, artist)`
- **THEN** 返回该源原始候选（同一 6s 超时；失败/超时 → 空列表）

#### Scenario: 不被聚合去重折叠
- **WHEN** 多家返回同一首歌（归一化 title/artist 相同）
- **THEN** `search_source` 逐源各自返回该曲候选（`search_song` 聚合才去重折叠），C2 换源因此可拿到其他源

### Requirement: 网易云加密
网易云搜索与取歌词 SHALL 用 linuxapi 协议（Rust 侧 `aes`/`cbc`/`rsa`/`rand` 手写加密，无 JS 引擎）：搜索经 `/api/linux/forward` 转发 `/api/cloudsearch/pc`，取歌词经 `/api/linux/forward` 转发 `/api/song/lyric`。不再使用 weapi 搜索路径（2026 起该路径被风控空响应）。

#### Scenario: 加密请求
- **WHEN** 发起网易云搜索/取歌词请求
- **THEN** 用 linuxapi 加密参数发送，正确解密响应

#### Scenario: 搜索可用
- **WHEN** 调用网易云搜索（linuxapi 转发 `/api/cloudsearch/pc`）
- **THEN** 正常返回候选（响应结构 `result.songs[]` 同 weapi，解析不变）

### Requirement: 取词失败换源（C2 支撑）
`fetch_lyric(source, id)` SHALL 返回 `Option<String>`，None 表示取词失败，供前端自动换另一家源重试同一首歌。

#### Scenario: 取词成功
- **WHEN** `fetch_lyric(source, id)` 取到歌词
- **THEN** 返回 `Some(lyric_text)`

#### Scenario: 取词失败
- **WHEN** 该源取歌词失败/无歌词
- **THEN** 返回 `None`，供前端换源重试

### Requirement: 五源并发搜索
`search_song(title, artist)` SHALL 并发调用网易云 + QQ 音乐 + 酷狗 + LRCLIB + iTunes 五家，每家 6s 超时；单源失败降级为空列表并记入 `source_stats`。

#### Scenario: 五源并发
- **WHEN** 调用 `search_song(title, artist)`
- **THEN** 五家源并发搜索，返回聚合候选列表与 `source_stats`（各家返回条数）

#### Scenario: 单源超时降级
- **WHEN** 某家源 6s 内无响应
- **THEN** 该源降级为空列表，`source_stats` 记为 0，其余源结果不受影响

#### Scenario: 全源失败标记
- **WHEN** 五家全部失败（断网/超时）
- **THEN** 返回空候选、`source_stats` 全 0、`all_failed=true`，供前端会话离线判定（FR-8.4a）

#### Scenario: 全源成功但空
- **WHEN** 五家均正常返回但无匹配候选（冷门歌）
- **THEN** `all_failed=false`，不得标记会话离线（无结果 ≠ 全源失败）

### Requirement: 酷狗签名搜索
酷狗源 SHALL 用 `complexsearch.kugou.com/v2/search/song` + MD5 签名（`NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt` secret 包裹参数字符串），返回候选含 `fileHash` 供后续取 KRC 歌词。签名纯 Rust 实现（新增 `md5` 依赖），无 JS 引擎。

#### Scenario: 签名搜索
- **WHEN** 调用酷狗搜索
- **THEN** 用 MD5 签名参数请求，正常返回候选列表

#### Scenario: 签名错误降级
- **WHEN** 签名无效被拒（`error_code:20006`）
- **THEN** 该源计为失败、降级为空列表，不影响其余源

### Requirement: LRCLIB 歌词源
LRCLIB SHALL 提供歌词候选与取词：`GET /api/search?track_name=&artist_name=` 返回候选，`GET /api/get`（track_name/artist_name/album_name/duration）返回 `syncedLyrics`/`plainLyrics`。零鉴权，请求带描述性 User-Agent。

#### Scenario: 搜索候选
- **WHEN** 调用 LRCLIB 搜索（track_name + artist_name）
- **THEN** 返回候选列表（title/artist/album/id），无封面 URL

#### Scenario: 取词
- **WHEN** 点选 LRCLIB 候选 `fetch_lyric`
- **THEN** 返回 LRC 歌词文本（`syncedLyrics` 优先，空回退 `plainLyrics`）

### Requirement: iTunes 封面源
iTunes Search SHALL 提供带封面 URL 的候选：`GET https://itunes.apple.com/search?term=<title> <artist>&country=CN&media=music&entity=song`；`artworkUrl100` 作封面 URL，无歌词。

#### Scenario: 搜索封面候选
- **WHEN** 调用 iTunes 搜索（country=CN）
- **THEN** 返回候选列表（title/artist/album/cover_url=artworkUrl100）

#### Scenario: 无歌词降级
- **WHEN** 点选 iTunes 候选 `fetch_lyric`
- **THEN** 返回 None，前端 C2 换源从其他源取词

