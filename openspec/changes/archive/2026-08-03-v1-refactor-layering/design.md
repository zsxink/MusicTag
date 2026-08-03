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

## 技术方案（Tech Plan）

### 1. Rust 四层 + 集成测试外置

**目录结构（目标态）：**

```
src-tauri/
├── src/
│   ├── main.rs            # 不变：fn main { app_lib::run() }
│   ├── lib.rs             # pub mod model; pub mod commands; pub mod service; + generate_handler
│   ├── model.rs           # SongSummary / LyricsSource / Song（纯 serde 契约，无逻辑）
│   ├── commands/
│   │   ├── mod.rs         # pub mod folder; pub mod song;
│   │   ├── folder.rs      # pick_folder / list_songs（薄壳）
│   │   └── song.rs        # open_song / save_song（薄壳）
│   └── service/
│       ├── mod.rs
│       ├── reader.rs      # read_summary / read_song_meta（读标签）
│       ├── writer.rs      # save_song 编排（probe→clear→apply_meta→write_atomic）
│       ├── meta.rs        # is_audio_file / split_track_pair / apply_meta / set_text / apply_lyrics / apply_cover
│       ├── cover.rs       # encode_cover / encode_data_url / decode_cover（纯逻辑）
│       └── fs_atomic.rs   # write_atomic（临时文件 + rename 原子替换）
└── tests/
    ├── common/mod.rs      # fixture：tiny_png_bytes / add_tags / write_tagged_flac / write_tagged_mp3 / full_song
    ├── list_songs.rs
    ├── open_song.rs
    └── save_song.rs
```

**函数级落位表（逐函数原样移动，函数体不改一行）：**

| 现有函数（commands.rs） | 目标模块 | 依赖 |
|---|---|---|
| `SongSummary` / `LyricsSource` / `Song` | `model.rs` | serde 注解原样保留 |
| `is_audio_file` / `split_track_pair` / `apply_meta` / `set_text` / `apply_lyrics` / `apply_cover` | `service/meta.rs` | lofty `ItemKey`/`Tag`/`TagItem` |
| `encode_cover` / `encode_data_url` / `decode_cover` | `service/cover.rs` | base64 + `image::guess_format` |
| `read_summary` / `read_song_meta` | `service/reader.rs` | `meta::split_track_pair` + `cover::encode_cover` |
| `write_atomic` | `service/fs_atomic.rs` | tempfile + std::fs |
| `save_song` 编排体（probe→clear→apply_meta→write_atomic） | `service/writer.rs` | `meta::apply_meta` + `fs_atomic::write_atomic` |
| `pick_folder` / `list_songs`（保留 `#[tauri::command]`） | `commands/folder.rs` | `reader::read_summary` + `meta::is_audio_file` |
| `open_song` / `save_song`（薄壳：收参→委托 service→包返回值） | `commands/song.rs` | `reader::read_song_meta` / `writer::save_song` |
| `mod` 声明 + `generate_handler` | `lib.rs` | — |

**数据流：**
- `list_songs(dir)`：commands/folder.rs → `WalkDir` 深度遍历 → `meta::is_audio_file` 过滤 → `reader::read_summary` 读 title/artist（不 trim）→ `Vec<SongSummary>`。
- `open_song(path)`：commands/song.rs → `reader::read_song_meta`：读全量标签 → `meta::split_track_pair` 拆 TRCK → `cover::encode_cover` 组 data URL → `Song`（读失败返回 Err → 前端坏标签只读）。
- `save_song(song)`：commands/song.rs → `writer::save_song`：`Probe` 格式校验 → `primary_tag_mut().clear()` 重建 → `meta::apply_meta`（set_text / apply_lyrics / apply_cover）→ `fs_atomic::write_atomic`（临时文件 + rename 原子替换，失败不碰原文件）。

**集成测试访问路径（关键）：** Cargo.toml 声明 `[lib] name = "app_lib"`（含 rlib），`src-tauri/tests/*.rs` 用 `use app_lib::{commands::{folder, song}, service::{reader, writer, meta, cover, fs_atomic}};` 直接调用被测函数。因此 **lib.rs 必须把模块声明提升为 `pub`**（当前 `mod commands;` 私有）：`pub mod model; pub mod commands; pub mod service;`。命令函数本身已是 `pub fn`；service 函数需从私有提升 `pub`。

**测试归类规则（28 个测试的迁移判定）：**
- **纯逻辑**（无 fs/TempDir/lofty 写盘）：cover 编解码往返、`split_track_pair`、serde 形状（`lyrics_source` / `song` / `summary` serialize）→ 留在所属 service 模块的 inline `#[cfg(test)] mod tests`。
- **文件 I/O**（写 fixture、`TempDir`、lofty 写盘）：list_songs / open_song / save_song 各命令域 → 外置 `src-tauri/tests/{list_songs,open_song,save_song}.rs`，fixture 收 `tests/common/mod.rs`。
- 迁移完成后删除 commands.rs 内大 `mod tests`。

### 2. 前端四层

**目录结构（目标态）：**

```
src/
├── api/
│   ├── client.ts          # invokeCommand<T>（仍 import { invoke } from '@tauri-apps/api/core'）
│   ├── client.test.ts     # 原 tauri.test.ts 平移
│   ├── types.ts           # Song / SongSummary / SongCandidate / SearchResult / MusicSourceId / LyricsSource
│   └── songs.ts           # pickFolder / listSongs / openSong / saveSong 类型化封装
├── store/
│   ├── song.ts            # 只留 reactive 状态 + 动作 + dirty getter（原位保留）
│   ├── song.test.ts       # 合并原 store.test.ts（修重复 import）
│   └── selectors.ts       # filteredSongs / titleText / artistText（纯展示派生）
├── lib/
│   └── path.ts            # fileName / fileNameStem 纯工具
├── components/            # 零 invoke 直呼，IPC 经 store 动作的 loader 注入 api/songs.ts
│   ├── songlist.test.ts   # 原 songlist-repro.test.ts 改名规范化
│   └── ...（其余 .vue 原位不动，仅改 import 源）
```

**函数级落位表：**

| 现有 | 目标 | 说明 |
|---|---|---|
| `invokeCommand<T>` | `api/client.ts` | **保留 `import { invoke } from '@tauri-apps/api/core'`**（editor.test.ts / client.test.ts 的 `vi.mock('@tauri-apps/api/core')` 依赖它，改源会静默失效 mock） |
| `MusicSourceId`/`LyricsSource`/`Song`/`SongSummary`/`SongCandidate`/`SearchResult` | `api/types.ts` | 全量契约逐字迁移，`rename_all`/snake_case 形状不变 |
| （新增）`pickFolder()`/`listSongs(dir)`/`openSong(path)`/`saveSong(song)` | `api/songs.ts` | 命令名、参数名、返回类型逐字不变；实现 = `invokeCommand<T>(cmd, args)` 透传 |
| `fileName`/`fileNameStem` | `lib/path.ts` | 纯工具，组件/selectors 共用 |
| `titleText`/`artistText`/`filteredSongs` | `store/selectors.ts` | `filteredSongs` 改为 `computed` 从 `songStore` 派生（排序 + 过滤），selectors → store → api 单向，无环 |
| `selectSong`/`activateFolder`/`open`/`save`/`undo` + `SongEditor` + `DIRTY_FIELDS` + `songStore` | `store/song.ts` | **dirty getter 原位保留在 reactive 字面量内**（Vue 3.5 live computed，挪出即失效） |
| 各 `.vue` | `components/` | 只改 import 源；`save()` 默认 loader 从 `api/songs.ts` 引入 `saveSong` |

**数据流：**
- 打开文件夹：`SongList.vue` → `openFolder()` 调 `pickFolder()` → 非 null 时 `activateFolder(dir, (d) => listSongs(d))`。
- 选中歌曲：`SongRow.vue` → `loadSong = openSong` → `selectSong(path, openSong)` → store.open 读全量（并发守卫不变量不变）。
- 保存：`EditorBar.vue` → `@click="save()"` → store.save 默认 `(song) => saveSong(song)`（经 api/songs.ts → client → invoke）；测试仍可注入自定义 saveFn。

**import 联动清单（一次同步，漏改 tsc/vitest 编译失败可捕获）：** SongList.vue / SongRow.vue / EditorBar.vue / FieldRow.vue / store/song.ts / editor.test.ts / song.test.ts / store.test.ts /（tauri.test.ts → api/client.test.ts）。

**测试规范化：**
- `tauri.test.ts` → `api/client.test.ts`（验证 invoke 透传，mock 保留）。
- `store.test.ts` 并入 `song.test.ts`：修掉第 3–4 行 `import { describe, expect, it, beforeEach }` 与 `import { describe, expect, it, beforeEach, vi }` 的重复 import 缺陷。
- `songlist-repro.test.ts` → `songlist.test.ts`：按被测组件语义组织，**保留 #27 回归断言**（模板勿写 computed `.value`）。
- `theme.test.ts` 原位不动。

## Decisions

- **Rust 4 层**（命令名不变，Tauri 字符串契约零改动）：
  1. `src-tauri/src/commands/`：`mod.rs` + `folder.rs`（pick_folder、list_songs）+ `song.rs`（open_song、save_song）。薄壳：只接参数、委托 service、包返回值，不含 lofty/IO 逻辑。
  2. `src-tauri/src/service/`：`reader.rs`（read_summary、read_song_meta）、`writer.rs`（save_song 编排：probe→clear→apply_meta→write_atomic）、`meta.rs`（apply_meta、set_text、apply_lyrics、apply_cover、split_track_pair、is_audio_file）、`cover.rs`（encode_cover、encode_data_url、decode_cover）、`fs_atomic.rs`（write_atomic：临时文件+rename 原子替换）。函数提升 `pub` 以便 `src-tauri/tests/` 集成测试访问。
  3. `src-tauri/src/model.rs`：`Song`/`SongSummary`/`LyricsSource`（纯 serde 契约，`rename_all`/snake_case 形状逐字保留）。
  4. `lib.rs`：`pub mod model; pub mod commands; pub mod service;` + `generate_handler![commands::folder::pick_folder, commands::folder::list_songs, commands::song::open_song, commands::song::save_song]`。**模块声明必须 pub**（供 `src-tauri/tests/` 集成测试经 `app_lib::` 访问）。
- **前端 4 层**：
  1. `src/api/`：`client.ts`（`invokeCommand<T>`，仍 `import { invoke } from '@tauri-apps/api/core'`，保证既有 `vi.mock` 兼容）、`types.ts`（Song/SongSummary/SongCandidate/SearchResult/MusicSourceId/LyricsSource 全量契约）、`songs.ts`（pickFolder/listSongs/openSong/saveSong 类型化封装）。
  2. `src/store/`：`song.ts` 只留 reactive 状态 + 动作（selectSong/activateFolder/open/save/undo）+ dirty getter（**必须原位保留在 reactive 字面量内**，靠 getter 转 live computed）；`selectors.ts` 纯派生（filteredSongs/titleText/artistText）。
  3. `src/lib/`：`path.ts`（fileName/fileNameStem 纯工具）。
  4. `src/components/`：纯展示，零 invoke 直呼；IPC 经 store 动作的 loader 注入（现有 `activateFolder/open/save` 已接受 loader，组件把 `api/songs.ts` 封装传入）。
- **生产/测试分离**：
  - Rust 纯逻辑单测 inline `#[cfg(test)] mod tests`（cover 编解码、split_track_pair、serde 形状）留在各 service 模块；文件 I/O 集成测试迁 `src-tauri/tests/`（`common/mod.rs` 收 tiny_png_bytes/add_tags/write_tagged_flac/write_tagged_mp3/full_song，`list_songs.rs`/`open_song.rs`/`save_song.rs` 按命令域拆）。原 `commands.rs` 内 28 个测试全部迁移/内联，删除大 `mod tests`。
  - 前端 co-located `*.test.ts`：`tauri.test.ts`→`api/client.test.ts`、`song.test.ts` 合并 `store.test.ts`（修重复 import）、`songlist-repro.test.ts`→`songlist.test.ts`、`theme.test.ts` 原位。
- **文档**：`docs/design/design.md` §10 补「目录分层规范 + 测试放置约定 + 未来子变更落位说明」。

## 关键决策与理由

1. **Tauri command 字符串契约零改动**：`pick_folder`/`list_songs`/`open_song`/`save_song` 四个命令名与参数/返回 serde 形状是跨前后端 + 跨测试的稳定 ABI；改名/改形需同步前端与全部测试，回归面失控。本变更只重排内部模块路径，契约不动 → 回归最小。
2. **service 函数提升 `pub` + lib.rs 模块声明 `pub mod`**：Cargo.toml 的 lib 名是 `app_lib`，`src-tauri/tests/` 集成测试必须经 `app_lib::service::...` 直接调用被测函数；当前 `mod commands;` 私有不满足。提升 pub 是本变更让测试外置成立的前提。
3. **文件 I/O 集成测试外置 `src-tauri/tests/`，纯逻辑留 service 内 inline**：生产文件近 2/3 是测试代码；外置后生产/测试物理隔离，且各命令域（list_songs/open_song/save_song）独立文件便于按功能演进。纯逻辑单测与函数同处（inline）便于发现与维护，两者分界 = 是否触碰文件系统/TempDir。
4. **`api/client.ts` 保留 `import { invoke } from '@tauri-apps/api/core'`**：editor.test.ts 与 client.test.ts 用 `vi.mock('@tauri-apps/api/core')` 拦截 invoke；若改 import 源（如直接裸 invoke 或改名），mock 会静默失效 → 测试跑真实 invoke，无 Tauri 运行时即崩溃。这是前端拆分的硬约束。
5. **dirty getter 原位保留在 reactive 字面量内**：Vue 3.5 把 reactive 对象的 getter 转 live computed，`songStore.dirty` 任何读取即逐字段对比 current/original 实时翻转；挪出 reactive 会失去响应式追踪，dirty 不再随编辑自动更新（违反 FR-5.1「编辑即标记 dirty」）。song.test.ts 有「编辑字段→dirty=true」断言兜底。
6. **原子写盘收 `service/fs_atomic.rs`**：`Tag::save_to` 会就地 `truncate(0)` 重写整个文件，直接写原文件会在中途失败时损坏数据；先拷同目录临时文件再 `rename`（同卷原子替换）是「写失败不损坏原文件」（PRD 稳健）的核心实现，独立成模块便于 cover/lyrics 等后续写入逻辑复用。
7. **跨文件重构一次性完成（不可中间态）**：Rust 大 mod tests 迁移 + service pub 提升、前端 import 源切换都必须同 PR 完成——任何中间态不可编译，靠 `cargo check`/tsc 强制原子性，避免留下半重构分支。

## 变更域判断

- **域：`both`（跨前后端）**。Rust 侧改 `commands.rs`→`commands/`+`service/`+`model.rs` 分层与测试外置；前端侧改 `lib/tauri.ts`→`api/`+`lib/path.ts`、`store/song.ts` 职责拆分、组件 import 源切换与测试卫生。两端目录与 import 均重组（Tauri command 契约本身不变）。
- **依赖顺序：Rust → 前端串行**。Rust 先建 service 层与命令薄层，前端 `api/songs.ts` 与 store 的 loader 注入才有的放矢；未显式创建 worktree 时禁止并行并写（架构约束）。
- **在 epic 中的位置**：epic.json 已登记 `domain: both`、`dependsOn: [v1-song-save]`、`status: todo`、`cursor: 4`。本变更为后续子变更铺路：v1-cover-embed 复用 `service/cover.rs`、v1-lyrics-lrc 落 `service/lyrics.rs`、v1-search-backend 落 `service/searcher/*`、v1-search-ui 落 `api/search.ts`。

## 依赖顺序（任务映射）

Rust 全量：T1 model → T2 cover → T3 meta → T4 reader → T5 writer/fs_atomic → T6 commands 薄层 + lib.rs（pub mod）→ T7 tests 外置。
前端：T8 api 层（client/types）→ T9 api/songs.ts + 组件接入 → T10 store/selectors + lib/path → T11 测试规范化。
T12 文档：T7/T8 后可并行，最后统一验证（cargo test + cargo clippy + npm run test + npm run build）。

## Risks / Trade-offs

- **行为回归**（最大风险）：save_song 全量覆盖语义（clear 重建/空字段不写/cover=None 删除/MP3 USLT lang=eng/原子写）、open_song 读标签（lyrics_source 判定/TRCK 拆分/RecordingDate→Year 回退/坏标签 Err）、serde 形状——必须逐行原样移动，**不得顺手优化/重构函数体**（任何语义变化都越界）。保障：现有测试迁入 `src-tauri/tests/` 后全绿；`npm run tauri dev` 人工走通打开/读取/保存。
- **dirty 响应式**：dirty 是 reactive 字面量内 getter（Vue 3.5 live computed），拆分时不得挪出，否则实时翻转失效。保障：song.test.ts 编辑字段→dirty 断言。
- **前端 mock 兼容**：`api/client.ts` 必须保留 `import { invoke } from '@tauri-apps/api/core'`，否则 editor.test.ts 的 `vi.mock('@tauri-apps/api/core')` 失效。
- **集成测试访问**：lib.rs 模块声明忘记 `pub` 或 service 函数未提 pub → `src-tauri/tests/` 下 `use app_lib::...` 编译失败，第一步 `cargo check` 即暴露（快速失败）。
- **import 联动**：fileName/titleText/artistText/契约类型多处跨文件 import，需一次性同步，漏改即 tsc/vitest 编译失败可捕获。
- **跨文件重构一次性**：Rust 大 mod tests 迁移 + service 提升 pub 需同 PR 完成，避免中间态不可编译。
