> **参照实现**：xhongc/music-tag-web（`applications/utils/encrypt.py`、`services/music_resource.py`、`services/qm.py`、`task/utils.py`）。移植时接口 URL、参数、加密算法保持一致，详见 design.md。

## 1. Rust：加密原语与网易云客户端

- [ ] 1.1 实现加密工具模块：AES-CBC（PKCS7，iv `0102030405060708`）+ AES-ECB + RSA（`pow` 模幂，hex 左补零 256 位），常量 `NONCE=b"0CoJUm6Qyw8W8jud"`、`LINUXKEY=b"rFgB&h#%2?^eDg:Q"`、`PUBKEY=010001`、`MODULUS`（256 hex）；含单元测试（往返/已知向量，对照 encrypt.py）
- [ ] 1.2 实现 weapi 加密（`weEncrypt`）：`secret=随机16字节` → 双层 AES-CBC（NONCE 层 + secret 层，均 base64）→ `{ params, encSecKey }`（RSA 加密 secret）
- [ ] 1.3 实现 linuxapi 加密（`linuxEncrypt`）：`{ eparams }`（AES-ECB LINUXKEY，hex 大写）
- [ ] 1.4 实现网易云搜索（weapi）：POST `https://music.163.com/weapi/cloudsearch/get/web`，body `{ s:title, type:1, limit:10, offset:0 }` → 解析 `result.songs[]`（id/name/ar[].name→artist/al.name→album/al.picUrl→cover_url/publishTime→year）
- [ ] 1.5 实现网易云取歌词（linuxapi）：POST `https://music.163.com/api/song/lyric?lv=-1&kv=-1&tv=-1`，body `{ id, method:POST }` → `lrc.lyric`
- [ ] 1.6 网易云加密与解析测试（已知向量比对 weEncrypt 输出；mock 响应解析）

## 2. Rust：QQ + 咪咕客户端

- [ ] 2.1 实现 QQ 搜索：POST `https://u.y.qq.com/cgi-bin/musicu.fcg`，JSON body（`comm` + `music.search.SearchCgiService.DoSearchForQQMusicDesktop`，见 design.md）→ 解析 `data.body.song.list[]`（id/mid/title/singer[]→artist/album.title/album_img 模板 `T002R300x300M000{album_mid}.jpg`）
- [ ] 2.2 实现 QQ 取歌词：GET `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?g_tk=5381&...&songmid=<mid>`，`lyric` base64 解码 utf-8
- [ ] 2.3 实现咪咕搜索：GET `https://m.music.migu.cn/migu/remoting/scr_search_tag?rows=10&type=2&keyword=<title>&pgc=1`（UA + Referer 头）→ 解析 `musics[]`（copyrightId→id/songName/name/singerName→artist/albumName→album/cover）
- [ ] 2.4 实现咪咕取歌词：GET `https://music.migu.cn/v3/api/music/audioPlayer/getLyric?copyrightId=<id>` → `lyric`
- [ ] 2.5 各客户端解析测试（mock 响应结构，含空字段兜底）

## 3. Rust：聚合 + 打分 + 惰性拉取

- [ ] 3.1 定义 `MusicSourceId`/`SongCandidate`/`SearchResult`/`SearchError` struct 与 serde
- [ ] 3.2 `search/mod.rs`：统一 Trait `MusicSource` + `search_song` 聚合入口（`tokio::join_all` 三源并发）
- [ ] 3.3 单源 6s 超时 + 失败降级空列表 + `source_stats`
- [ ] 3.4 打分函数（对标 match_score/match_artist）：`match_score`（lower+去空格，全等 2 / 包含 1 / 否则 0，不做简繁）；`match_artist`（逗号双艺人求和）；总分 = title+artist+album，artist 非空且 artist 分 0 → -2，artist 空且 artist≥1 且 title≥1 → title 提为 2
- [ ] 3.5 去重：归一化 `(title, artist)`（全角半角折叠）保留最高分 → 按 score 降序 → 前 N 条
- [ ] 3.6 `download_cover(url) -> Result<Vec<u8>, String>`：5s 超时 + 响应限流
- [ ] 3.7 实现 `search_song`/`fetch_lyric`/`download_cover` command 并注册
- [ ] 3.8 聚合/打分/去重/超时降级测试

## 4. 验证

- [ ] 4.1 `cargo test` + `cargo clippy` 通过（加密、解析、聚合、打分测试）
- [ ] 4.2 真机冒烟（可选）：联网手动调用 `search_song` 确认三家源可搜
