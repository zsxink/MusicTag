> **变更域：both（跨前后端）**。串行顺序：组 1–3（Rust）→ 组 4（前端）→ 组 5–6（版本 + 契约文档）→ 组 7（验证归档）。不建 worktree，禁止并写。每组的测试改动与本组实现同 commit（先红后绿）。

## 1. 契约与 trait 扩展（Rust 后端）

- [x] 1.1 `src-tauri/src/service/searcher/mod.rs`：`MusicSource::search` trait 增加 `album: &str` 参数（`search` 签名 `(client, title, artist, album)`）；先改 `tests/searcher_mod_tests.rs` 中 `FakeSource` 的 `search` 实现适配新签名（红），再改 trait。
- [x] 1.2 新增 `join_query_terms(title, artist, album) -> String`（空段跳过、空格 join），放 `mod.rs` 或独立 util；先写单测（空 album 回退 / 全空空串 / 三段拼接）再实现。
- [x] 1.3 `commands/search.rs`：`search_song(title, artist, album: String)`、`search_source(source, title, artist, album: String)` 签名加 album，透传 `searcher::search_song`/`search_source`。
- [x] 1.4 `mod.rs`：`search_song`/`search_source`/`search_source_with`/`aggregate` 签名透传 `album`；`search_song_with_sources` 透传给各源 `search(&title, &artist, &album)`。

## 2. 各源查询构造透传 album

- [x] 2.1 `netease.rs`：`search()` 内 `let kw = join_query_terms(title, artist, album)` 再 `crypto::linuxapi(&search_payload(&kw))`——`params.s = kw`（`search_payload` 签名保持 `keyword: &str` 不变）；`search` 不再忽略 artist；先改 `tests/searcher_netease_tests.rs` 断言（红：`search_payload("晴天 周杰伦 叶惠美")` → `params.s`）再实现。
- [x] 2.2 `qqmusic.rs`：`search()` 内 `w` 参数 = `join_query_terms(title, artist, album)`（params 数组内直接传或先算 `kw`）；先改测试断言（红：w 为拼接串）再实现。
- [x] 2.3 `kugou.rs`：`search()` 内 `search_params(&join_query_terms(title, artist, album))`（`search_params` 签名保持 `keyword: &str` 不变）；先改测试断言（红：keyword 为拼接串）再实现。
- [x] 2.4 `lrclib.rs`：`track_name`/`artist_name` 外追加 `album_name`（album 空省略该参数）；先改测试断言（红）再实现。
- [x] 2.5 `itunes.rs`：`term` 用 `join_query_terms(title, artist, album)`；先改测试断言（红）再实现。

## 3. aggregate 打分综合专辑

- [x] 3.1 `mod.rs` `aggregate`：新增 `album_match`（相等 0.3，查询与候选 album 均非空才计分，复用 `norm` 守卫）；先写 `tests/searcher_mod_tests.rs` 断言（同专辑候选优先 / 空 album 不计分）再实现。
- [x] 3.2 确认打分权重常量与注释同步（`title 相等 0.5 + artist 相等 0.4 + title 包含 0.2 + artist 包含 0.1 + album 相等 0.3`）。

## 4. 前端接入

- [x] 4.1 `src/api/search.ts`：`searchSongs(title, artist, album)`、`searchSource(source, title, artist, album)` 透传 `{ title, artist, album }`；先改 `tests`（`search.test.ts` 断言加 album）再实现。
- [x] 4.2 `src/store/song.ts`：`autoSearchOnSelect`/`manualSearch` 调 `searchSongs(cur.title, cur.artist, cur.album)`；先改 `song.test.ts` 两处 `toHaveBeenCalledWith`（红）再实现。
- [x] 4.3 `src/store/song.ts` `pickLyricCandidate`：C2 换源调 `searchSource(source, cand.title, cand.artist, cand.album)`；先改测试断言（红）再实现。

## 5. 版本号同步

- [x] 5.1 `package.json` / `package-lock.json`（顶层 + `packages[""]`）/ `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml` 四处 version `0.1.0` → `0.1.1`。
- [x] 5.2 核对 `Cargo.lock` root package version（如随 Cargo.toml 变化需同步）。

## 6. 契约文档与守卫同步

- [x] 6.1 `docs/design/design.md` §10.3：`search_song(title, artist, album)`、`search_source(source, title, artist, album)` 两行签名更新。
- [x] 6.2 `docs/V1-PRD.md`：FR-8.5/8.6 相关搜索描述同步「综合 title/artist/album」。
- [ ] 6.3 `openspec/specs/search-sources/spec.md` 主规格：按 delta 合入（五源查询构造、打分规则、签名带 album）——由归档步骤 `/opsx:archive` 自动处理，不手动改主规格。
- [x] 6.4 `openspec/config.yaml` 契约清单同步（command 名不变，仅描述/清单行跟随签名）；`command-contract.test.ts` **不需要改**——守卫只比 command 名与无参签名，`search_song`/`search_source` 加参数不触发红（design.md D4「守卫机制精度」）。

## 7. 验证与归档

- [ ] 7.1 统一验证基线：`cargo check --manifest-path src-tauri/Cargo.toml` → `cargo test --manifest-path src-tauri/Cargo.toml` → `npm run test` → `npm run build` → `openspec validate search-cover-album --strict --no-interactive`。
- [ ] 7.2 `openspec archive` 归档变更（更新主规格），随分支提交。
