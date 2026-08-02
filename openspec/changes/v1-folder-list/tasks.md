# 任务拆解（依赖序：Rust → Vue）

## 1. Rust：文件夹选择 + 深度遍历

- [ ] 1.1 添加依赖：`rfd`、`walkdir`、`lofty` 到 src-tauri/Cargo.toml
- [ ] 1.2 实现 `pick_folder() -> Option<String>` command（rfd 原生选择器）
- [ ] 1.3 实现 `list_songs(dir) -> Vec<SongSummary>` command：walkdir 递归 + `.flac`/`.mp3` 大小写不敏感过滤 + lofty 读 title/artist（失败返回空串）
- [ ] 1.4 定义 `SongSummary { path, title, artist }`（`#[derive(Serialize, Deserialize)]`）并注册 `pick_folder`/`list_songs` 到 invoke_handler
- [ ] 1.5 单元测试：遍历过滤（含子目录、大小写、非音频忽略）、读标签失败返回空串

## 2. 前端：AppBar 路径 + SongList（依赖 1 的契约）

- [ ] 2.1 TS 定义 `SongSummary` 与 Rust 对齐（`store/song.ts`，design.md §10.3）
- [ ] 2.2 store 新增：`folderPath`、`songs: SongSummary[]`、`searchQuery`、`selectedPath`；computed `filteredSongs`（搜索过滤 + 文件名升序）
- [ ] 2.3 `AppBar.vue`：显示当前目录绝对路径（mono 字体），右侧主题按钮占位
- [ ] 2.4 `SongList.vue`：顶部「打开文件夹」按钮（全宽 ghost）+ 搜索框 + invoke('pick_folder')→invoke('list_songs') 链路
- [ ] 2.5 `SongRow.vue`：作者+歌名展示；title/artist 前端 trim 空 → 回退文件名（去扩展名）
- [ ] 2.6 空文件夹/无匹配空状态提示
- [ ] 2.7 点击行选中高亮（`--active` 琥珀底 + 歌名变琥珀）；`⌘O`/`Ctrl+O` 快捷键绑定打开文件夹

## 3. 验证

- [ ] 3.1 `cargo test`（遍历过滤测试）+ `cargo clippy` 通过
- [ ] 3.2 `npm run build` + `npm run test` 通过
- [ ] 3.3 `npm run tauri dev` 人工确认：选文件夹后列表出现、搜索过滤、选中高亮、空态、appbar 路径
