## RENAMED Requirements

### Requirement: 三源并发搜索
FROM: ### Requirement: 三源并发搜索
TO: ### Requirement: 五源并发搜索

## MODIFIED Requirements

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

### Requirement: 网易云加密
网易云搜索与取歌词 SHALL 用 linuxapi 协议（Rust 侧 `aes`/`cbc`/`rsa`/`rand` 手写加密，无 JS 引擎）：搜索经 `/api/linux/forward` 转发 `/api/cloudsearch/pc`，取歌词经 `/api/linux/forward` 转发 `/api/song/lyric`。不再使用 weapi 搜索路径（2026 起该路径被风控空响应）。

#### Scenario: 加密请求
- **WHEN** 发起网易云搜索/取歌词请求
- **THEN** 用 linuxapi 加密参数发送，正确解密响应

#### Scenario: 搜索可用
- **WHEN** 调用网易云搜索（linuxapi 转发 `/api/cloudsearch/pc`）
- **THEN** 正常返回候选（响应结构 `result.songs[]` 同 weapi，解析不变）

## ADDED Requirements

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
