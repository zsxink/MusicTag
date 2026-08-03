# v1-song-save 任务清单

> 依赖顺序：**Rust → Vue 串行**（变更域 both；design.md「任务拆分建议」）。每组内按序勾选；Rust 完成并经 `cargo test` 绿后方可进前端组。

## 1. Rust：save_song 写回（design.md D1–D6）

- [ ] 1.1 `Cargo.toml`：`tempfile` 从 `[dev-dependencies]` 提升到 `[dependencies]`（原子写临时文件）
- [ ] 1.2 `decode_cover` helper：base64 data URL（`data:<mime>;base64,...`）→ `(Vec<u8>, Option<String>)`；剥离前缀、`BASE64.decode`；MIME 取前缀/`image::guess_format` 兜底
- [ ] 1.3 `set_text` helper：非空字段 `insert_text(key, value)`（空字段不写 = 已在 `clear()` 中被删，表单全量覆盖语义）
- [ ] 1.4 `write_song_meta` 字段映射（design.md D3）：FLAC Vorbis（TITLE/ARTIST/ALBUM/ALBUMARTIST/TRACKNUMBER/TRACKTOTAL/DATE/GENRE/LYRICS）、MP3 ID3v2.4（TIT2/TPE1/TALB/TPE2/TRCK/TDRC/TCON/USLT）；`primary_tag_mut().clear()` 重建
- [ ] 1.5 MP3 年份写 `ItemKey::RecordingDate`（TDRC，统一 ID3v2.4，无 TYER）
- [ ] 1.6 MP3 歌词 USLT：`ItemKey::UnsyncLyrics` + `TagItem::set_lang(lofty::tag::items::ENGLISH)`；**不调用 `use_id3v23`**（保持 `WriteOptions::default()`）
- [ ] 1.7 封面写盘（design.md D4）：`decode_cover` → `Picture::unchecked(bytes).pic_type(CoverFront).mime_type(..).build()` → `push_picture`；`cover=None` → 不 push（删除封面）；MIME 探测失败 → Err
- [ ] 1.8 原子写回（design.md D6）：同目录 `tempfile` → `tag.save_to(&mut temp_file, WriteOptions::default())` → `flush`/`sync_all` → `rename(temp, path)` 覆盖原路径；任一失败 → 返回 `Err(String)`，原文件不受损
- [ ] 1.9 `save_song(song: Song) -> Result<(), String>` command + `lib.rs` `generate_handler![...]` 注册
- [ ] 1.10 单元测试：
  - [ ] 字段映射写回：FLAC / MP3 各一（保存后 `read_song_meta` 读回逐字段一致）
  - [ ] 空字段清空：原标签有字段、表单留空 → 保存后字段被删除（含歌词、封面删除）
  - [ ] MP3 写后版本为 ID3v2.4（文件头 `ID3\x04`，非 v2.3）
  - [ ] USLT lang=eng（读回 USLT 帧 lang 断言）
  - [ ] 封面嵌入后读回 bytes 一致（FLAC PICTURE / MP3 APIC）
  - [ ] cover 为 `None` → 保存后无封面
  - [ ] 原子写：构造写失败场景（如路径不存在/只读目标）→ 返回 Err 且原文件 bytes 不变
  - [ ] 坏标签/不可写路径 → Err（不 panic）

## 2. 前端 store：保存状态机与撤销（design.md D7–D8）

- [x] 2.1 `store/song.ts`：`saveState: 'idle'|'saving'|'saved'|'save_failed'` + `saveError: string`（动作态；展示态由 readonly/dirty/saveState 合成，design.md D7）
- [x] 2.2 `save()` action：IPC 注入（仿 `open` 的 `loadSong` 模式）；`saving` → `invoke('save_song', { song: current })` → 成功快照 `original={...current}` + `saveState='saved'`；失败 `saveError=String(e)` + `saveState='save_failed'`（**current 保留、dirty 保持 true**）
- [x] 2.3 `undo()` action：`current = { ...original }`、`saveState='idle'`、`saveError=''`（编辑区内撤销，非磁盘级）
- [x] 2.4 `open()` / `activateFolder()` 重置 `saveState='idle'`、`saveError=''`
- [x] 2.5 store 测试（`src/store/song.test.ts`）：
  - [x] save 成功 → `original` 更新、`dirty=false`、`saveState='saved'`
  - [x] save 失败 → `current` 保留可重试、`dirty=true`、`saveState='save_failed'`、`saveError` 有值
  - [x] undo → `current` 回到 original、`dirty=false`
  - [x] open/换目录 → saveState 归 idle

## 3. 前端组件：EditorBar 保存/撤销接语义（design.md D9）

- [x] 3.1 `EditorBar.vue` 保存按钮：`@click=save()`，disabled 当 `!dirty || saving || readonly`（40% 透明，design §6.1）
- [x] 3.2 `EditorBar.vue` 撤销按钮：`@click=undo()`，disabled 当 `!dirty || saving`
- [x] 3.3 保存状态渲染：`saving`→「保存中…」/ `save_failed`→「✕ 保存失败：{saveError}」（danger）/ `saved`→「✓ 已保存」（`--success` 绿）/ `dirty`→「有未保存的修改」（琥珀）/ `readonly`→「✕ 标签损坏，只读」/ 其余→「已就绪」
- [x] 3.4 组件测试（`src/components/editor.test.ts`）：各状态文案、按钮禁用态、保存/撤销点击行为

## 4. 验证

- [ ] 4.1 `cargo test --manifest-path src-tauri/Cargo.toml` + `cargo clippy --manifest-path src-tauri/Cargo.toml` 通过
- [ ] 4.2 `npm run test` + `npm run build` 通过
- [ ] 4.3 `npm run tauri dev` 人工确认：
  - [ ] 编辑字段 → 保存 → Kid3/mutagen 验证写回正确（FLAC Vorbis / MP3 ID3v2.4）
  - [ ] 清空字段保存 → 字段被删（含清空歌词、清空封面）
  - [ ] 失败场景（只读文件/删除文件后保存）→ 「✕ 保存失败：原因」+ 内容保留可重试 + 原文件未损坏
