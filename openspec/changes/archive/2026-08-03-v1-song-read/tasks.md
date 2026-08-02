# v1-song-read 任务清单

> 变更域：**both**（Rust → Vue 串行）。依赖：`v1-folder-list`（已合，提供 `SongSummary`/`list_songs`/store 占位/`.editor-slot`）。
> 约束：只读不写（保存属 `v1-song-save`）；MP3 读兼容 v2.3/v2.4（写入 v2.4 归 save）；坏标签 `open_song` 返回 Err（区别于 `list_songs` 的空串）。
> 测试：Rust 侧字段映射/坏标签/契约形状必须带测试（config.yaml tasks rules）；前端 store 行为带测试。

## 1. Rust：`open_song` 读全量标签（依赖 0）

- [ ] 1.1 **定义契约类型**：在 `src-tauri/src/commands.rs` 定义 `Song` struct（13 字段，snake_case）与 `LyricsSource` 枚举
  - `LyricsSource { Embedded, SidecarLrc, None }`：`#[serde(rename_all = "snake_case")]` + `SidecarLrc` 显式 `#[serde(rename = "sidecar")]` → `"embedded" | "sidecar" | "none"`（与 `src/lib/tauri.ts` 契约一致；**勿用 `"sidecar_lrc"`**）
  - 均为 `#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]`
- [ ] 1.2 **Cargo.toml 加依赖**：`image`、`base64`（版本对齐 PRD §7；`cargo add image base64`）
- [ ] 1.3 **实现 `read_song_meta(path) -> Result<Song, String>`**：`Probe::open` + `.read()`，失败返回 `Err(原因)`（区别于 `read_summary` 的失败→空串）
  - 文本字段统一走 `Tag::get_string(&ItemKey)` → `unwrap_or_default()`：
    - FLAC Vorbis：`TITLE/ARTIST/ALBUM/ALBUMARTIST/TRACKNUMBER/TRACKTOTAL/DATE/GENRE/LYRICS`
    - MP3 ID3v2：`TIT2/TPE1/TALB/TPE2/TRCK(含总数)/TDRC/TCON/USLT`
  - ItemKey 映射见 `design.md D2`；MP3 `TRCK` 若返回 `x/y` 合串，按 `/` 拆分到 `track`/`track_total`
  - 未设置字段读空串（PRD §6）
- [ ] 1.4 **封面读取 + base64 编码**：`tag.pictures()` 取第一张；`picture.mime_type()` 取 MIME，空时 `image::guess_format(&bytes)` 兜底探测；组装 `data:<mime>;base64,...` 进 `cover`；无封面 → `cover: None`、`cover_mime: None`（helper 函数，见 `design.md D3`）
- [ ] 1.5 **`lyrics_source` 内嵌判定**：内嵌歌词 `trim()` 非空 → `Embedded`，否则 `None`（`SidecarLrc` 本变更不实现，`v1-lyrics-lrc` 补）
- [ ] 1.6 **注册 `open_song` command**：`pub fn open_song(path: String) -> Result<Song, String>`（入参 `String` 与 `list_songs` 一致，Tauri 自动转 `PathBuf`）；`lib.rs` `generate_handler![...]` 追加 `commands::open_song`
- [ ] 1.7 **Rust 单元测试**（复用 `commands.rs` 既有 `write_tagged_flac`/`write_tagged_mp3` helper，必要时扩展写 `LYRICS`/`TRCK`/封面 PICTURE/APIC）：
  - FLAC 全字段读映射（含歌词/封面）正确；MP3 全字段读映射（含 USLT/APIC）正确
  - 无标签文件 → 全字段空串、`cover: None`、`lyrics_source: None`
  - 坏标签（`garbage bytes`）→ `open_song` 返回 `Err`（区别于 `list_songs` 空串）
  - 封面 base64 形状：`cover` 前缀 `data:image/<mime>;base64,` 且 `cover_mime` 正确
  - **契约序列化形状**：`serde_json::to_string(&Song)` 断言 `"lyrics_source":"embedded"` 与 `"lyrics_source":"sidecar"`（验证 rename 显式生效，杜绝 `{"Embedded":null}` / `"sidecar_lrc"`）
  - `TRCK` `x/y` 拆分兜底（MP3 fixture 写 `TRCK="03/12"`）

## 2. 前端 store：`SongEditor` 形态落位（依赖 1）

- [ ] 2.1 **确认 TS 契约无需改动**：`src/lib/tauri.ts` 已含 `Song`/`LyricsSource`（v1-folder-list 预置）；核对与 Rust `Song` 字段逐项一致（`cover`/`cover_mime`/`lyrics_source`）
- [ ] 2.2 **`store/song.ts` 落 `SongEditor`**：`current`/`original`（`Song | null`）+ `readonly`（boolean）+ `lyricsSource`；`dirty` 改 `computed`（逐字段对比 `title/artist/album/album_artist/track/track_total/year/genre/lyrics/cover`；`current`/`original` 任一 null → false）
- [ ] 2.3 **`open(path)` action**：`invokeCommand<Song>('open_song', { path })`；成功 → `current = original = song`、`readonly = false`；Err → `current = original = null`、`readonly = true`（IPC 依赖以 `loadSong` 参数注入，仿 `activateFolder` 便于测试）
- [ ] 2.4 **选中联动**：`selectSong(path)` 内追加 `open()`（或 SongRow click handler 编排）；`open()` 未选中（null）时不触发
- [ ] 2.5 **store 单元测试**（`src/store/song.test.ts` 扩展）：
  - 打开即干净：`open()` 成功后 `dirty === false`、`current === original`
  - 编辑任一字段 → `dirty === true`（模拟改 `current.title`）
  - 改回原值 → `dirty === false`
  - `open_song` Err → `readonly === true`、`current === null`
  - 切歌（再 `open()` 另一首）→ `dirty` 归零、`current` 替换

## 3. 前端组件：编辑表单骨架（依赖 2）

- [ ] 3.1 **`App.vue`**：`.editor-slot` 内挂载 `<Editor />`（替换占位注释）
- [ ] 3.2 **`EditorBar.vue`**：「正在编辑: 文件名 + 作者」（mono 文件名）；保存状态占位（`dirty` 时琥珀「有未保存的修改」/ 只读时 danger「标签损坏，只读」）；撤销/保存按钮 **disabled 占位**（保存语义归 `v1-song-save`）
- [ ] 3.3 **`FieldGrid.vue`**：两列布局 `.field-grid { grid-template-columns: 1fr 200px }`（左字段列 + 右封面区，spec「编辑表单两列布局」）
- [ ] 3.4 **`FieldList.vue` / `FieldRow.vue`**：渲染 8 字段（歌名/作者/专辑/专辑作者/音轨号+音轨总数/年份/流派/文件名）；字段行 v-model 绑 `current`；文件名行只读（mono，`fileName(current.path)`，改名归 `v1-rename-sync`）；输入框 focus 琥珀描边（design §6.1）
- [ ] 3.5 **`CoverPanel.vue`**：`<img v-if="current.cover" :src="current.cover">` 1:1 预览；无封面 → 虚线框空态占位（spec「封面区占位」）；「搜索封面」按钮 **占位 disabled**（搜索归 v1-search-ui）
- [ ] 3.6 **`LyricPanel.vue`**：来源 badge（内嵌标签/无，对应 `lyrics_source`）+ 「搜索歌词」按钮占位 + 等宽 mono textarea（`readonly` 跟随表单状态）；`lyrics` v-model 绑 `current`
- [ ] 3.7 **坏标签只读态**：`readonly === true` → 整表 `<fieldset disabled>`/`readonly` + EditorBar 显示「标签损坏，只读」（danger），不进入可编辑态（FR-5.7，spec「坏标签只读」）
- [ ] 3.8 **空态**：未选中/未打开 → Editor 显示占位（「选中左侧歌曲开始编辑」类空态，对齐 design §6.1 空状态样式）

## 4. 验证（依赖 1–3 全部完成）

- [ ] 4.1 `cargo check --manifest-path src-tauri/Cargo.toml` + `cargo test` 通过（字段映射、坏标签 Err、契约形状）
- [ ] 4.2 `cargo clippy --manifest-path src-tauri/Cargo.toml` 无警告
- [ ] 4.3 `npm run build` + `npm run test` 通过（store 行为测试）
- [ ] 4.4 `npm run tauri dev` 人工确认：
  - 选中歌曲 → 右栏渲染完整标签 + 封面 base64 预览（两列布局）
  - 无封面歌曲 → 封面区空态占位
  - 构造坏标签文件（如 garbage.mp3）→ 选中后表单只读禁用 + 「标签损坏，只读」
  - 修改任一字段 → 顶栏「有未保存的修改」（琥珀），改回 → 清除
  - 未选中任何歌曲 → 右栏空态
