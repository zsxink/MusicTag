## 1. 契约与 trait 扩展（Rust 后端）

- [ ] 1.1 `src-tauri/src/service/searcher/mod.rs`：`MusicSource::search` trait 增加 `album: &str` 参数（`search` 签名 `(client, title, artist, album)`）；先改 `tests/searcher_mod_tests.rs` 中 `FakeSource` 的 `search` 实现适配新签名（红），再改 trait。
- [ ] 1.2 新增 `join_query_terms(title, artist, album) -> String`（空段跳过、空格 join），放 `mod.rs` 或独立 util；先写单测（空 album 回退 / 全空空串 / 三段拼接）再实现。
- [ ] 1.3 `commands/search.rs`：`search_song(title, artist, album: String)`、`search_source(source, title, artist, album: String)` 签名加 album，透传 `searcher::search_song`/`search_source`。
- [ ] 1.4 `mod.rs`：`search_song`/`search_source`/`search_source_with`/`aggregate` 签名透传 `album`；`search_song_with_sources` 透传给各源 `search(&title, &artist, &album)`。

## 2. 各源查询构造透传 album

- [ ] 2.1 `netease.rs`：`search_payload(title, artist, album)`——`params.s` 用 `join_query_terms`；`search` 不再忽略 artist；先改 `tests/searcher_netease_tests.rs` 断言（红）再实现。
- [ ] 2.2 `qqmusic.rs`：`w` 参数用 `join_query_terms(title, artist, album)`；先改测试断言（红）再实现。
- [ ] 2.3 `kugou.rs`：`search_params` 的 `keyword` 用 `join_query_terms(title, artist, album)`；先改测试断言（红）再实现。
- [ ] 2.4 `lrclib.rs`：`track_name`/`artist_name` 外追加 `album_name`（album 空省略该参数）；先改测试断言（红）再实现。
- [ ] 2.5 `itunes.rs`：`term` 用 `join_query_terms(title, artist, album)`；先改测试断言（红）再实现。

## 3. aggregate 打分综合专辑

- [ ] 3.1 `mod.rs` `aggregate`：新增 `album_match`（相等 0.3，查询与候选 album 均非空才计分，复用 `norm` 守卫）；先写 `tests/searcher_mod_tests.rs` 断言（同专辑候选优先 / 空 album 不计分）再实现。
- [ ] 3.2 确认打分权重常量与注释同步（`title 相等 0.5 + artist 相等 0.4 + title 包含 0.2 + artist 包含 0.1 + album 相等 0.3`）。

## 4. 前端接入

- [ ] 4.1 `src/api/search.ts`：`searchSongs(title, artist, album)`、`searchSource(source, title, artist, album)` 透传 `{ title, artist, album }`；先改 `tests`（`search.test.ts` 断言加 album）再实现。
- [ ] 4.2 `src/store/song.ts`：`autoSearchOnSelect`/`manualSearch` 调 `searchSongs(cur.title, cur.artist, cur.album)`；先改 `song.test.ts` 两处 `toHaveBeenCalledWith`（红）再实现。
- [ ] 4.3 `src/store/song.ts` `pickLyricCandidate`：C2 换源调 `searchSource(source, cand.title, cand.artist, cand.album)`；先改测试断言（红）再实现。

## 5. 版本号同步

- [ ] 5.1 `package.json` / `package-lock.json`（顶层 + `packages[""]`）/ `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml` 四处 version `0.1.0` → `0.1.1`。
- [ ] 5.2 核对 `Cargo.lock` root package version（如随 Cargo.toml 变化需同步）。

## 6. 契约文档与守卫同步

- [ ] 6.1 `docs/design/design.md` §10.3：`search_song(title, artist, album)`、`search_source(source, title, artist, album)` 两行签名更新。
- [ ] 6.2 `docs/V1-PRD.md`：FR-8.5/8.6 相关搜索描述同步「综合 title/artist/album」。
- [ ] 6.3 `openspec/specs/search-sources/spec.md` 主规格：按 delta 合入（五源查询构造、打分规则、签名带 album）。
- [ ] 6.4 `openspec/config.yaml` 契约清单 / `src/styles/command-contract.test.ts` 扫描字样同步 `search_song(title, artist, album)`（否则守卫失败）。

## 7. 验证与归档

- [ ] 7.1 统一验证基线：`cargo check --manifest-path src-tauri/Cargo.toml` → `cargo test --manifest-path src-tauri/Cargo.toml` → `npm run test` → `npm run build` → `openspec validate search-cover-album --strict --no-interactive`。
- [ ] 7.2 `openspec archive` 归档变更（更新主规格），随分支提交。
