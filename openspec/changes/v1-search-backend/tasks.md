> **参照实现**：xhongc/music-tag-web（`applications/utils/encrypt.py`、`services/music_resource.py`、`services/qm.py`、`task/utils.py`）。移植时接口 URL、参数、加密算法保持一致，详见 design.md D1–D8。
> **落位（服从 design.md §10.4）**：业务在 `service/searcher/`，命令薄壳在 `commands/search.rs`，`lib.rs` 注册；禁止新建平级目录。

## 1. Rust：契约类型（model.rs）

- [x] 1.1 声明新增 Cargo 依赖（proposal Impact）：`reqwest`（共享 Client + timeout）、`tokio`（join_all / time::timeout）、`aes` + `cbc` + `rsa` + `rand`（网易云加密；base64 / serde_json 已在 Cargo.toml）
- [x] 1.2 `model.rs` 新增 `MusicSourceId`（Netease/QqMusic/Migu）+ `SongCandidate` + `SearchResult`，字段与 design.md §10.3 契约逐字对齐（`source_stats: Vec<(MusicSourceId, usize)>` 元组序列化为 `[source, count]`）
- [x] 1.3 `QqMusic` 显式 `#[serde(rename = "qqmusic")]`（snake_case 会得 `qq_music`，同 `SidecarLrc` 教训）+ 契约形状单测（序列化/反序列化）

## 2. Rust：加密原语与网易云客户端（service/searcher/crypto.rs + netease.rs）

- [x] 2.1 实现加密工具模块 `crypto.rs`：AES-CBC（PKCS7，iv `0102030405060708`）+ AES-ECB + RSA modpow（`rsa::BigUint::modpow`，hex 左补零 256 位）；常量 `NONCE=b"0CoJUm6Qyw8W8jud"`、`LINUXKEY=b"rFgB&h#%2?^eDg:Q"`、`PUBKEY=010001`、`MODULUS`（256 hex）；单测（往返/已知向量，对照 encrypt.py）
- [x] 2.2 实现 weapi 加密：`secret=hexlify(urandom(16))[:16]` → 双层 AES-CBC（NONCE 层 + secret 层，均 base64 + 同 iv）→ `{ params, encSecKey }`（RSA 加密 secret）
- [x] 2.3 实现 linuxapi 加密：`{ eparams }`（AES-ECB LINUXKEY，hex 大写；`method: POST` 注入）
- [x] 2.4 实现网易云搜索（weapi）：POST `https://music.163.com/weapi/cloudsearch/get/web`，body `{ s:title, type:1, limit:10, offset:0 }` → 解析 `result.songs[]`（id/name/ar[].name→artist 逗号连接/al.name→album/al.picUrl→cover_url）
- [x] 2.5 实现网易云取歌词（linuxapi）：POST `https://music.163.com/api/song/lyric?lv=-1&kv=-1&tv=-1`，body `{ id, method:POST }` → `lrc.lyric`
- [x] 2.6 加密与解析测试（已知向量比对 weEncrypt 输出；mock 响应解析，含空字段兜底）

## 3. Rust：QQ + 咪咕客户端（service/searcher/qqmusic.rs + migu.rs）

- [x] 3.1 实现 QQ 搜索：POST `https://u.y.qq.com/cgi-bin/musicu.fcg`，JSON body（`comm` + `music.search.SearchCgiService.DoSearchForQQMusicDesktop`，见 design.md）→ 解析 `data.body.song.list[]`（id/mid/title/singer[]→artist/album.title/album_img 模板 `T002R300x300M000{album_mid}.jpg`；album 空 → `未分类专辑`）
- [x] 3.2 实现 QQ 取歌词：GET `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?g_tk=5381&...&songmid=<mid>`，`lyric` base64 解码 utf-8
- [x] 3.3 实现咪咕搜索：GET `https://m.music.migu.cn/migu/remoting/scr_search_tag?rows=10&type=2&keyword=<title>&pgc=1`（UA + Referer 头）→ 解析 `musics[]`（copyrightId→id/songName→title/singerName→artist/albumName→album/cover→cover_url）
- [x] 3.4 实现咪咕取歌词：GET `https://music.migu.cn/v3/api/music/audioPlayer/getLyric?copyrightId=<id>` → `lyric`
- [x] 3.5 各客户端解析测试（mock 响应结构，含空字段兜底）

## 4. Rust：聚合 + 打分 + 惰性拉取（service/searcher/mod.rs + commands/search.rs）

- [x] 4.1 `service/searcher/mod.rs`：`MusicSource` trait（`search(title, artist) -> Vec<SongCandidate>` + `fetch_lyric(id) -> Option<String>`）+ 共享 `client()`（`OnceLock<Client>`，6s 默认超时）
- [x] 4.2 `search_song(title, artist)` 聚合：`tokio::join_all` 三源并发 + `time::timeout` 单源 6s → 失败降级空列表 + `source_stats`（该源记 0）
- [x] 4.3 打分（spec 权重，design.md D3）：`norm`（trim + 全角半角 + lower）；title 相等 0.5 / 包含 0.2；artist 相等 0.4 / 包含 0.1（多艺人分段取 max）；过滤 title_match==0
- [x] 4.4 去重排序：归一化 `(title, artist)` 保留最高分（同分按 Netease→QqMusic→Migu 稳定序）→ score 降序 → 前 10 条
- [x] 4.5 `fetch_lyric(source, id) -> Option<String>`（None = 取词失败/无词，供 C2 换源）
- [x] 4.6 `download_cover(url) -> Result<Vec<u8>, String>`：请求级 5s 超时 + 响应体限流（Content-Length / 流式 12MB 上限）
- [x] 4.7 `commands/search.rs` 薄壳（search_song / fetch_lyric / download_cover，参数接收 + 委托 service）+ `lib.rs` `generate_handler!` 注册
- [x] 4.8 聚合/打分/去重/超时降级/限流测试（打分权重、去重保留最高分、超时降级 source_stats 记 0）

## 5. 验证

- [x] 5.1 `cargo test` + `cargo clippy` 通过（加密、解析、聚合、打分测试）
- [ ] 5.2 真机冒烟（可选）：联网手动调用 `search_song` 确认三家源可搜（本机已尝试：请求管道验证通过，但当前网络 IP 触发网易云 `50000005` 风控、QQ 首次成功后被限流、咪咕域名 301 重定向至 /v5，三家均被网络侧拦截 → 未标记完成，见 summary）
