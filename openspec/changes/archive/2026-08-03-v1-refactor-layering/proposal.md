## Why

Epic V1 已实现 4/10 子变更（v1-skeleton / v1-folder-list / v1-song-read / v1-song-save），代码量与复杂度显著增长，但当前结构未做合理分层：

- **Rust 侧**：`src-tauri/src/commands.rs` 单文件 1187 行，领域模型、4 个 command、读取/写回业务、封面 base64 编解码、28 个测试 + 5 组 fixture 全部平铺同文件；command 层、service 业务、领域模型无分层，无法按功能模块独立演进。
- **前端侧**：`store/song.ts` 混 4 类职责（状态接口/纯工具/展示派生/动作）；`lib/tauri.ts` 把 invoke 客户端与契约类型揉在一起；IPC 调用（`pick_folder`/`list_songs`/`open_song`）直接散落在组件里，无集中 api 层。
- **测试混杂**：生产文件近 2/3 是测试代码（`commands.rs` 内 28 个 `#[test]`）；前端 `store.test.ts` 有重复 import 缺陷、`songlist-repro.test.ts` 按 bug 号命名而非按被测单元。

后续 `v1-cover-embed` / `v1-lyrics-lrc` / `v1-search-backend` 等子变更即将到来，当前平铺结构没有落位空间，继续叠加会进一步恶化。本变更在下一子变更前插入一次**纯重构**：只做分层、拆文件、隔离生产/测试代码，**不改任何产品行为**。

## What Changes

- **Rust 4 层**：
  - `commands/` 薄层：`folder.rs`（pick_folder、list_songs）+ `song.rs`（open_song、save_song），只留 `#[tauri::command]` 壳与参数/返回值直通，命令名不变。
  - `service/` 业务层：`reader.rs`（标签读取）、`writer.rs`（保存编排）、`meta.rs`（字段映射/格式分支）、`cover.rs`（封面 base64 data URL 编解码）、`fs_atomic.rs`（原子写盘）。
  - `model.rs` 领域模型：`Song`/`SongSummary`/`LyricsSource` serde 契约。
  - `lib.rs` 只做 mod 声明 + `generate_handler` 注册。
- **前端 4 层**：
  - `api/` 唯一 IPC 入口：`client.ts`（invokeCommand）+ `types.ts`（契约类型）+ `songs.ts`（类型化命令封装）。
  - `store/`：守 design.md §10.2 单 store，`song.ts` 只留 reactive 状态与动作（dirty getter 原位保留）+ `selectors.ts`（纯展示派生）。
  - `lib/`：`path.ts` 纯工具。
  - `components/`：纯展示，零 invoke 直呼，经 `api/songs.ts` 注入。
- **生产/测试分离**：
  - Rust 文件 I/O 集成测试迁 `src-tauri/tests/`（`common/mod.rs` 收 fixture），纯逻辑单测留 service 内 inline `mod tests`。
  - 前端约定 co-located `*.test.ts`；修复 `store.test.ts` 重复 import；`songlist-repro.test.ts` 改名 `songlist.test.ts`。
- **文档**：`docs/design/design.md` §10 补「目录分层规范 + 测试放置约定 + 未来子变更落位」。

## Capabilities

### New Capabilities
- `refactor-layering`: 前后端分层重构 + 生产/测试代码隔离（行为不变）

### Modified Capabilities
- `folder-list` / `song-read` / `song-save`（内部模块路径重组，**对外 Tauri command 契约与 UI 行为零改动**）

## 关联 Issue

- GitHub Issue：`#30`（变更前已建，作为本变更锚点；分支提交 `feat(30): ...`、PR `Closes #30`）

## Impact

- 零功能新增、零行为变更；Tauri command 契约（`pick_folder`/`list_songs`/`open_song`/`save_song`）、前端 invoke 调用、UI 文案与交互全部不变。
- 纯移动/拆分/改名，代码语义逐行原样保留；回归保障靠现有测试迁移后全绿 + `npm run tauri dev` 人工走一遍打开/读取/保存。
- 为后续 `v1-cover-embed`（复用 `service/cover.rs`）、`v1-lyrics-lrc`（`service/lyrics.rs`）、`v1-search-backend`（`service/searcher/*`）、`v1-search-ui`（`api/search.ts`）预留分层落位。
