# 任务分组（依赖序：G1 → G2 → G3 → G4 → G5 → G6，串行实施）

> 变更域 both：后端为主、前端仅契约值域同步。依赖序 Rust → Vue 串行（未显式建 worktree，禁止 Rust/Vue 并写）。
> G2 内部五源文件相互独立，逐文件「先写失败解析单测 → 实现到绿」。

## G1 模型与依赖（无前置）

- [ ] 1.1 `src-tauri/src/model.rs`：`MusicSourceId` 枚举移除 `Migu`，新增 `Kugou`/`Lrclib`/`Itunes`（`#[serde(rename_all="snake_case")]` 下自动映射 `'kugou'|'lrclib'|'itunes'`，`QqMusic` 的显式 `rename="qqmusic"` 保留）；更新 serde 序列化往返测试（补 `"kugou"`/`"lrclib"`/`"itunes"`，删 `"migu"`）与 `source_stats` 结构守卫测试
- [ ] 1.2 `src-tauri/Cargo.toml`：新增 `md5` 依赖（酷狗签名，纯 Rust 无 JS 引擎）

## G2 五源文件（依赖 G1；2.1–2.5 相互独立，2.6 与 G3 同 PR）

- [ ] 2.1 `netease.rs`：搜索改走 linuxapi 转发——`SEARCH_URL` 改 `https://music.163.com/api/linux/forward`，form `eparams` = `crypto::linuxapi(json!({"method":"POST","url":"https://music.163.com/api/cloudsearch/pc","params":{"s":title,"type":1,"limit":10,"offset":0}}))`；响应解析 `result.songs[]` 与 `is_error_response`（`code!=200`）不变；删除 weapi 搜索路径（核查 `crypto::weapi` 是否还有引用，无则函数保留不动）；保留随机 UA + Referer + Cookie
- [ ] 2.2 `qqmusic.rs`：搜索改走 `client_search_cp` GET（`p=1&n=10&w=<title>&format=json`）；解析 `data.song.list[]`（`songmid`→id、`songname`→title、`singer[].name`→artist、`albumname`→album、`albummid`→封面模板 `T002R300x300M000{albummid}.jpg`）；`is_error_response`（顶层 `code!=0`）复用；取词保持 `fcg_query_lyric_new.fcg`（ASCII UA 兜底）
- [ ] 2.3 新增 `kugou.rs`：MD5 签名搜索 `complexsearch.kugou.com/v2/search/song`（secret `NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt` 包裹按字母序拼接的查询参数字符串 → `md5` 摘要 → `crypto::hex_encode` 小写 hex）；解析 `data.lists[]`（`SongName`/`SingerName`/`AlbumName`/`FileHash`→id，封面缺省 None）；`error_code` 非 0（如 20006 签名错）→ 源失败；取词 `lyrics.kugou.com`：`/search` 拿 `id`+`accesskey` → `/download?id=&accesskey=&fmt=lrc&charset=utf8` 返回 base64 LRC（复用 `base64` 解码）
- [ ] 2.4 新增 `lrclib.rs`：`GET /api/search?track_name=&artist_name=` 返回候选（title/artist/album/id，cover_url=None）；请求级覆盖描述性 UA（如 `MusicTag/1.0 (search)`）；`fetch_lyric` 按 id 调 `GET /api/get/{id}` 取 `syncedLyrics`（空回退 `plainLyrics`）
- [ ] 2.5 新增 `itunes.rs`：`GET https://itunes.apple.com/search?term=<title> <artist>&country=CN&media=music&entity=song&limit=10`；`trackName`/`artistName`/`collectionName`/`artworkUrl100`→cover_url（replace `100x100bb`→`600x600bb`）；`fetch_lyric` 恒 None（iTunes 不入 C2 链）
- [ ] 2.6 删除 `migu.rs`；`searcher/mod.rs` 移除 `pub mod migu;`（与 G3 同一提交，保证编译绿）

## G3 聚合层适配（依赖 G2）

- [ ] 3.1 `searcher/mod.rs`：`search_song` 源列表扩为五源（netease/qqmusic/kugou/lrclib/itunes）；`order` 与 `source_stats` 顺序、`source_rank` 按五源固定序 Netease(0)→QqMusic(1)→Kugou(2)→Lrclib(3)→Itunes(4)；`all_failed` 语义随五源（判定代码不变，仅 order 扩展）；头注释「三源→五源」（含 `commands/search.rs` 头注释同步）

## G4 前端同步（依赖 G3 契约定稿）

- [ ] 4.1 `src/api/types.ts`：`MusicSourceId` 值域移除 `'migu'`，新增 `'kugou'|'lrclib'|'itunes'`
- [ ] 4.2 `src/store/selectors.ts`：`sourceLabel` 去「咪咕」，补「酷狗」「LRCLIB」「iTunes」
- [ ] 4.3 `src/store/song.ts`：`C2_SOURCE_ORDER` 去 `migu`、补 `kugou`/`lrclib` 为 `['netease','qqmusic','kugou','lrclib']`（iTunes 无歌词不参与 C2 取词链）
- [ ] 4.4 前端测试：更新引用 `'migu'` 的用例（types/song store 相关），补新源字面量

## G5 测试与验证（依赖 G4）

- [ ] 5.1 各源解析单测：`netease`/`qqmusic` 新响应结构、`kugou`/`lrclib`/`itunes` 新源（对照既有 `#[cfg(test)] mod tests` 内联风格，先写失败测试再实现到绿；kugou 加签名已知向量锁算法）
- [ ] 5.2 `cargo check` + `cargo test`（`src-tauri/Cargo.toml`）全绿；`cargo clippy` + `cargo fmt`
- [ ] 5.3 前端 `npm run test` + `npm run build` 通过
- [ ] 5.4 集成冒烟：`npm run tauri dev` 实测「选中即搜」——有歌词/封面缺失的歌曲能搜出候选，点选歌词/封面能填入（含酷狗/LRCLIB/iTunes 新源）；断网时仍正确显示离线提示

## G6 文档同步（归档前，依赖 G5）

- [ ] 6.1 `docs/V1-PRD.md`：FR-8.5「搜索源」三家 → 五源（网易云/QQ/酷狗/LRCLIB/iTunes），离线语义随五源
- [ ] 6.2 `docs/design/design.md`：§7 多源搜索架构更新（网易云 linuxapi 转发、QQ client_search_cp、酷狗 MD5 签名、LRCLIB/iTunes 并发）；§10.3 契约类型映射表 `'netease'|'qqmusic'|'migu'` → 五源字面量
- [ ] 6.3 归档：`openspec validate --all` 通过后，delta spec（search-sources）合并回 `openspec/specs/search-sources/spec.md`（三源并发→五源并发、网易云加密 weapi→linuxapi 转发、新增酷狗/LRCLIB/iTunes 三 requirement）
