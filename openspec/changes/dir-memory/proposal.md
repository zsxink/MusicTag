## Why

每次启动 MusicTag 都要重新点「打开文件夹」导航到音乐目录，且原生选择器每次都从系统默认位置打开。用户需要一个「记住上次打开的文件目录」的能力：重启自动加载上次目录、选择器默认定位，减少重复导航。

## What Changes

- **Rust 配置读写**：新增 `service/config.rs`——`dirs::config_dir()/musictag/config.json` 存 `last_dir`，原子写（临时文件 + rename），文件不存在/损坏/目录已删 → 静默 `None`。
- **新 command**：`get_last_dir() -> Option<String>`、`save_last_dir(dir: String)`。
- **pick_folder 默认定位**：有上次目录 → `rfd` 选择器 `set_directory(last_dir)`；无（首次）→ 系统默认位置。
- **前端启动自动加载**：`SongList onMounted` → `getLastDir()` 非空 → `initLastDir` 复用 `activateFolder` 激活链路（含列表加载、搜索重置语义）。
- **换目录即持久化**：`activateFolder` 成功后 fire-and-forget 调 `saveLastDir(dir)`。
- **新增依赖**：`dirs` crate。
- 测试：`tests/config_tests.rs`（Rust 读写/原子写/损坏降级）+ store 测试。

## Capabilities

### New Capabilities
- `dir-memory`: 应用记住上次打开的文件目录——Rust 侧 `config.json` 持久化 `last_dir`，启动自动加载、选择器默认定位、换目录即更新。

### Modified Capabilities
- `folder-open`: `pick_folder` 支持起始目录定位；`list_songs` 语义不变（目录不存在 → 空列表）。

## 关联 Issue

GitHub Issue：`#91`（分支提交 `feat(91): ...`、PR `Closes #91`）

## Impact

- `src-tauri/src/service/config.rs`：新增（dirs + serde 读写）。
- `src-tauri/src/commands/folder.rs`：`pick_folder` 加起始目录；新增 `get_last_dir` / `save_last_dir`。
- `src-tauri/src/lib.rs`：注册两个新 command。
- `src-tauri/Cargo.toml`：新增 `dirs` 依赖。
- `src-tauri/tests/config_tests.rs`：新增。
- `src/api/songs.ts`：`getLastDir` / `saveLastDir` 封装。
- `src/store/song.ts`：`initLastDir` / `rememberLastDir` 动作；`activateFolder` 内接入持久化。
- `src/components/SongList.vue`：onMounted 启动自动加载。
- 文档同步：`docs/design/design.md` §10.3 command 契约 + §10.0 service 落位、`docs/V1-PRD.md` FR-1「记住上次目录」。
