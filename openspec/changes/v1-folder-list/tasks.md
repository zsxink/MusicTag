## 1. Rust：文件夹选择 + 深度遍历

- [ ] 1.1 添加依赖：`rfd`、`walkdir`、`lofty` 到 src-tauri/Cargo.toml
- [ ] 1.2 实现 `pick_folder() -> Option<String>` command（rfd 原生选择器）
- [ ] 1.3 实现 `list_songs(dir) -> Vec<SongSummary>` command：walkdir 递归 + `.flac`/`.mp3` 大小写不敏感过滤 + lofty 读 title/artist（失败返回空串）
- [ ] 1.4 定义 `SongSummary { path, title, artist }` 与 serde 序列化
- [ ] 1.5 注册 `pick_folder`/`list_songs` 到 invoke_handler
- [ ] 1.6 单元测试：遍历过滤（含子目录、大小写、非音频忽略）、读标签失败返回空串

## 2. 前端：AppBar 路径 + SongList

- [ ] 2.1 `AppBar.vue`：显示当前目录绝对路径（mono 字体），右侧主题按钮占位
- [ ] 2.2 `SongList.vue`：顶部「打开文件夹」按钮（全宽 ghost）+ 搜索框 + 歌曲列表
- [ ] 2.3 `SongRow.vue`：作者+歌名展示；title/artist 前端 trim 空 → 回退文件名（去扩展名）
- [ ] 2.4 store 增加：`folderPath`、`songs: SongSummary[]`、`searchQuery`、`selectedPath`；computed `filteredSongs`（搜索过滤 + 文件名升序）
- [ ] 2.5 空文件夹/无匹配空状态提示
- [ ] 2.6 点击行选中高亮；`⌘O`/`Ctrl+O` 快捷键绑定打开文件夹
- [ ] 2.7 TS 类型 `SongSummary` 与 Rust 对齐（design.md §10.3）

## 3. 验证

- [ ] 3.1 `cargo test`（遍历过滤测试）+ `cargo clippy` 通过
- [ ] 3.2 `npm run build` + `npm run test` 通过
- [ ] 3.3 `npm run tauri dev` 人工确认：选文件夹后列表出现、搜索过滤、选中高亮、空态
