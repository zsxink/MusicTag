# search-sources Specification

## Purpose
MusicTag V1 多源搜索能力（FR-8.5/8.6/8a）：网易云 + QQ 音乐 + 酷狗 + LRCLIB + iTunes 五家并发搜索、打分去重聚合、候选惰性拉取（点选才取歌词/封面）、网易云 linuxapi 加密（搜索/取词均走 `/api/linux/forward` 转发，weapi 搜索路径 2026 起被风控弃用）。后端纯能力，供 `v1-search-ui` 前端搜索联动消费。v1-search-fixes 补充：`SearchResult.all_failed`（区分全源失败与正常空结果，供离线判定）与单源 `search_source`（C2 换源逐源拿原始候选）。v1-multi-source-candidates 修订：聚合从「跨源折叠」改为「同源折叠、跨源全保留」，每源 TOP 3 + 来源分组排序。
## Requirements
### Requirement: 打分去重排序
搜索结果 SHALL 按 title/artist/album 相等与包含打分，归一化（trim + 全角半角 + 小写折叠）**按来源分组去重**：**同一来源内**同曲（归一化 title/artist 相同）只保留该源得分最高一条；**不同来源之间不折叠**，各源候选各自保留。排序**先按来源分组**（Netease→QqMusic→Kugou→Lrclib→Itunes），组内按分降序；每源保留 TOP 3（最多 5×3=15 条）。album 参与打分时仅对非空 album 计分。

#### Scenario: 打分排序
- **WHEN** 多源返回候选
- **THEN** 按打分（title 相等 0.5 + artist 相等 0.4 + title 包含 0.2 + artist 包含 0.1 + album 相等 0.3）降序

#### Scenario: 同源去重
- **WHEN** **同一来源**返回同一首歌的两个版本（归一化 title/artist 相同，如网易云精确版 + 演唱会版）
- **THEN** 该源只保留得分最高的一条（精确匹配那条）

#### Scenario: 跨源保留（不折叠）
- **WHEN** **两家不同来源**返回同一首歌（如网易云 + QQ 都返回「粗糙|许嵩|安泊猜想」）
- **THEN** 两家候选**各自保留**、并排展示（各带来源 badge），互不折叠——封面候选因此能同时看到网易云/QQ/iTunes 的封面

#### Scenario: 空查询守卫
- **WHEN** 查询或候选 title/artist 为空
- **THEN** 不给匹配分（防空串互相包含的退化命中），title 零关联的候选被过滤

#### Scenario: album 加分仅限非空
- **WHEN** 候选 album 为空或查询 album 为空
- **THEN** album 维度不计分，排序仍由 title/artist 维度决定（空 album 不拉低或抬高排名）

#### Scenario: 每源上限与排序
- **WHEN** 五源各自返回 >3 条候选
- **THEN** 每源只保留该源得分最高 TOP 3；列表按来源分组排序（Netease→QqMusic→Kugou→Lrclib→Itunes），组内按分降序，最多 15 条

### Requirement: 候选惰性拉取
候选 SHALL 秒出（封面 URL 随搜索带出）；点选歌词候选才 `fetch_lyric` 取文本，点选封面才 `download_cover` 下载。

#### Scenario: 歌词惰性
- **WHEN** 候选列表展示时
- **THEN** 不预取歌词文本；点选某候选行才 `fetch_lyric(source, id)`

#### Scenario: 封面惰性
- **WHEN** 候选列表展示时
- **THEN** 不预下载封面；点选某候选封面才 `download_cover(url)`（单独 5s 超时）

### Requirement: 单源搜索（C2 换源支撑）
`search_source(source, title, artist, album)` SHALL 只搜索指定单一来源并返回该源原始候选（不做跨源聚合去重），失败/超时返回空列表，供前端 C2 取词失败换源时拿到「其他来源对同一首歌的候选」。

#### Scenario: 单源返回
- **WHEN** 调用 `search_source('qqmusic', title, artist, album)`
- **THEN** 返回该源原始候选（同一 6s 超时；失败/超时 → 空列表），查询关键词综合 title + artist + album

#### Scenario: 不被聚合去重折叠
- **WHEN** 多家返回同一首歌（归一化 title/artist 相同）
- **THEN** `search_source` 逐源各自返回该源原始候选（不经 `search_song` 的同源去重与每源 TOP 3 截断），C2 换源因此可拿到其他源的完整候选

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
`search_song(title, artist, album)` SHALL 并发调用网易云 + QQ 音乐 + 酷狗 + LRCLIB + iTunes 五家，每家 6s 超时；单源失败降级为空列表并记入 `source_stats`。

#### Scenario: 五源并发
- **WHEN** 调用 `search_song(title, artist, album)`
- **THEN** 五家源并发搜索（查询关键词综合 title + artist + album），返回聚合候选列表与 `source_stats`（各家返回条数）

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
LRCLIB SHALL 提供歌词候选与取词：`GET /api/search?track_name=&artist_name=&album_name=` 返回候选，`GET /api/get`（track_name/artist_name/album_name/duration）返回 `syncedLyrics`/`plainLyrics`。零鉴权，请求带描述性 User-Agent。

#### Scenario: 搜索候选
- **WHEN** 调用 LRCLIB 搜索（track_name + artist_name + album_name）
- **THEN** 返回候选列表（title/artist/album/id），无封面 URL

#### Scenario: 取词
- **WHEN** 点选 LRCLIB 候选 `fetch_lyric`
- **THEN** 返回 LRC 歌词文本（`syncedLyrics` 优先，空回退 `plainLyrics`）

### Requirement: iTunes 封面源
iTunes Search SHALL 提供带封面 URL 的候选：`GET https://itunes.apple.com/search?term=<title> <artist> <album>&country=CN&media=music&entity=song`；`artworkUrl100` 作封面 URL，无歌词。

#### Scenario: 搜索封面候选
- **WHEN** 调用 iTunes 搜索（country=CN，term 综合 title + artist + album）
- **THEN** 返回候选列表（title/artist/album/cover_url=artworkUrl100）

#### Scenario: 无歌词降级
- **WHEN** 点选 iTunes 候选 `fetch_lyric`
- **THEN** 返回 None，前端 C2 换源从其他源取词

### Requirement: 查询关键词综合透传
五源搜索的查询关键词 SHALL 综合 title + artist + album 三段拼接（`"<title> <artist> <album>"`，逐段仅当非空时加入，段间单空格），替代当前仅 title（部分源甚至忽略 artist）的关键词；album 为空时不参与拼接，回退为既有的 title（+artist）行为，不改动无专辑文件的搜索路径。

#### Scenario: 三字段齐全
- **WHEN** 搜索 title=「晴天」、artist=「周杰伦」、album=「叶惠美」
- **THEN** 五源查询关键词均拼入三段（网易云 `params.s`、QQ `w`、酷狗 `keyword`、iTunes `term` 为「晴天 周杰伦 叶惠美」；LRCLIB 走 `track_name`/`artist_name`/`album_name` 三参数）

#### Scenario: album 为空回退
- **WHEN** 搜索 title=「晴天」、artist=「周杰伦」、album 为空
- **THEN** 查询关键词回退为「晴天 周杰伦」（LRCLIB 不带 `album_name`），与现行为一致，不影响搜索结果

#### Scenario: 空串防退化
- **WHEN** 查询或候选 title/artist/album 任一为空
- **THEN** 空段不参与查询拼接与匹配分，不给退化命中机会（同既有 title/artist 防空串守卫）

#### Scenario: 字段缺失回退
- **WHEN** 歌名/歌手/专辑任一或全部缺失（空串）
- **THEN** 缺失段不参与查询拼接与打分：仅歌名空 → 不发起自动搜索，填歌名后走手动按钮（FR-8.13 既有）；仅歌手空 → 关键词退化为「歌名 专辑」；仅专辑空 → 关键词退化为「歌名 歌手」；全空 → 空串由后端过滤不搜，album 维度不计分

