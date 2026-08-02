## ADDED Requirements

### Requirement: 三源并发搜索
`search_song(title, artist)` SHALL 并发调用网易云 + QQ 音乐 + 咪咕三家，每家 6s 超时；单源失败降级为空列表并记入 `source_stats`。

#### Scenario: 三源并发
- **WHEN** 调用 `search_song(title, artist)`
- **THEN** 三家源并发搜索，返回聚合候选列表与 `source_stats`（各家返回条数）

#### Scenario: 单源超时降级
- **WHEN** 某家源 6s 内无响应
- **THEN** 该源降级为空列表，`source_stats` 记为 0，其余源结果不受影响

#### Scenario: 全源失败
- **WHEN** 三家全部失败（断网/超时）
- **THEN** 返回空候选，`source_stats` 全 0，供前端离线降级判定

### Requirement: 打分去重排序
搜索结果 SHALL 按 title/artist 相等与包含打分，归一化（trim + 全角半角）去重保留最高分，按分数排序返回。

#### Scenario: 打分排序
- **WHEN** 多源返回候选
- **THEN** 按打分（title 相等 0.5 + artist 相等 0.4 + title 包含 0.2 + artist 包含 0.1）降序

#### Scenario: 去重
- **WHEN** 两家源返回同一首歌（归一化 title/artist 相同）
- **THEN** 仅保留最高分的一条

### Requirement: 候选惰性拉取
候选 SHALL 秒出（封面 URL 随搜索带出）；点选歌词候选才 `fetch_lyric` 取文本，点选封面才 `download_cover` 下载。

#### Scenario: 歌词惰性
- **WHEN** 候选列表展示时
- **THEN** 不预取歌词文本；点选某候选行才 `fetch_lyric(source, id)`

#### Scenario: 封面惰性
- **WHEN** 候选列表展示时
- **THEN** 不预下载封面；点选某候选封面才 `download_cover(url)`（单独 5s 超时）

### Requirement: 网易云加密
网易云搜索与取歌词 SHALL 用 weapi/linuxapi 协议，Rust 侧 `aes`/`cbc`/`rsa`/`rand` 手写加密（无 JS 引擎）。

#### Scenario: 加密请求
- **WHEN** 发起网易云搜索/取歌词请求
- **THEN** 用 weapi/linuxapi 加密参数发送，正确解密响应

### Requirement: 取词失败换源（C2 支撑）
`fetch_lyric(source, id)` SHALL 返回 `Option<String>`，None 表示取词失败，供前端自动换另一家源重试同一首歌。

#### Scenario: 取词成功
- **WHEN** `fetch_lyric(source, id)` 取到歌词
- **THEN** 返回 `Some(lyric_text)`

#### Scenario: 取词失败
- **WHEN** 该源取歌词失败/无歌词
- **THEN** 返回 `None`，供前端换源重试
