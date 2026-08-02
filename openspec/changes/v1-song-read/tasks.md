## 1. Rust：open_song 读全量标签

- [ ] 1.1 定义 `Song` struct 与 `LyricsSource` 枚举（serde Serialize/Deserialize，`snake_case`）
- [ ] 1.2 实现 `read_song_meta(path) -> Song`：lofty 读字段映射（FLAC Vorbis / MP3 ID3v2，见 design.md 映射表），未设置字段返回空串
- [ ] 1.3 实现封面读取：PICTURE/APIC → bytes + mime（`image` 探测），base64 data URL 编码
- [ ] 1.4 `lyrics_source` 内嵌判定：内嵌歌词非空 → Embedded，否则 None
- [ ] 1.5 实现 `open_song(path) -> Result<Song, String>` command：lofty 失败 → Err；注册到 invoke_handler
- [ ] 1.6 单元测试：FLAC/MP3 字段读映射、无标签返回空串、封面 base64、坏标签返回 Err（构造损坏文件）

## 2. 前端：store 与编辑表单渲染

- [ ] 2.1 TS 类型 `Song`/`LyricsSource`/`LyricsSource 字面量` 与 Rust 对齐（design.md §10.3 类型映射）
- [ ] 2.2 `store/song.ts` 落 `SongEditor { current, original }` + `dirty` computed + `open()` action（调 invoke open_song）
- [ ] 2.3 `Editor.vue` + `EditorBar.vue`：编辑顶栏（正在编辑: 文件名 + 作者、保存状态占位、撤销/保存按钮占位）
- [ ] 2.4 `FieldGrid.vue`/`FieldList.vue`/`FieldRow.vue`：渲染 8 字段（歌名/作者/专辑/专辑作者/音轨/年份/流派/文件名）
- [ ] 2.5 `CoverPanel.vue` 骨架：封面预览（data URL）/ 空态占位
- [ ] 2.6 `LyricPanel.vue` 骨架：歌词来源 badge + textarea（等宽 mono）
- [ ] 2.7 坏标签：`open_song` 返回错误 → 表单 readonly 禁用 + 提示「标签损坏，只读」
- [ ] 2.8 选中行联动：SongList 选中 → store.open() → Editor 渲染

## 3. 验证

- [ ] 3.1 `cargo test` + `cargo clippy` 通过（字段映射、坏标签测试）
- [ ] 3.2 `npm run build` + `npm run test` 通过
- [ ] 3.3 `npm run tauri dev` 人工确认：选中歌曲表单渲染完整标签+封面、坏标签文件只读禁用
