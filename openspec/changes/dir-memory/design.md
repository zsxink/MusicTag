## Context

每次启动需手动导航到音乐目录。需持久化 `last_dir` 并启动自动加载。项目已有 `localStorage` 存主题的先例，但目录是文件系统概念、且 `pick_folder`/`list_songs` 都在 Rust 侧——存 Rust 侧配置文件更贴近后端职责、跨端可靠（已拍板）。

## Goals / Non-Goals

**Goals:**
- Rust 侧 `config.json` 持久化 `last_dir`（dirs 定位平台配置目录）。
- 启动自动加载上次目录（复用 `activateFolder` 激活链路）。
- 选择器默认定位上次目录。
- 换目录即持久化。
- 目录已删/损坏/缺失 → 静默降级，不 panic。

**Non-Goals:**
- 不保存选中歌曲/编辑草稿/搜索候选（YAGNI，V1 无需求）。
- 不改既有 dirty 拦截（换目录确认）语义。
- 不引入 tauri-plugin-store（沿用轻量 config.json + serde）。

## Decisions

### 1. 配置存储（Rust 侧 service/config.rs）

`default_config_path()` = `dirs::config_dir()/musictag/config.json`（macOS `~/Library/Application Support/`、Linux `~/.config/`、Windows `%APPDATA%`）；无 config_dir → 回退 `./`。

读写函数接受 `path` 参数（生产传默认路径，测试传临时路径）：

```rust
pub fn default_config_path() -> PathBuf
pub fn load_last_dir(path: &Path) -> Option<String>   // 缺失/损坏/目录已删 → None
pub fn save_last_dir(path: &Path, dir: &str) -> Result<(), String>  // 原子写（临时文件+rename）
```

新增 `dirs` crate 依赖。

### 2. command 层（commands/folder.rs）

```rust
#[tauri::command]
pub fn pick_folder() -> Option<String> {
    let mut dialog = FileDialog::new();
    if let Some(dir) = config::load_last_dir(&config::default_config_path()) {
        dialog = dialog.set_directory(dir);
    }
    dialog.pick_folder().map(|d| d.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn get_last_dir() -> Option<String> {
    config::load_last_dir(&config::default_config_path())
}

#[tauri::command]
pub fn save_last_dir(dir: String) {
    let _ = config::save_last_dir(&config::default_config_path(), &dir); // fire-and-forget
}
```

`lib.rs` `generate_handler![...]` 追加 `get_last_dir` / `save_last_dir`。

### 3. 前端

- `api/songs.ts`：`getLastDir()` / `saveLastDir(dir)` 封装。
- `store/song.ts`：
  - `initLastDir(dir, loadSongs)`：dir 非空 → `activateFolder(dir, loadSongs)`（复用激活链路，dirty 拦截不需要——启动时无 dirty）。dir 由调用方（SongList onMounted）从 `getLastDir()` 获取后传入，store 不依赖 IPC 类型。
  - `rememberLastDir(dir, saveDir)`：调 `saveDir(dir)`，失败静默。
  - `activateFolder` 末尾 `void rememberLastDir(dir, saveLastDir)`（fire-and-forget，不阻塞列表加载）。
- `SongList.vue` onMounted：`getLastDir()` → 非空 → `initLastDir(dir, (d) => listSongs(d))`；保留既有 keydown 监听。

### 4. 文档同步

- `design.md §10.3`：command 契约表追加 `get_last_dir` / `save_last_dir`，`pick_folder` 描述加起始目录。
- `design.md §10.0`：Rust 表格 `service/` 行追加 `config.rs`。
- `V1-PRD.md` FR-1：补「记住上次目录」。
- §10.4 不重复编辑（已由 `rust-tests-separation` 先行完成）。

## Risks

- `activateFolder` 接入 `rememberLastDir` 后，既有 store 测试若未 mock `save_last_dir` IPC 会走真实 invoke——检查 song.test.ts 现有 mock（`vi.mock('@tauri-apps/api/core')`），补 `get_last_dir`/`save_last_dir` 分支。
- `dirs::config_dir()` 在测试环境返回系统真实配置目录——config.rs 函数接受 path 参数规避（测试传 temp dir），生产才用 `default_config_path()`。
