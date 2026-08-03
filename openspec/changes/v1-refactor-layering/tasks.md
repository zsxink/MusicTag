# 任务拆分（依赖顺序：Rust 全量 T1–T7 → 前端 T8–T11 → T12 文档/验证）

> 变更域：both（跨前后端）。串行依赖：Rust 先建 service/命令薄层 → 前端 api/store 接入。
> 纯重构约束：**函数体逐行原样移动，不改任何行为/契约**；本变更只移动、不重写。

## 1. Rust：领域模型与业务分层（T1–T5）

- [ ] 1.1 提取 `Song`/`SongSummary`/`LyricsSource` → `src-tauri/src/model.rs`（纯 serde 契约，`rename_all`/snake_case/`#[serde(rename="sidecar")]` 形状逐字保留），commands 改 `use crate::model::{...}`
- [ ] 1.2 提取封面 base64 data URL 编解码（encode_cover/encode_data_url/decode_cover）→ `src-tauri/src/service/cover.rs`，函数提升 pub；内联单测迁入（编解码往返、MIME 探测、坏 base64 Err）
- [ ] 1.3 提取字段映射与格式分支（is_audio_file/split_track_pair/apply_meta/set_text/apply_lyrics/apply_cover）→ `src-tauri/src/service/meta.rs`，函数提升 pub；`split_track_pair` 内联单测迁入
- [ ] 1.4 提取标签读取（read_summary/read_song_meta）→ `src-tauri/src/service/reader.rs`，函数提升 pub（依赖 meta::split_track_pair + cover::encode_cover）
- [ ] 1.5 提取保存编排与原子写 → `src-tauri/src/service/writer.rs`（save_song 编排：probe→primary_tag_mut().clear()→apply_meta→write_atomic，函数提升 pub）+ `service/fs_atomic.rs`（write_atomic：同目录临时文件+rename 原子替换）
- [ ] 1.6 每个 service 模块建 `mod.rs` 并 `pub mod` 声明；确认 service 函数全部 pub（供 `src-tauri/tests/` 集成测试访问）

## 2. Rust：command 薄层与注册（T6–T7）

- [ ] 2.1 拆 `src-tauri/src/commands/`：`folder.rs`（pick_folder、list_songs，`#[tauri::command]` 保留）+ `song.rs`（open_song、save_song）+ `mod.rs`；函数体改为委托对应 service（folder→reader::read_summary+meta::is_audio_file；song→reader::read_song_meta / writer::save_song）
- [ ] 2.2 `lib.rs` 改 `pub mod model; pub mod commands; pub mod service;`（**模块声明必须 pub**，集成测试经 `app_lib::` 访问）+ `generate_handler![commands::folder::pick_folder, commands::folder::list_songs, commands::song::open_song, commands::song::save_song]`（命令名不变）
- [ ] 2.3 迁移原 `commands.rs` 内 28 个测试：文件 I/O 集成测试 → `src-tauri/tests/`（`list_songs.rs`/`open_song.rs`/`save_song.rs`，`use app_lib::...`），fixture 收 `tests/common/mod.rs`（tiny_png_bytes/add_tags/write_tagged_flac/write_tagged_mp3/full_song）；纯逻辑单测留 service 内 inline；删除 `commands.rs` 大 `mod tests`
- [ ] 2.4 删除原 `commands.rs`，确认 `cargo check --manifest-path src-tauri/Cargo.toml` + `cargo clippy --manifest-path src-tauri/Cargo.toml` 干净（集成测试经 `app_lib::` 编译通过）

## 3. 前端：api 层（T8–T9）

- [ ] 3.1 新增 `src/api/client.ts`：`invokeCommand<T>` 平移自 `lib/tauri.ts`，**必须保留 `import { invoke } from '@tauri-apps/api/core'`**（editor.test.ts/client.test.ts 的 `vi.mock('@tauri-apps/api/core')` 依赖该 import 源）
- [ ] 3.2 新增 `src/api/types.ts`：全量契约（Song/SongSummary/SongCandidate/SearchResult/MusicSourceId/LyricsSource）逐字平移自 `lib/tauri.ts`；`tauri.test.ts` 随移动为 `src/api/client.test.ts`（mock 保留，验证 invoke 透传）
- [ ] 3.3 新增 `src/api/songs.ts`：`pickFolder()`/`listSongs(dir)`/`openSong(path)`/`saveSong(song)` 类型化封装（命令名、参数名、返回类型逐字不变，实现 = `invokeCommand<T>(cmd, args)` 透传）
- [ ] 3.4 `SongList.vue`/`SongRow.vue` 改调 `api/songs.ts`（SongList：openFolder 用 pickFolder + activateFolder(dir, (d)=>listSongs(d))；SongRow：loadSong=openSong），组件零 invoke 直呼

## 4. 前端：store 职责拆分（T10）

- [ ] 4.1 `lib/path.ts`：fileName/fileNameStem 迁出 `store/song.ts`；同步组件/测试 import（EditorBar.vue/FieldRow.vue 等）
- [ ] 4.2 `store/selectors.ts`：filteredSongs（computed 从 songStore 派生，排序+过滤）/titleText/artistText 迁出；`store/song.ts` 只留 reactive 状态 + 动作 + dirty getter（**dirty getter 原位保留在 reactive 字面量内**，Vue 3.5 live computed，挪出即失效）
- [ ] 4.3 同步 import 方（SongList.vue/SongRow.vue/store.test.ts 等），确认无环依赖（selectors → store → api 单向），`npm run test` + `npm run build` 编译通过

## 5. 前端：测试规范化（T11）

- [ ] 5.1 修 `store.test.ts` 重复 import 缺陷（第 3–4 行两条 `import { describe, expect, it, beforeEach... }` 合并），并入 `song.test.ts`
- [ ] 5.2 `songlist-repro.test.ts` 改名 `songlist.test.ts` 并按组件语义组织（**保留 #27 回归断言**：模板勿写 computed `.value`）

## 6. 文档（T12，T7/T8 后可并行）

- [ ] 6.1 `docs/design/design.md` §10 补「目录分层规范（Rust commands/service/model/tests；前端 api/store/lib/components）+ 测试放置约定 + 未来子变更落位说明」（v1-cover-embed→service/cover.rs、v1-lyrics-lrc→service/lyrics.rs、v1-search-backend→service/searcher/*、v1-search-ui→api/search.ts）

## 7. 验证

- [ ] 7.1 `cargo test --manifest-path src-tauri/Cargo.toml` 全绿（迁移后的集成测试 + 内联单测）+ `cargo clippy --manifest-path src-tauri/Cargo.toml` 无警告
- [ ] 7.2 `npm run test` + `npm run build` 全绿（前端测试卫生 + 类型编译）
- [ ] 7.3 `npm run tauri dev` 人工冒烟：打开文件夹→选中歌曲→读取→保存→改回，确认行为与重构前一致（Tauri command 契约零改动）
