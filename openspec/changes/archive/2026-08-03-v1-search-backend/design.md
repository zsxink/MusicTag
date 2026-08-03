## Context

V1 搜索能力（FR-8）的 Rust 后端：三家源并发搜索、打分去重、惰性拉取。对标 music-tag-web 的 `MusicResource` 工厂 + `smart_tag` 架构。本变更提供 `search_song` / `fetch_lyric` / `download_cover` 三个 command 的纯后端能力；前端消费在 `v1-search-ui`。

## Goals / Non-Goals

**Goals:**
- 统一 Trait `MusicSource` + 三源实现（netease / qqmusic / migu）。
- `tokio::join_all` 三源并发 + 单源 6s 超时 + `source_stats`。
- 按 spec 权重的打分去重排序。
- 惰性拉取：候选只带 id + cover_url，歌词/封面点选才拉。
- 网易云 weapi / linuxapi 手写加密（无 JS 引擎）。

**Non-Goals:**
- 不做前端候选 UI、触发模型、离线降级状态判定、取词换源编排（均为 `v1-search-ui`）。
- 不做简繁转换（V1-PRD §7：归一化不含简繁）。
- 不引入独立 `SearchError` 类型（契约 §10.3：错误一律 `Result<T, String>`）。
- 不做请求缓存 / 重试策略（每次调用单次查询）。

## 变更域判定

**纯 backend**：全部改动在 `src-tauri/`（新增 Cargo 依赖、`model.rs` 契约类型、`service/searcher/` 子模块、`commands/search.rs`、`lib.rs` 注册）。前端零改动，不触碰 `src/`。

**依赖顺序**：本变更无前置变更（只新增依赖与模块，不修改既有 command 语义）；后续 `v1-search-ui` 依赖本变更的 command 契约。串行顺序：`v1-search-backend` → `v1-search-ui`。本变更内部单角色（Rust-Dev），无前后端并行，无需 worktree。

**落位（服从 design.md §10.4，结构守卫约束）**：Rust 业务在 `service/searcher/`（子模块），命令薄壳在 `commands/search.rs`，`lib.rs` `generate_handler!` 注册。**禁止新建平级目录**——V1-PRD §302 的顶层 `search/` 写法已被 §10.4 定稿收敛为 `service/searcher/`。

## 模块结构与数据流

```
src-tauri/src/
├── model.rs               # + MusicSourceId / SongCandidate / SearchResult（IPC 契约，serde 冻结）
├── service/
│   └── searcher/          # 纯业务：加密、三家客户端、聚合打分（无 Tauri 依赖，单测内联）
│       ├── mod.rs         #   MusicSource trait + client() 共享 Client + aggregate() 聚合打分 + 归一化
│       ├── crypto.rs      #   weapi / linuxapi 加密原语（aes-cbc / aes-ecb / rsa modpow）
│       ├── netease.rs     #   网易云：weapi 搜索 + linuxapi 取词 + 响应解析
│       ├── qqmusic.rs     #   QQ：musicu.fcg 搜索 + fcg_query_lyric 取词（base64 解码）+ 响应解析
│       └── migu.rs        #   咪咕：scr_search_tag 搜索 + getLyric 取词 + 响应解析
└── commands/
    └── search.rs          # 薄壳：search_song / fetch_lyric / download_cover
```

数据流：

```
选中歌曲（v1-search-ui）
  → invoke('search_song', { title, artist })
  → commands/search.rs 薄壳
  → service::searcher::search_song(&client, title, artist)
      → JoinSet 并发（每源独立 spawn + tokio::time::timeout 单源 6s）  // 超时/失败 → 该源空列表 + source_stats 记 0
      → aggregate()：合并 → 打分去重排序 → 前 N（10）条
  → SearchResult { songs: Vec<SongCandidate>, source_stats: Vec<(MusicSourceId, usize)> }

点选歌词行（v1-search-ui）
  → invoke('fetch_lyric', { source, id })
  → service::searcher::fetch_lyric(&client, source, id) -> Option<String>   // None = 取词失败/无词（C2 换源）

点选封面缩略图（v1-search-ui）
  → invoke('download_cover', { url })
  → service::searcher::download_cover(&client, url) -> Result<Vec<u8>, String>  // 5s 超时 + 响应体限流
```

## Decisions

> **实现参照**：xhongc/music-tag-web（`applications/task/services/music_resource.py` 的 `NetEaseMusicClient`/`MiGuMusicClient`/`QmusicClient`、`applications/utils/encrypt.py` 的 `weEncrypt`/`linuxEncrypt`、`applications/task/services/qm.py` 的 `QQMusicApi`、`applications/task/utils.py` 的 `match_score`/`match_artist`）。本变更从 Python 移植到 Rust：接口 URL、参数、加密算法保持一致；打包（`ThreadPoolExecutor`）改为 Rust `tokio::join_all`；简繁转换（`zhconv`）按 V1 约定不做；**打分权重以 spec 为准（见 D3），`match_score`/`match_artist` 仅参考其归一化与多艺人处理思路**。

### D1 模块落位：service/searcher/（服从 design.md §10.4）

加密（aes/cbc/rsa）与三家 HTTP 聚合是纯逻辑、无 Tauri 依赖 → 放 service 层（§10.4 落位说明明示「searcher 的加密与三家 HTTP 聚合…放 service 层（单元测试内联）」）。命令在 `commands/search.rs` 只做参数接收 + 委托。**为什么**：保持「薄 command 壳 → 纯业务 service → 数据模型」分层不变量（§10.0），service 函数接受 `&reqwest::Client` 参数、可脱离 Tauri 直接单测。V1-PRD §302 的顶层 `search/` 写法已被 §10.4 定稿收敛，不得新建平级目录。

### D2 共享 Client、超时与限流

`service::searcher::client() -> &'static reqwest::Client`：`OnceLock<Client>` 惰性构建一次——`Client::builder().timeout(6s).build()`。**为什么**：三家并发搜索复用连接池，避免每次调用重建 Client；6s 即 spec 冻结的单源超时。

- 各源请求头：共享 Client 设默认浏览器 UA；网易云按 `userAgents` 列表随机取一个（伪装，降低风控）；QQ 覆盖为 `QQ音乐/73222 CFNetwork/1406.0.3 Darwin/22.4.0`（URL 编码）+ `Referer: https://y.qq.com/portal/profile.html`；咪咕覆盖为 Firefox UA + `Referer: https://m.music.migu.cn/`。
- `download_cover`：请求级 `client.get(url).timeout(5s)`；响应体限流——`Content-Length > 12MB` 直接拒绝，且流式读取设 12MB 上限（防内存放大）。失败返回 `Err(String)`，前端静默忽略该张候选（验收 #12）。
- **为什么 6s / 5s**：spec 冻结：单源搜索 6s、封面下载 5s。
- 三个 command 均为 `async fn`：Tauri 在异步运行时执行，不阻塞 WebView 主线程（FR-8.12a 后台异步，前端可同时继续编辑）。
- **并发机制**：`tokio::task::JoinSet` 每源独立 spawn，`tokio::time::timeout(6s, fut)` 包单源超时——`join_all` 无法对单源单独超时（一家卡死会拖住聚合），故用 JoinSet；spec 只冻结「并发 + 6s 超时」，未冻结具体机制。聚合抽 `search_song_with_sources(client, title, artist, sources, timeout)` seam——源列表与超时可注入，供超时降级单测不联网（同款 seam：`download_cover_with_timeout`）。
- **依赖**：`MusicSource` 为 `#[async_trait]` trait（新增 `async-trait` crate）；`reqwest` 开 `json` + `form` features（QQ musicu.fcg JSON body / 网易云 weapi、linuxapi 的 form 编码 / 咪咕 GET）。

### D3 打分去重严格按 spec 权重

权重冻结（spec `打分去重排序` + V1-PRD §305）：

- 归一化 `norm(s)`：trim + 全角转半角 + `to_lowercase`（V1 不做简繁）。
- `title_match(q, t)`：`norm(q) == norm(t)` → 0.5；否则互相包含（`q⊆t` 或 `t⊆q`）→ 0.2；否则 0。
- `artist_match(q, a)`：`norm(q) == norm(a)` → 0.4；否则互相包含 → 0.1；否则 0。候选 artist 含 `,`/`/`（多艺人）→ 对每段分别打分取 **max**（保持权重上限，不求和溢出）；**空查询 / 空候选 artist 直接给 0**（防空串互相包含的退化命中——spec 未定义，不自行加项）。
- `score = title_match + artist_match`（上限 0.9）。**无 album 项**——spec 未定义，不自行加项。
- 过滤 `title_match == 0` 的候选（与查询 title 零关联不进候选集，避免噪音）。
- 去重：按归一化 `(norm(title), norm(artist))` 分组，保留最高分；同分按来源顺序稳定排序（Netease → QqMusic → Migu），保证结果可复现。
- 排序：score 降序 → 前 N（N = 10，候选区展示足够、控制 IPC 载荷）。

**为什么改掉旧版 2/1/0 + album_score**：旧 design 对标 music-tag-web 的整数评分（全等 2 / 包含 1 / 否则 0 + album_score + artist 空分 -2 惩罚）与已批准 spec 的 0.5 / 0.4 / 0.2 / 0.1 权重冲突。设计服从规格——权重以 spec 为准，`match_artist` 的多艺人 split 思路保留但收敛为「分段取 max」。

### D4 网易云加密（weapi / linuxapi 手写）

对照 music-tag-web `encrypt.py` 的 `weEncrypt` / `linuxEncrypt` 移植到 Rust（无 JS 引擎）。常量与算法逐字一致：

- 常量：`NONCE = b"0CoJUm6Qyw8W8jud"`、`LINUXKEY = b"rFgB&h#%2?^eDg:Q"`、`PUBKEY = "010001"`、`MODULUS`（256 hex，同参照库）。
- weapi：`secret = hexlify(urandom(16))[:16]`（16 字符 hex 串当 AES 密钥）；第一层 AES-CBC（NONCE 密钥 + iv `0102030405060708` + PKCS7，base64）→ 第二层 AES-CBC（secret 密钥 + 同 iv + base64）→ `params`；`encSecKey = hex(modpow(secret, PUBKEY, MODULUS))` 左补零 256 位。
- linuxapi：AES-ECB（LINUXKEY，无 iv）→ hex 大写 → `{ eparams }`；`method: POST` 注入。
- **RSA 用 `rsa::BigUint::modpow`**（=`pow(int(secret), PUBKEY, MODULUS)`，需 secret 反转后 hex→BigUint），结果 hex 左补零 256 位。
- **已知向量 / 往返单测锁算法**——防止移植走样（这是纯算法，最容易悄悄写错的地方）。

### D5 惰性拉取 + C2 换源支撑

`search_song` 候选只带 `id` + `cover_url`（三家搜索响应自带封面 URL，候选秒出、零额外请求）；歌词文本与封面 bytes 一律点选才拉（spec `候选惰性拉取`）。`fetch_lyric -> Option<String>`：None 表示该源取词失败/无词，前端（v1-search-ui）据此换另一家源重试同一首歌（FR-8.8a / C2），Rust 侧不做换源编排。

### D6 MusicSourceId serde 契约（冻结形状）

`model.rs` 新增 `enum MusicSourceId { Netease, QqMusic, Migu }`，serde 输出字面量 `"netease" | "qqmusic" | "migu"`。**陷阱**：`rename_all = "snake_case"` 会把 `QqMusic` 序列化成 `"qq_music"`，必须显式 `#[serde(rename = "qqmusic")]`——与 `LyricsSource::SidecarLrc` 显式 `rename = "sidecar"` 同款教训（见 model.rs 注释）。冻结契约单测断言序列化/反序列化形状。

### D7 契约落点 model.rs，错误一律 String

`MusicSourceId` / `SongCandidate` / `SearchResult` 放 `model.rs`（§10.0：model.rs = 数据类型，与前端 TS 类型对齐）。字段以 §10.3 契约为准：

- `SongCandidate { source: MusicSourceId, id: String, title: String, artist: String, album: String, cover_url: Option<String> }`——**无 year 字段**（§10.3 TS 未定义，各家 `publishTime`/`year` 不映射）。
- `SearchResult { songs: Vec<SongCandidate>, source_stats: Vec<(MusicSourceId, usize)> }`——元组序列化为 `[source, count]` 数组，对齐 §10.3 TS `Array<[MusicSourceId, number]>`。
- **错误**：proposal 曾提 `SearchError` struct，但契约 §10.3 已冻结 `download_cover -> Result<Vec<u8>, String>` 等一律 `Result<T, String>`，不引入独立错误类型（避免过度设计）。

### D8 source_stats 语义（离线判定支撑）

`source_stats` 每家记「成功返回的候选条数」；单源超时/失败 → 该源记 0。三源全 0 → 前端（v1-search-ui）判定会话离线（FR-8.4a 失败首响）。**为什么**：离线判定是前端逻辑（本变更 non-goal），Rust 侧只提供可判定的事实（条数），不做会话级状态标记。

## 规格覆盖

| spec requirement | 设计落点 |
|---|---|
| 三源并发搜索（6s 超时、降级空列表、source_stats） | D2 / D8 + `search_song`（`tokio::join_all` + `time::timeout`） |
| 打分去重排序（0.5/0.4/0.2/0.1 降序、归一化去重） | D3 + `aggregate()` |
| 候选惰性拉取（封面 URL 随搜索带出、点选才拉） | D5 |
| 网易云加密（weapi/linuxapi 手写） | D4 + `crypto.rs` / `netease.rs` |
| 取词失败换源（fetch_lyric -> Option<String>，None 供前端换源） | D5 |

## Risks / Trade-offs

- 网易云接口与加密算法随平台变动失效：封装在 `netease.rs`，失效时单源降级不影响其余两家。
- 各家响应结构各异：serde 各自 model，统一映射为 `SongCandidate`；空字段兜底（QQ album 空 → `未分类专辑`，cover_url 空 → `None`）。
- 打分权重与参照库不完全一致（spec 收敛）：以 spec 为准，`match_score`/`match_artist` 仅参考思路，避免与已批准 spec 冲突。
- `download_cover` 只返回裸 `Vec<u8>`（契约 §10.3 冻结）：mime 解析、压缩、data URL 转换在前端 `v1-search-ui`（`api/search.ts`）完成，本变更不涉及。
