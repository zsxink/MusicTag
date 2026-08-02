## Context

`v1-skeleton-tauri` 已建立 Tauri 2 + Vue3/Vite/TS 空壳与 `invoke` 封装 seed。本变更实现「打开文件夹 → 深度遍历 → 左栏列表」链路。

## Goals / Non-Goals

**Goals:**
- `list_songs(dir)` command：深度遍历收集 FLAC/MP3，**只读列表项**（`SongSummary { path, title, artist }`），首扫几乎零 I/O。
- 左栏 SongList：展平、回退文件名、搜索过滤、升序排序、空态、选中高亮。
- 顶栏 appbar 显示当前目录绝对路径。

**Non-Goals:**
- 不读全量标签/封面（属 `v1-song-read`）。
- 不做换目录未保存拦截（弹窗组件由 `v1-ux-settings` 抽象，本变更预留）。

## Decisions

- **`SongSummary` 契约落点**：本变更定义 `struct SongSummary { path: String, title: String, artist: String }`，`list_songs(dir: String) -> Vec<SongSummary>`。title/artist 从标签读取，但**不 trim**；空判定在前端 `trim()===""`（FR-2a）。
- **遍历**：`walkdir` 递归，扩展名 `.flac`/`.mp3` 不区分大小写（`Path::extension()` + eq_ignore_ascii_case）。
- **排序**：前端按 `path` 文件名升序排（V1 不做排序切换，FR-2.4）。
- **搜索过滤**：前端本地过滤（歌名/作者包含，忽略大小写），数据量级数百首无压力。
- **rfd 对话框**：在 Rust command `pick_folder() -> Option<String>` 内调用原生选择器，返回目录绝对路径后前端再 `list_songs`。
- **选中态**：前端 store 持 `selectedPath`，行高亮用 design.md 的 `--active` 琥珀透明底。

## Risks / Trade-offs

- 深度遍历大目录可能慢：`walkdir` 顺序遍历，面向数百首量级秒开；超千级时后续可加并行/忽略规则，V1 不优化。
- 列表只读 `title`/`artist`，读取损坏标签时返回空串而非报错，保证列表永不因单曲坏标签崩溃。
