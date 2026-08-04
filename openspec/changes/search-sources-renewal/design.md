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
weapi 搜索路径 2026 起被风控空响应；本项目 `crypto::linuxapi` 已实现并用于取词（一直正常）。把搜索 body 改为 `{method:"POST", url:"https://music.163.com/api/cloudsearch/pc", params:{s,type:1,limit:10,offset:0}}` POST 到 `/api/linux/forward`。响应结构 `result.songs[]` 与 weapi 相同，**解析代码零改动**。替代方案：weapi 补 cookie/csrf_token——无账号拿不到稳定 cookie，弃。

### 2. QQ 搜索改走 `client_search_cp` GET
`musicu.fcg` 全 comm 变体实测 code 2001/空列表。换 `GET https://c.y.qq.com/soso/fcgi-bin/client_search_cp?p=1&n=10&w=<keyword>&format=json`，解析 `data.song.list[]`：`songmid`→id、`songname`→title、`singer[].name`→artist、`albumname`→album、`albummid`→封面模板 `T002R300x300M000{albummid}.jpg`。取词保持 `fcg_query_lyric_new.fcg`（实测正常，UA 用 ASCII 兜底）。

### 3. 咪咕 → 酷狗（MD5 签名）
咪咕两端点全死、无签名新接口。酷狗 `complexsearch.kugou.com/v2/search/song` 需 MD5 签名（secret `NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt` 包裹按字母序拼接的查询参数字符串）——**纯 MD5**，新增 `md5` crate 即可，无 JS 引擎。响应 `data.lists[]`：`SongName`→title、`SingerName`→artist、`AlbumName`→album、`FileHash`→id。取词走 `lyrics.kugou.com`：`/search` 拿候选 `id`+`accesskey` → `/download?id=&accesskey=&fmt=lrc&charset=utf8` 返回 base64 LRC（实测可用）。

### 4. LRCLIB 作第 4 源（歌词）
零鉴权，`GET /api/search?track_name=&artist_name=` 返回候选（title/artist/album/id，无封面），`fetch_lyric` 按候选 id 调 `GET /api/get/{id}` 取 `syncedLyrics`（空回退 `plainLyrics`）。请求带描述性 User-Agent（lrclib 文档要求）。

### 5. iTunes 作第 5 源（封面）
零鉴权，`GET https://itunes.apple.com/search?term=<title> <artist>&country=CN&media=music&entity=song&limit=10`。`trackName`/`artistName`/`collectionName`/`artworkUrl100`；封面 URL 直接升为 `600x600bb`（`100x100bb`→`600x600bb` 替换，实测高清可用）。`fetch_lyric` 返回 None → 前端 C2 自动换其他源取词。

### 6. `MusicSourceId` 值域扩展 + 前端同步
`model.rs` 枚举：移除 `Migu`，新增 `Kugou`/`Lrclib`/`Itunes`。前端 `src/api/types.ts` 同步、`src/store/selectors.ts` `sourceLabel` 补文案（酷狗/LRCLIB/iTunes）、`src/store/song.ts` `C2_SOURCE_ORDER` 去掉 migu、补新源。`source_rank` 与 `source_stats` 顺序按五源更新。

### 7. 离线语义：`all_failed` 从「三源全失败」扩为「五源全失败」
两个稳定公共源（LRCLIB/iTunes）在线时基本不会误判离线；断网时五源全失败仍正确标记离线（FR-8.4a 语义不变）。

## Risks / Trade-offs

- [网易云 linuxapi 未来也可能被风控] → 公共源（LRCLIB/iTunes）+ 酷狗兜底，不再出现三源全灭。
- [酷狗签名/接口未来漂移] → 签名是纯 MD5 好维护；漂移时 LRCLIB 歌词、iTunes 封面兜底。
- [LRCLIB 小众歌可能无词] → 中文源（网易云/QQ/酷狗）兜底。
- [iTunes ToS 灰色（个人自用）] → 低频、不商用、不展示商品信息，自用工具可接受。
- [五源并发延迟] → 并发 + 6s 超时，wall-clock 与三源相同；候选秒出、惰性拉取不受影响。
- [Kugou 取词需两次请求（search→download）] → 点选才取词，惰性拉取语义天然适配。

## Migration Plan

- 纯搜索后端替换，无数据迁移、无 schema 变更。
- 落地顺序：`model.rs` 枚举 → `crypto`/`md5` 依赖 → 三源文件改造（netease/qqmusic）+ 新增 `kugou.rs`/`lrclib.rs`/`itunes.rs` + 删除 `migu.rs` → `mod.rs` 五源注册 → 前端类型/文案/C2 顺序 → 测试。
- 回滚：保留 git 历史，`search_song` 只消费 `MusicSourceId` 列表，回滚即改回三源注册。
- 归档时同步 `docs/V1-PRD.md`（FR-8.5 搜索源）、`docs/design/design.md`（§7 多源架构）、`openspec/specs/search-sources/spec.md` 主规格。

## Open Questions

无——五源端点均已于 2026-08-04 本机实测验证。
