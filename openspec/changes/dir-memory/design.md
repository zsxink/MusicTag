# dir-memory 技术设计

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

新增 `dirs` crate 依赖（`dirs::config_dir()`）。

**原子写细节**：`save_last_dir` 先 `fs::create_dir_all(parent)`（首次运行 `musictag/` 目录尚不存在，须先建目录再写文件），临时文件放**同一父目录**（保证同卷，`fs::rename` 原子替换）——复用 `fs_atomic.rs` 的 tempfile+persist 模式（`tempfile::NamedTempFile::new_in(parent)` 写 `serde_json::to_string` 后 `persist(path)`），写失败返回 `Err`，命令层静默吞掉（fire-and-forget），不 panic。

**目录已删降级**：`load_last_dir` 解析出 `last_dir` 字符串后必须 `Path::new(&last_dir).is_dir()` 校验——目录不存在或非目录 → `None`（spec「目录已删降级」）。该校验同时保护 `get_last_dir` 与 `pick_folder` 的起始定位，二者都不会打开不存在的目录。

**仅目录**：serde 结构体只含 `last_dir` 单字段（spec「不保存编辑状态」）：`#[derive(Serialize, Deserialize)] struct Config { last_dir: Option<String> }`——不持久化选中歌曲/编辑草稿/搜索候选；`load_last_dir` 用 `serde_json::from_str`：JSON 损坏 → `None`；`last_dir` 为 `Option` 字段，字段缺失反序列化默认 `None`（与损坏同归静默降级）；`last_dir` 为空串（`""`）→ 以 `.filter(|d| !d.is_empty())` 过滤为 `None`（防空串路径打开当前目录）。两个边界分别有测试锚定：`missing_last_dir_field_returns_none`（字段缺失）、`empty_string_last_dir_returns_none`（空串）。spec「仅目录」与写失败路径亦分别由 `config_json_contains_only_last_dir_field`（断言 config.json 只含 `last_dir` 单字段）与 `save_failure_reports_err`（写失败 → `Err`，命令层 fire-and-forget 吞掉，下次启动自然降级）锚定。

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

**返回类型**：`save_last_dir` 返回 `()`（fire-and-forget，不向外报错——spec 无错误呈现需求；失败静默，下次启动自然降级为无记忆）。`get_last_dir` / `save_last_dir` 命名经 Tauri camelCase↔snake_case 自动映射到前端 `getLastDir` / `saveLastDir`（既有 `open_song`↔`openSong` 同先例）。三个 command 均为薄壳，业务全在 `service/config.rs`，无 lofty/IO 逻辑漏进 command 层（§10.0 分层规范）。

### 3. 前端

- `api/songs.ts`：`getLastDir()` / `saveLastDir(dir)` 封装（`invokeCommand` 透传，类型 `Promise<string | null>` / `Promise<void>`）。
- `store/song.ts`：
  - 顶部 `import { saveLastDir } from '../api/songs'`（沿用 `defaultSave` / `defaultRename` 先例——store 依赖 api 是 §10.0 允许方向，组件零 invoke 直呼不变）。
  - `rememberLastDir(dir, saveDir = saveLastDir)`：`saveDir(dir)` 包 try/catch，失败静默（可注入，仿 `saveFn` 先例，store 单测可传 spy 桩）。
  - `activateFolder` 末尾 `void rememberLastDir(dir)`（fire-and-forget，不阻塞列表加载）。**持久化点唯一收敛于 `activateFolder`**：手动路径（`requestFolder` → dirty 拦截 → `resolvePending` 后）与启动路径（`initLastDir` → `activateFolder`）都汇到这里，保证「成功切换才持久化」且不重复。
  - `initLastDir(dir, loadSongs)`：dir 非空 → `activateFolder(dir, loadSongs)`（复用激活链路，含列表加载、搜索重置语义；启动时无 dirty，不经 `requestFolder` 弹窗）；dir 空 / undefined（`getLastDir` 返回 None，含目录已删）→ no-op，保持「未打开文件夹」空态。dir 由调用方（SongList onMounted）从 `getLastDir()` 获取后传入，store 不依赖 IPC 类型。
- `SongList.vue` onMounted：`getLastDir()` → 非空 → `initLastDir(dir, (d) => listSongs(d))`；保留既有 keydown 监听。onMounted 内异步调用不阻塞渲染；启动期用户手点打开与 `getLastDir` 竞态窗口极小（onMounted 立即触发、响应先于用户交互），不额外处理。

### 4. 文档同步

- `design.md §10.3`：command 契约表追加 `get_last_dir` / `save_last_dir` 两行；`pick_folder` 描述补「有上次目录 → 选择器默认定位到该目录」。
- `design.md §10.0`：Rust 表格 `service/` 行追加 `config.rs`（纯配置读写，`dirs` 定位平台配置目录）。
- `V1-PRD.md` FR-1：补「记住上次目录」条目。
- §10.4 不重复编辑（已由 `rust-tests-separation` 先行完成）。

### 5. 变更域与依赖序

**变更域：both（跨前后端）**。Rust 定义 IPC 契约（command 名/参数/返回）→ 前端 `api/songs.ts` 封装 → store 动作 → 组件消费。

**依赖序：Rust → Vue 串行**（未显式创建 worktree 时禁止并写）：
- Rust 先（G1 `service/config.rs` → G2 `commands/folder.rs` + `lib.rs` 注册），产出 `get_last_dir` / `save_last_dir` 契约；
- Vue 后（G3 `api/songs.ts` 封装 + store 动作 → G4 SongList 启动加载），TS 封装类型与 camelCase 映射以 Rust command 契约为准、store 持久化测试的 mock 依赖 `api/songs.ts` 新增函数存在。

## Risks

- `activateFolder` 接入 `rememberLastDir` 后，其既有 store 用例都会经 `api/songs.ts` 的 `invokeCommand` 调真实 `invoke`。song.test.ts **当前只 `vi.mock('../api/search')`，并未 mock `@tauri-apps/api/core`**（§10.2 的 mock 依赖仅适用于 editor/client 测试）——须在 song.test.ts **新增** `vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined) }))`，使 `save_last_dir` 等 IPC 变 no-op（fire-and-forget 吞掉即可），否则激活路径用例报 unhandled rejection。
- `dirs::config_dir()` 在测试环境返回系统真实配置目录——config.rs 函数接受 path 参数规避（测试传 temp dir），生产才用 `default_config_path()`。
