## 1. 模型与依赖

- [ ] 1.1 `src-tauri/src/model.rs`：`MusicSourceId` 枚举移除 `Migu`，新增 `Kugou`/`Lrclib`/`Itunes`；同步 `serde` 序列化映射
- [ ] 1.2 `src-tauri/Cargo.toml`：新增 `md5` 依赖（酷狗签名）

## 2. 后端三源改造 + 新源

- [ ] 2.1 `netease.rs`：搜索改走 linuxapi 转发——body `{method:POST, url:"https://music.163.com/api/cloudsearch/pc", params:{s,type:1,limit:10,offset:0}}` POST `/api/linux/forward`；响应解析 `result.songs[]` 不变；删除 weapi 搜索路径（`crypto::weapi` 是否还有引用需核查）
- [ ] 2.2 `qqmusic.rs`：搜索改走 `client_search_cp` GET（`p=1&n=10&w=<keyword>&format=json`）；解析 `data.song.list[]`（`songmid`→id、`songname`→title、`singer[].name`→artist、`albumname`→album、`albummid`→封面模板 `T002R300x300M000{albummid}.jpg`）；取词保持 `fcg_query_lyric_new.fcg`
- [ ] 2.3 新增 `kugou.rs`：MD5 签名搜索 `complexsearch.kugou.com/v2/search/song`（secret `NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt` 包裹字母序参数字符串）；解析 `data.lists[]`（`SongName`/`SingerName`/`AlbumName`/`FileHash`→id，封面 `SongName` 缺省）；取词 `lyrics.kugou.com`：`/search` 拿 `id`+`accesskey` → `/download?id=&accesskey=&fmt=lrc&charset=utf8` base64 LRC
- [ ] 2.4 新增 `lrclib.rs`：`GET /api/search?track_name=&artist_name=` 返回候选（title/artist/album/id，cover_url=None）；`fetch_lyric` 按 id `GET /api/get/{id}` 取 `syncedLyrics`（空回退 `plainLyrics`）；请求带描述性 User-Agent
- [ ] 2.5 新增 `itunes.rs`：`GET https://itunes.apple.com/search?term=<title> <artist>&country=CN&media=music&entity=song&limit=10`；`trackName`/`artistName`/`collectionName`/`artworkUrl100`→cover_url（升 `600x600bb`）；`fetch_lyric` 返回 None
- [ ] 2.6 删除 `migu.rs`；`searcher/mod.rs` 移除 `mod migu` 声明

## 3. 聚合层适配

- [ ] 3.1 `searcher/mod.rs`：`search_song` 源列表扩为五源（netease/qqmusic/kugou/lrclib/itunes）；`order` 与 `source_stats` 顺序、`source_rank` 按五源更新；`all_failed` 语义随五源

## 4. 前端同步

- [ ] 4.1 `src/api/types.ts`：`MusicSourceId` 值域移除 `'migu'`，新增 `'kugou'|'lrclib'|'itunes'`
- [ ] 4.2 `src/store/selectors.ts`：`sourceLabel` 补 酷狗/LRCLIB/iTunes 中文文案
- [ ] 4.3 `src/store/song.ts`：`C2_SOURCE_ORDER` 去 `migu`、补 `kugou`/`lrclib`（iTunes 无歌词不参与 C2 取词链）
- [ ] 4.4 前端测试：更新引用 `'migu'` 的用例（types/song store 相关）

## 5. 测试与验证

- [ ] 5.1 各源解析单测：`netease`/`qqmusic` 新响应结构、`kugou`/`lrclib`/`itunes` 新源（对照既有 `#[cfg(test)] mod tests` 内联风格，先写失败测试再实现到绿）
- [ ] 5.2 `cargo check` + `cargo test`（`src-tauri/Cargo.toml`）全绿；`cargo clippy` + `cargo fmt`
- [ ] 5.3 前端 `npm run test` + `npm run build` 通过
- [ ] 5.4 集成冒烟：`npm run tauri dev` 实测「选中即搜」——有歌词/封面缺失的歌曲能搜出候选，点选歌词/封面能填入；断网时仍正确显示离线提示

## 6. 文档同步（归档前）

- [ ] 6.1 `docs/V1-PRD.md`：FR-8.5「搜索源」三家 → 五源（网易云/QQ/酷狗/LRCLIB/iTunes），离线语义随五源
- [ ] 6.2 `docs/design/design.md`：§7 多源搜索架构更新（网易云 linuxapi 转发、QQ client_search_cp、酷狗 MD5 签名、LRCLIB/iTunes 并发）
- [ ] 6.3 归档：`openspec validate --all` 通过后，delta spec（search-sources）合并回 `openspec/specs/search-sources/spec.md`
