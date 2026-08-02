## Context

`v1-skeleton-tauri` 已建立 Tauri 2 + Vue3/Vite/TS 空壳与 `invoke` 封装 seed。本变更实现「打开文件夹 → 深度遍历 → 左栏列表」链路（V1 核心流程第一步，M1）。

## Goals / Non-Goals

**Goals:**
- `pick_folder()` command：`rfd` 原生文件夹选择器，返回目录绝对路径。
- `list_songs(dir)` command：深度遍历收集 FLAC/MP3，**只读列表项**（`SongSummary { path, title, artist }`），首扫几乎零 I/O。
- 左栏 SongList：展平、回退文件名、搜索过滤、升序排序、空态、选中高亮。
- 顶栏 appbar 显示当前目录绝对路径（mono 字体），`⌘O`/`Ctrl+O` 快捷键。

**Non-Goals:**
- 不读全量标签/封面（属 `v1-song-read`）。
- 不做换目录未保存拦截（弹窗组件由 `v1-ux-settings` 抽象，本变更仅搭接续入口；换目录拦截逻辑随后续补）。
- 不做排序切换（V1 固定文件名升序，FR-2.4）。
- 不做目录树（展开列表，FR-2.1）。

## 技术方案

### 模块划分

**Rust 侧（`src-tauri/src/`）**
- `commands.rs`（或按 skeleton 既有结构接入）新增两个 command：`pick_folder`、`list_songs`，注册进 `invoke_handler`。
- `list_songs` 内部：`walkdir` 深度递归 → 扩展名过滤（`.flac`/`.mp3`，大小写不敏感）→ `lofty` 读每文件 `title`/`artist` → 组装 `Vec<SongSummary>`。
- `SongSummary` struct：`#[derive(Serialize, Deserialize)]`，字段 `path`/`title`/`artist` 均 `String`。只读列表项，不读封面/歌词/其它标签。

**前端侧（`src/`）**
- `components/AppBar.vue`：品牌 + 当前目录绝对路径（mono）+ 最右主题按钮占位。
- `components/SongList.vue`：顶部「打开文件夹」按钮 + 搜索框 + 列表容器。
- `components/SongRow.vue`：单行「作者 - 歌名」/ 回退文件名。
- `store/song.ts`：新增 `folderPath` / `songs: SongSummary[]` / `searchQuery` / `selectedPath` 状态 + `filteredSongs` computed。

### 数据流

```
[打开文件夹 按钮 / ⌘O]
   → invoke('pick_folder')
   → Rust: rfd 原生选择器 → Option<String>（取消返回 None）
   → 前端：None 则无视；Some(dir) 则
       1. set folderPath（appbar 展示）
       2. invoke('list_songs', { dir })
       3. → Rust: walkdir + lofty → Vec<SongSummary>
       4. → 前端 songs = 结果；selectedPath 重置为 null
   → computed filteredSongs = 搜索过滤 + 按 path 文件名升序
```

### Tauri command 契约

对齐 `docs/design/design.md` §10.3（本变更定义 `SongSummary`、`list_songs` / `pick_folder` 签名，后续在其上加完整 `Song`）：

```ts
interface SongSummary { path: string; title: string; artist: string; }
```

| command | 参数 → 返回 | 用途 |
|---|---|---|
| `pick_folder()` | `() → string \| null` | 打开原生文件夹选择器，返回目录绝对路径；取消返回 null |
| `list_songs(dir)` | `dir: PathBuf → Vec<SongSummary>` | 深度遍历收集；只读列表项 |

> 契约说明：PRD §7 命令表写 `list_songs(dir) -> Vec<Song>`，但按需读取原则列表只返回 `SongSummary`（`design/design.md` §10.3 已是该定义），本变更以 §10.3 为准。

## 关键技术决策

- **`SongSummary` 契约落点在本变更**：列表轻量项独立于完整 `Song`，避免 `list_songs` 读全量标签违背 NFR「按需读取」。`title`/`artist` 从标签读取但**不 trim**；空判定在前端 `trim()===""`（FR-2a / spec「空标签回退文件名」）。
- **坏标签容错**：`list_songs` 读单文件标签失败时返回空串而非报错，保证列表永不因单曲坏标签崩溃（FR-5.7 只读禁编辑在 `v1-song-read` 才体现，列表层先健壮）。
- **遍历**：`walkdir` 递归，`Path::extension()` + `eq_ignore_ascii_case` 匹配 `.flac`/`.mp3`；非音频（`.wav`/`.txt` 等）不进列表。
- **排序**：前端按 `path` 文件名升序排（文件名取自 path 最后段）。V1 不做排序切换（FR-2.4）。
- **搜索过滤**：前端 `filteredSongs` computed，按歌名/作者包含、忽略大小写；量级数百首无压力（NFR）。
- **rfd 对话框**：在 Rust command `pick_folder` 内调用原生选择器；返回目录绝对路径后前端再 `list_songs`（两段式命令，非组合）。
- **快捷键**：`⌘O`/`Ctrl+O`——前端 JS 监听（`metaKey||ctrlKey && key==='o'`）。窗口焦点在前端 WebView，JS 监听足够，不引自定义快捷键插件（依赖精简）。
- **选中态**：前端 store 持 `selectedPath`；行高亮用 design.md `--active` 琥珀透明底 + 歌名变琥珀（组件状态「歌曲行 selected」）。
- **空态**：复用「空状态」形态——图标 40px 35% 透明 + 标题 + 副说明（design.md §6.1）。空文件夹与搜索无匹配各一套文案。

## 变更域判断

**跨前后端（both）**：一方是新增 Rust 命令与结构（backend），另一方是 AppBar/SongList/store（frontend）。依赖顺序：**Rust → Vue**——先实现并测通 `pick_folder` / `list_songs`（含 serde 契约），前端再接入。契约锚点：`SongSummary` TS 类型与 Rust struct 字段一一对应（`path`/`title`/`artist` 均 string），CSS token 复用 `docs/design/design.md`（`--active`、mono 等）。

## 任务分组建议

见 `tasks.md`，Rust 优先于前端接入；前端 TS 类型与 Rust 契约对齐放最后做端到端接通。

## Risks / Trade-offs

- **深度遍历大目录可能慢**：`walkdir` 顺序遍历，面向数百首量级秒开；超千级后续可加并行/忽略规则，V1 不优化（M1 验收仅要求 300–500 首秒级）。
- **列表读坏标签返回空串**：以封面空串 + 前端回退文件名兜底，列表层不抛错；只读交互语义留给 `v1-song-read`。
- **平台差异**：`rfd` 在各平台（macOS/Windows/Linux）原生对话框行为不同，但返回绝对路径统一；`⌘O`/`Ctrl+O` 键码分支按平台判定。
