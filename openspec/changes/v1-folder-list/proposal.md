## Why

用户要能打开本地文件夹、深度遍历收集全部 FLAC/MP3，在左栏看到展平歌曲列表（作者+歌名）。这是 V1 核心流程的第一步，也是列表「按需读取」性能约束的落点——首扫只读 `path`/`title`/`artist`，不读全量标签。

## What Changes

- 顶栏 appbar 显示当前文件夹绝对路径（mono 字体）。
- 「打开文件夹」按钮位于左侧栏顶部，快捷键 `⌘O`（Win/Linux: `Ctrl+O`），弹出系统原生文件夹选择器（`rfd`）。
- 新增 Rust command `list_songs(dir) -> Vec<SongSummary>`：深度遍历（递归子目录，`walkdir`）收集 `.flac`/`.mp3`（扩展名不区分大小写），只读列表项（`path`/`title`/`artist`）。
- 左侧栏展平列表：每行显示作者 + 歌名；title/artist 由前端 `trim()===""` 判定为空 → 回退显示文件名（去扩展名）；顶部搜索框按歌名/作者模糊过滤；默认按文件名升序排序；空文件夹/无匹配时空状态提示；点击行选中高亮。
- 重新打开文件夹整体替换列表；换目录有未保存修改时的三选一弹窗由 `v1-ux-settings` 统一抽象，本变更仅搭接续入口（dirty 判定依赖 v1-song-read 的 store，换目录拦截逻辑随后续补）。

## Capabilities

### New Capabilities
- `folder-list`: 打开文件夹 + 深度遍历收集歌曲 + 左栏列表展示/搜索/过滤/选中

### Modified Capabilities
（无）

## Impact

- 新增 Rust 依赖：`rfd`（对话框）、`walkdir`（遍历）、`lofty`（读 title/artist）。
- 新增前端组件：AppBar 路径显示、SongList、SongRow。
- 契约落点：本变更定义 `SongSummary { path, title, artist }` 与 `list_songs` 签名，后续 `v1-song-read` 在其上加完整 `Song`。
