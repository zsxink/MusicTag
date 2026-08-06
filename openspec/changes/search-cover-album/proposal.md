## Why

Issue #109（本机实测）：搜索封面时结果与歌手、专辑毫无关联——因为 `search_song(title, artist)` / `search_source(source, title, artist)` 的查询只带歌名（网易云 `s`、QQ `w`、酷狗 `keyword` 三源甚至忽略 artist），iTunes 仅 `term = "<title> <artist>"`。五家源的候选**响应**里其实都已解析出 `album` 字段，却从未回流进查询，导致同名不同专辑的歌排在前面、封面张冠李戴。

## What Changes

- **版本升级**：`0.1.0` → `0.1.1`，同步 `package.json` / `package-lock.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml` 四处版本号。
- **契约扩展**：`search_song`、`search_source` 增加 `album: String` 参数（IPC 透传，Tauri command 签名同步），前端 `api/search.ts` 与 store 调用点透传当前歌曲专辑。
- **全源透传 album**：`MusicSource::search` trait 增加 `album: &str`，五源查询构造综合 title + artist + album——
  - 网易云 `params.s`、QQ `w`、酷狗 `keyword`：关键词拼 `"<title> <artist> <album>"`（现有忽略 artist 的源顺带补上）；
  - iTunes `term`：拼 `<title> <artist> <album>`；
  - LRCLIB：`track_name` / `artist_name` 参数外追加 `album_name`（该 API 原生支持）。
  - **album 为空 → 回退为现行为**（不改变空专辑文件的搜索路径）。
- **打分综合专辑**：`aggregate` 打分增加 `album_match`（相等权重，防空串守卫同 title/artist），综合排序使同专辑候选优先。
- **空串守卫延续**：album 为空时不参与匹配分与查询拼接，避免退化命中（与既有 title/artist 防空串同一套守卫）。
- **测试同步**：Rust 侧各源 `search_payload`/`search_params`/term 构造断言、`aggregate` 打分断言；前端 `search.test.ts`（`{title, artist}` → `{title, artist, album}`）、`song.test.ts` 两处 `toHaveBeenCalledWith`、command-contract 契约扫描同步。

## Capabilities

### New Capabilities

（无——album 透传并入既有 `search-sources` 能力，不新增独立能力文件）

### Modified Capabilities

- `search-sources`: 搜索查询从「title（部分源 + artist）」扩展为「title + artist + album 综合透传」，五源查询构造与 `aggregate` 打分均纳入专辑信息；`search_song`/`search_source` 契约增加 `album` 参数（album 为空回退现行为，不破坏既有无专辑文件的搜索）。

## 关联 Issue

GitHub Issue：`#109`（分支提交 `feat(109): ...`、PR `Closes #109`）

## Impact

- **版本号**：`package.json`、`package-lock.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 四处 `0.1.0` → `0.1.1`。
- `src-tauri/src/commands/search.rs`：`search_song`/`search_source` 签名加 `album: String`。
- `src-tauri/src/service/searcher/mod.rs`：`MusicSource::search` trait 加 `album: &str`；`search_song`/`search_source`/`search_source_with`/`aggregate` 签名扩展；`aggregate` 加 `album_match` 打分。
- `src-tauri/src/service/searcher/{netease,qqmusic,kugou,lrclib,itunes}.rs`：`search` 实现、`search_payload`/`search_params`/term 构造透传 album。
- 前端：`src/api/search.ts`（`searchSongs`/`searchSource` 加 album）、`src/store/song.ts`（`autoSearchOnSelect`/`manualSearch` 传 `cur.album`，`pickLyricCandidate` C2 换源传 `cand.album`）。
- 契约文档：`docs/design/design.md` §10.3、`docs/V1-PRD.md`（FR-8.5/8.6 相关）、`openspec/specs/search-sources/spec.md` 主规格。
- 测试：Rust `tests/searcher_*_tests.rs`、前端 `src/api/search.test.ts`、`src/store/song.test.ts`、`src/styles/command-contract.test.ts`。
