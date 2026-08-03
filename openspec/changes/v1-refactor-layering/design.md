## Context

Epic V1 已实现 v1-skeleton / v1-folder-list / v1-song-read / v1-song-save。当前代码平铺无分层：`commands.rs` 单文件 1187 行混 5 类职责；前端 IPC 直插组件、store 混 4 类职责；生产文件内嵌测试。后续 6 个 V1 子变更需要分层落位，故在下一个子变更前插入纯重构。

## Goals / Non-Goals

**Goals:**
- 建立前后端分层（Rust commands/service/model；前端 api/store/lib/components），高内聚低耦合。
- 生产代码与测试代码隔离（Rust 集成测试外置 `src-tauri/tests/`；前端 co-located 规范化）。
- 零行为变更，回归靠测试迁移 + 人工冒烟保障。

**Non-Goals:**
- 不改任何产品功能、UI 文案、交互。
- 不改变 Tauri command 字符串契约与前端 invoke 参数/返回形状。
- 不引入 Pinia / 多 store（守 design.md §10.2 单 store）。
- 不做性能优化、不做依赖升级。

## Decisions

- **Rust 4 层**（命令名不变，Tauri 字符串契约零改动）：
  1. `src-tauri/src/commands/`：`mod.rs` + `folder.rs`（pick_folder、list_songs）+ `song.rs`（open_song、save_song）。薄壳：只接参数、委托 service、包返回值，不含 lofty/IO 逻辑。
  2. `src-tauri/src/service/`：`reader.rs`（read_summary、read_song_meta）、`writer.rs`（save_song 编排：probe→clear→apply→write_atomic）、`meta.rs`（apply_meta、set_text、apply_lyrics、apply_cover、split_track_pair、is_audio_file）、`cover.rs`（encode_cover、encode_data_url、decode_cover）、`fs_atomic.rs`（write_atomic：临时文件+rename 原子替换）。函数提升 `pub` 以便 `src-tauri/tests/` 集成测试访问。
  3. `src-tauri/src/model.rs`：`Song`/`SongSummary`/`LyricsSource`（纯 serde 契约，`rename_all`/snake_case 形状逐字保留）。
  4. `lib.rs`：`mod model; mod commands; mod service;` + `generate_handler![commands::folder::pick_folder, commands::folder::list_songs, commands::song::open_song, commands::song::save_song]`。
- **前端 4 层**：
  1. `src/api/`：`client.ts`（`invokeCommand<T>`，仍 `import { invoke } from '@tauri-apps/api/core'`，保证既有 `vi.mock` 兼容）、`types.ts`（Song/SongSummary/SongCandidate/SearchResult/MusicSourceId/LyricsSource 全量契约）、`songs.ts`（pickFolder/listSongs/openSong/saveSong 类型化封装）。
  2. `src/store/`：`song.ts` 只留 reactive 状态 + 动作（selectSong/activateFolder/open/save/undo）+ dirty getter（**必须原位保留在 reactive 字面量内**，靠 getter 转 live computed）；`selectors.ts` 纯派生（filteredSongs/titleText/artistText）。
  3. `src/lib/`：`path.ts`（fileName/fileNameStem 纯工具）。
  4. `src/components/`：纯展示，零 invoke 直呼；IPC 经 store 动作的 loader 注入（现有 `activateFolder/open/save` 已接受 loader，组件把 `api/songs.ts` 封装传入）。
- **生产/测试分离**：
  - Rust 纯逻辑单测 inline `#[cfg(test)] mod tests`（cover 编解码、split_track_pair、serde 形状）留在各 service 模块；文件 I/O 集成测试迁 `src-tauri/tests/`（`common/mod.rs` 收 tiny_png_bytes/add_tags/write_tagged_flac/write_tagged_mp3/full_song，`list_songs.rs`/`open_song.rs`/`save_song.rs` 按命令域拆）。原 `commands.rs` 内 28 个测试全部迁移/内联，删除大 `mod tests`。
  - 前端 co-located `*.test.ts`：`tauri.test.ts`→`api/client.test.ts`、`song.test.ts` 合并 `store.test.ts`（修重复 import）、`songlist-repro.test.ts`→`songlist.test.ts`、`theme.test.ts` 原位。
- **文档**：`docs/design/design.md` §10 补「目录分层规范 + 测试放置约定 + 未来子变更落位说明」。

## Risks / Trade-offs

- **行为回归**（最大风险）：save_song 全量覆盖语义（clear 重建/空字段不写/cover=None 删除/MP3 USLT lang=eng/原子写）、open_song 读标签（lyrics_source 判定/TRCK 拆分/RecordingDate→Year 回退/坏标签 Err）、serde 形状——必须逐行原样移动。保障：现有测试迁入 `src-tauri/tests/` 后全绿；`npm run tauri dev` 人工走通打开/读取/保存。
- **dirty 响应式**：dirty 是 reactive 字面量内 getter（Vue 3.5 live computed），拆分时不得挪出，否则实时翻转失效。保障：song.test.ts 编辑字段→dirty 断言。
- **前端 mock 兼容**：`api/client.ts` 必须保留 `import { invoke } from '@tauri-apps/api/core'`，否则 editor.test.ts 的 `vi.mock('@tauri-apps/api/core')` 失效。
- **import 联动**：fileName/titleText/artistText/契约类型多处跨文件 import，需一次性同步，漏改即 tsc/vitest 编译失败可捕获。
- **跨文件重构一次性**：Rust 大 mod tests 迁移 + service 提升 pub 需同 PR 完成，避免中间态不可编译。

## Dependency Order

Rust 全量：T1 model → T2 cover → T3 meta → T4 reader → T5 writer/fs_atomic → T6 commands 薄层 + lib.rs → T7 tests 外置。
前端：T8 api 层 → T9 api/songs.ts + 组件接入 → T10 store/selectors + lib/path → T11 测试规范化。
T12 文档：T7/T8 后可并行，最后统一验证（cargo test + cargo clippy + npm run test + npm run build）。
