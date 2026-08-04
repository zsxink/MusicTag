## Context

MusicTag V1 的搜索后端（`src-tauri/src/service/searcher/`）三源并发：网易云 weapi + QQ `musicu.fcg` + 咪咕。2026-08 实测**三源接口全部失效**（Issue #84）：网易云 weapi 搜索被风控（`{"code":50000005}` / 空 body）、QQ `DoSearchForQQMusicDesktop` 返回内层 `code:2001` 空列表、咪咕 `scr_search_tag` + `getLyric` 端点废弃（301 → SPA HTML）。导致「搜索封面」「搜索歌词」均无结果。代码侧无 bug（加密正确、51 个 searcher 单测全绿），纯属外部接口漂移。参照库 music-tag-web 三年未维护，同批症状。

已实测可用替代：网易云 linuxapi 转发 `/api/cloudsearch/pc`、QQ `client_search_cp` GET、酷狗 `complexsearch.kugou.com`（MD5 签名）+ `lyrics.kugou.com` LRC、LRCLIB（歌词）、iTunes（封面 country=CN）。

## Goals / Non-Goals

**Goals:**
- 恢复「搜索封面/歌词」到可用状态，五源并发：网易云（linuxapi）+ QQ（client_search_cp）+ 酷狗（MD5 签名）+ LRCLIB（歌词）+ iTunes（封面）。
- 公共源零鉴权、零加密，长期稳定；中文源命中时打分优先，公共源自然补缺/兜底。
- 保持 `search_song`/`search_source`/`fetch_lyric` 契约不变，仅扩展 `MusicSourceId` 值域；前端搜索交互（候选列表、C2 换源、离线提示）沿用。

**Non-Goals:**
- 不改搜索触发模型（选中即搜）、候选生命周期（切歌即弃）、保存语义。
- 不引入账号/登录态（无 MUSIC_U / QQ cookie）。
- 不做批量搜索（V2）。
- 不重写离线降级模型（仍按 `all_failed` 判定，仅从三源扩到五源）。

## Decisions

### 1. 网易云搜索改走 linuxapi 转发 `/api/cloudsearch/pc`
weapi 搜索路径 2026 起被风控空响应；本项目 `crypto::linuxapi` 已实现并用于取词（一直正常）。把搜索 body 改为 `{method:"POST", url:"https://music.163.com/api/cloudsearch/pc", params:{s,type:1,limit:10,offset:0}}` POST 到 `/api/linux/forward`。响应结构 `result.songs[]` 与 weapi 相同，**解析代码零改动**。
**为什么**：复用已稳定运行的 linuxapi 取词链路，**零新增加密代码**——`crypto::linuxapi` 已有已知向量单测锁定，风险最低。替代方案 weapi 补 cookie/csrf_token——无账号拿不到稳定 cookie，弃。

### 2. QQ 搜索改走 `client_search_cp` GET
`musicu.fcg` 全 comm 变体实测 code 2001/空列表。换 `GET https://c.y.qq.com/soso/fcgi-bin/client_search_cp?p=1&n=10&w=<keyword>&format=json`，解析 `data.song.list[]`：`songmid`→id、`songname`→title、`singer[].name`→artist、`albumname`→album、`albummid`→封面模板 `T002R300x300M000{albummid}.jpg`。取词保持 `fcg_query_lyric_new.fcg`（实测正常，UA 用 ASCII 兜底）。
**为什么**：`client_search_cp` 是 QQ 公开 GET 接口、零加密零签名；响应顶层仍带 `code` 字段，**既有 `is_error_response`（`code!=0` → 源失败）判定直接复用**，无需新增业务错误分支。取词端点实测正常，保持不动缩小改动面。

### 3. 咪咕 → 酷狗（MD5 签名）
咪咕两端点全死、无签名新接口。酷狗 `complexsearch.kugou.com/v2/search/song` 需 MD5 签名（secret `NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt` 包裹按字母序拼接的查询参数字符串）——**纯 MD5**，新增 `md5` crate 即可，无 JS 引擎。响应 `data.lists[]`：`SongName`→title、`SingerName`→artist、`AlbumName`→album、`FileHash`→id。取词走 `lyrics.kugou.com`：`/search` 拿候选 `id`+`accesskey` → `/download?id=&accesskey=&fmt=lrc&charset=utf8` 返回 base64 LRC（实测可用）。
**为什么**：酷狗是目前中文词曲库最稳的免登录源之一；MD5 签名纯 Rust 一行依赖（`md5`），且**签名参数拼接是确定性的、可用已知向量单测锁定**，与 `crypto.rs` weapi/linuxapi「无 JS 引擎、已知向量锁算法」的既有哲学一致。取词两次请求（search→download）天然适配惰性拉取（点选才取词），不增加自动搜索延迟。

### 4. LRCLIB 作第 4 源（歌词）
零鉴权，`GET /api/search?track_name=&artist_name=` 返回候选（title/artist/album/id，无封面），`fetch_lyric` 按候选 id 调 `GET /api/get/{id}` 取 `syncedLyrics`（空回退 `plainLyrics`）。请求带描述性 User-Agent（lrclib 文档要求）。
**为什么**：全球社区维护的开源歌词库，**零鉴权零加密、接口稳定**，是歌词兜底的长期锚点。id 来自 search 候选，`/api/get/{id}` 一步取词（spec「`/api/get` 返回 syncedLyrics/plainLyrics」能力由此满足）。描述性 UA 是 LRCLIB 的公开约定（非浏览器伪装），请求级覆盖共享 client 的默认浏览器 UA——共享 client 结构不变。

### 5. iTunes 作第 5 源（封面）
零鉴权，`GET https://itunes.apple.com/search?term=<title> <artist>&country=CN&media=music&entity=song&limit=10`。`trackName`/`artistName`/`collectionName`/`artworkUrl100`；封面 URL 直接升为 `600x600bb`（`100x100bb`→`600x600bb` 替换，实测高清可用）。`fetch_lyric` 返回 None → 前端 C2 自动换其他源取词。
**为什么**：苹果公开搜索 API 零鉴权零签名，`artworkUrl100` 字段天然带高清模板替换规则——候选只带 URL，点选走既有 `download_cover`（5s 超时 + 12MB 限流，**零改动**）。iTunes 无歌词（`fetch_lyric` 恒 None），作为纯封面源且**不参与 C2 取词链**。

### 6. `MusicSourceId` 值域扩展 + 前端同步
`model.rs` 枚举：移除 `Migu`，新增 `Kugou`/`Lrclib`/`Itunes`。前端 `src/api/types.ts` 同步、`src/store/selectors.ts` `sourceLabel` 补文案（酷狗/LRCLIB/iTunes）、`src/store/song.ts` `C2_SOURCE_ORDER` 去掉 migu、补新源。`source_rank` 与 `source_stats` 顺序按五源更新。
**为什么**：`#[serde(rename_all = "snake_case")]` 下 `Kugou`/`Lrclib`/`Itunes` 自动映射为 `'kugou'|'lrclib'|'itunes'`，无需显式 rename（`QqMusic` 的 `qqmusic` 特例保留）。契约命令签名不变，前端只是值域字面量同步——最小改动面。

### 7. 离线语义：`all_failed` 从「三源全失败」扩为「五源全失败」
两个稳定公共源（LRCLIB/iTunes）在线时基本不会误判离线；断网时五源全失败仍正确标记离线（FR-8.4a 语义不变）。
**为什么**：`all_failed` 的判定逻辑（`raw.values().all(|o| o.is_none())`）与源数量无关，五源只是扩展 `order` 与注册列表——**聚合层判定代码零改动**，只有常量与顺序表更新。

### 8. 源注册顺序 / `source_rank` / `source_stats` 统一为五源固定序
注册、`order`、`source_stats` 输出、`source_rank`（同分去重/排序的平手仲裁）统一为 **Netease(0) → QqMusic(1) → Kugou(2) → Lrclib(3) → Itunes(4)**。
**为什么**：中文源（网易云/QQ/酷狗）前置，公共源（LRCLIB/iTunes）垫底——同分去重与排序天然偏好中文平台（贴合「中文源命中优先、公共源兜底」），且 `source_stats` 顺序与前端 C2 取词链顺序一致，可复现稳定。

### 9. C2 取词链：iTunes 不入链
`C2_SOURCE_ORDER = ['netease', 'qqmusic', 'kugou', 'lrclib']`（去 migu、补 kugou/lrclib；**iTunes 无歌词不入链**）。
**为什么**：C2 是「取词失败 → 换另一家有歌词的源」，iTunes `fetch_lyric` 恒 None 会空转一轮；LRCLIB 零鉴权最稳，放链尾兜底（中文源命中优先语义贯穿到 C2）。

## 技术方案（落地映射）

### 数据流（全部不变，仅源数量变化）

```
search_song(title, artist)
  → JoinSet 五源并发（每源 6s 超时）→ 失败/超时降级空列表 + source_stats（该源记 0）
  → aggregate 打分去重排序（title/artist 权重不变）→ 前 10 条
search_source(source, title, artist)   // C2：单源原始候选，绕过聚合去重，不变
fetch_lyric(source, id)                 // 点选歌词取文本，None → C2 换源，不变
download_cover(url)                     // 点选封面，5s + 12MB，不变
```

契约签名（`search_song`/`search_source`/`fetch_lyric`/`download_cover`）与命令薄壳（`commands/search.rs`）**零改动**；只有 `MusicSourceId` 值域与后端源实现变化。

### 组件与文件映射

| 文件 | 改动 | 依赖 |
|---|---|---|
| `src-tauri/src/model.rs` | `MusicSourceId` 去 `Migu`、增 `Kugou`/`Lrclib`/`Itunes`；serde 序列化测试补 `'kugou'\|'lrclib'\|'itunes'` 往返；`source_stats` 相关单测更新为五源 | 无 |
| `src-tauri/Cargo.toml` | 新增 `md5` 依赖（酷狗签名） | 无 |
| `src-tauri/src/service/searcher/netease.rs` | `SEARCH_URL` → `https://music.163.com/api/linux/forward`；body 改 `{method,url,params}` linuxapi 转发；复用 `crypto::linuxapi`；`parse_search_response`/`is_error_response`（`code!=200`）不变；删除 weapi 调用（核查 `crypto::weapi` 是否还被引用，无则保留函数不动） | 1 |
| `src-tauri/src/service/searcher/qqmusic.rs` | `SEARCH_URL` → `client_search_cp` GET（`p=1&n=10&w=&format=json`）；解析改 `data.song.list[]`；`is_error_response`（顶层 `code!=0`）复用；取词不变 | 1 |
| `src-tauri/src/service/searcher/kugou.rs`（新） | MD5 签名搜索 + `lyrics.kugou.com` 两步取词 | 1、2 |
| `src-tauri/src/service/searcher/lrclib.rs`（新） | `/api/search` 候选 + `/api/get/{id}` 取词；描述性 UA | 1 |
| `src-tauri/src/service/searcher/itunes.rs`（新） | `itunes.apple.com/search` 封面候选；`fetch_lyric` 恒 None | 1 |
| `src-tauri/src/service/searcher/migu.rs`（删） | 整文件删除 + `mod.rs` 去掉 `pub mod migu;` | 1 |
| `src-tauri/src/service/searcher/mod.rs` | 五源注册（netease/qqmusic/kugou/lrclib/itunes）、`order`/`source_stats` 序（D8）、`source_rank`（D8）、`all_failed` 随五源、头注释「三源→五源」 | 3 |
| `src/api/types.ts` | `MusicSourceId = 'netease'\|'qqmusic'\|'kugou'\|'lrclib'\|'itunes'` | 4 |
| `src/store/selectors.ts` | `sourceLabel` 补「酷狗」「LRCLIB」「iTunes」、去「咪咕」 | 4 |
| `src/store/song.ts` | `C2_SOURCE_ORDER = ['netease','qqmusic','kugou','lrclib']`（D9） | 4 |
| `docs/V1-PRD.md` / `docs/design/design.md` / `openspec/specs/search-sources/spec.md` | 归档同步：FR-8.5 三家→五家；§7 多源架构、§10.3 契约类型映射表 `'netease'\|'qqmusic'\|'migu'`→五源字面量；主 spec 五源 | 5 |

### 各源请求要点（实现时对照）

- **网易云**：`POST /api/linux/forward`，form `eparams` = `crypto::linuxapi(json!({"method":"POST","url":"https://music.163.com/api/cloudsearch/pc","params":{"s":title,"type":1,"limit":10,"offset":0}}))`；保留随机 UA + Referer + Cookie；响应 `result.songs[]` 解析不动；`code!=200`（如风控）→ 源失败。
- **QQ**：`GET client_search_cp`，query `p=1&n=10&w=<title>&format=json`，保留 `QQ_UA` + Referer；解析 `data.song.list[]`；顶层 `code!=0` → 源失败；取词 URL/解析不动。
- **酷狗**：搜索 query 按字母序拼接 → secret 包裹 → `md5` 摘要 → `crypto::hex_encode`（小写 hex）做签名；解析 `data.lists[]`（`FileHash`→id）；`error_code` 非 0（如 20006 签名错）→ 源失败；取词 `lyrics.kugou.com/search` → `/download`（base64 LRC，复用 `base64` 解码）。
- **LRCLIB**：`GET /api/search`，query `track_name`+`artist_name`；请求级覆盖描述性 UA（如 `MusicTag/1.0 (search)`）；取词 `GET /api/get/{id}`，`syncedLyrics` 空回退 `plainLyrics`。
- **iTunes**：`GET https://itunes.apple.com/search`，query `term=<title> <artist>&country=CN&media=music&entity=song&limit=10`；`artworkUrl100` → replace `100x100bb` → `600x600bb`；`fetch_lyric` 恒 None。

## 变更域判断与实施顺序

- **变更域：both**（后端为主、前端仅契约值域同步）。
- **依赖顺序：Rust → Vue 串行**。前端 `MusicSourceId` 值域、`sourceLabel`、`C2_SOURCE_ORDER` 依赖后端 `model.rs` 枚举定稿；未显式创建 worktree → **禁止 Rust/Vue 并写**。
- **Rust 内部依赖边**：`model.rs` 枚举（G1）→ 五源文件（G2，内部相互独立，受 mod.rs 编译依赖约束逐文件落地即绿）→ `mod.rs` 聚合五源（G3）→ 前端（G4）→ 测试验证（G5）→ 文档归档（G6）。
- 回滚：`search_song` 只消费 `MusicSourceId` 列表 + 注册表，回滚即改回三源注册（git 历史保留）。

## 任务分组建议

按依赖序分 6 组（与 tasks.md 对应）：

1. **G1 模型与依赖**（无前置）：`model.rs` 枚举 + serde 测试；`Cargo.toml` 加 `md5`。
2. **G2 五源文件**（依赖 G1）：2.1 netease 改造、2.2 qqmusic 改造、2.3 kugou 新增、2.4 lrclib 新增、2.5 itunes 新增、2.6 删 migu——内部相互独立，先写失败解析单测再实现到绿。
3. **G3 聚合层**（依赖 G2）：`mod.rs` 五源注册、`order`/`source_stats`/`source_rank`/`all_failed` 适配、头注释更新。
4. **G4 前端同步**（依赖 G3 契约定稿）：types/selectors/song.ts + 前端用例更新。
5. **G5 测试验证**（依赖 G4）：`cargo check/test/clippy/fmt` + `npm run test/build` + `tauri dev` 集成冒烟（含断网离线提示）。
6. **G6 文档同步**（归档前，依赖 G5）：PRD FR-8.5、design.md §7/§10.3、主 spec 五源。

## Risks / Trade-offs

- [网易云 linuxapi 未来也可能被风控] → 公共源（LRCLIB/iTunes）+ 酷狗兜底，不再出现三源全灭。
- [酷狗签名/接口未来漂移] → 签名是纯 MD5 好维护；漂移时 LRCLIB 歌词、iTunes 封面兜底。
- [LRCLIB 小众歌可能无词] → 中文源（网易云/QQ/酷狗）兜底。
- [iTunes ToS 灰色（个人自用）] → 低频、不商用、不展示商品信息，自用工具可接受。
- [五源并发延迟] → 并发 + 6s 超时，wall-clock 与三源相同；候选秒出、惰性拉取不受影响。
- [Kugou 取词需两次请求（search→download）] → 点选才取词，惰性拉取语义天然适配。
- [LRCLIB/iTunes 为英文优先的全球曲库，中文检索质量低于中文源] → 中文源 `source_rank` 前置保证同分偏好；公共源仅在中文源全空/失败时兜底。

## Migration Plan

- 纯搜索后端替换，无数据迁移、无 schema 变更。
- 落地顺序：`model.rs` 枚举（G1）→ `crypto`/`md5` 依赖（G1）→ 三源文件改造 + 新增 `kugou.rs`/`lrclib.rs`/`itunes.rs` + 删除 `migu.rs`（G2）→ `mod.rs` 五源注册（G3）→ 前端类型/文案/C2 顺序（G4）→ 测试（G5）→ 文档同步（G6）。
- 回滚：保留 git 历史，`search_song` 只消费 `MusicSourceId` 列表，回滚即改回三源注册。
- 归档时同步 `docs/V1-PRD.md`（FR-8.5 搜索源）、`docs/design/design.md`（§7 多源架构、§10.3 契约类型映射表）、`openspec/specs/search-sources/spec.md` 主规格。

## Open Questions

无——五源端点均已于 2026-08-04 本机实测验证。
