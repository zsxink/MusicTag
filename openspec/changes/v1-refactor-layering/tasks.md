## 1. Rust：领域模型与业务分层

- [ ] 1.1 提取 `Song`/`SongSummary`/`LyricsSource` → `src-tauri/src/model.rs`（纯 serde 契约，`rename_all`/snake_case 形状逐字保留），commands 改 `use crate::model::{...}`
- [ ] 1.2 提取封面 base64 data URL 编解码（encode_cover/encode_data_url/decode_cover）→ `src-tauri/src/service/cover.rs`，含内联单测（编解码往返）
- [ ] 1.3 提取字段映射与格式分支（apply_meta/set_text/apply_lyrics/apply_cover/split_track_pair/is_audio_file）→ `src-tauri/src/service/meta.rs`，含 split_track_pair 内联单测
- [ ] 1.4 提取标签读取（read_summary/read_song_meta）→ `src-tauri/src/service/reader.rs`（函数提升 pub）
- [ ] 1.5 提取保存编排与原子写 → `src-tauri/src/service/writer.rs` + `service/fs_atomic.rs`（write_atomic：临时文件+rename 原子替换）
- [ ] 1.6 `service` 函数提升 `pub`（供 `src-tauri/tests/` 集成测试访问）

## 2. Rust：command 薄层与注册

- [ ] 2.1 拆 `src-tauri/src/commands/`：`folder.rs`（pick_folder、list_songs）+ `song.rs`（open_song、save_song）+ `mod.rs`；函数体改为委托对应 service
- [ ] 2.2 `lib.rs` 改 `mod model; mod commands; mod service;` + `generate_handler![commands::folder::pick_folder, commands::folder::list_songs, commands::song::open_song, commands::song::save_song]`（命令名不变）
- [ ] 2.3 迁移原 `commands.rs` 内 28 个测试：文件 I/O 集成测试 → `src-tauri/tests/`（`list_songs.rs`/`open_song.rs`/`save_song.rs`），fixture 收 `tests/common/mod.rs`（tiny_png_bytes/add_tags/write_tagged_flac/write_tagged_mp3/full_song）；纯逻辑单测留 service 内 inline；删除 `commands.rs` 大 `mod tests`
- [ ] 2.4 清理空壳：删除原 `commands.rs`（或改为仅转发），确认 `cargo check` + `cargo clippy` 干净

## 3. 前端：api 层

- [ ] 3.1 `src/lib/tauri.ts` 拆 `src/api/client.ts`（invokeCommand，仍 `import { invoke } from '@tauri-apps/api/core'`）+ `src/api/types.ts`（全量契约类型），更新 7 处 import（SongList.vue/SongRow.vue/store/song.ts/tauri.test.ts/song.test.ts/store.test.ts/editor.test.ts）
- [ ] 3.2 新增 `src/api/songs.ts`：pickFolder/listSongs/openSong/saveSong 类型化封装（参数名/返回类型逐字不变）
- [ ] 3.3 `SongList.vue`/`SongRow.vue` 改调 `api/songs.ts`（经 store 动作 loader 注入），组件零 invoke 直呼
- [ ] 3.4 `tauri.test.ts` 随移动为 `src/api/client.test.ts`，验证 invoke 透传

## 4. 前端：store 职责拆分

- [ ] 4.1 `lib/path.ts`：fileName/fileNameStem 迁出 `store/song.ts`；同步组件/测试 import
- [ ] 4.2 `store/selectors.ts`：filteredSongs/titleText/artistText 迁出；`store/song.ts` 只留 reactive 状态 + 动作 + dirty getter（**dirty getter 原位保留在 reactive 字面量内**）
- [ ] 4.3 同步 import 方（EditorBar.vue/FieldRow.vue/store.test.ts 等），确认无环依赖（selectors → store 单向）

## 5. 前端：测试规范化

- [ ] 5.1 修 `store.test.ts` 重复 import 缺陷（并入 `song.test.ts`）
- [ ] 5.2 `songlist-repro.test.ts` 改名 `songlist.test.ts` 并按组件语义组织

## 6. 文档

- [ ] 6.1 `docs/design/design.md` §10 补「目录分层规范（Rust commands/service/model/tests；前端 api/store/lib/components）+ 测试放置约定 + 未来子变更落位说明」

## 7. 验证

- [ ] 7.1 `cargo test --manifest-path src-tauri/Cargo.toml` + `cargo clippy --manifest-path src-tauri/Cargo.toml` 全绿（迁移后的集成测试 + 内联单测）
- [ ] 7.2 `npm run test` + `npm run build` 全绿（前端测试卫生 + 类型编译）
- [ ] 7.3 `npm run tauri dev` 人工冒烟：打开文件夹→选中歌曲→读取→保存→改回，确认行为与重构前一致
