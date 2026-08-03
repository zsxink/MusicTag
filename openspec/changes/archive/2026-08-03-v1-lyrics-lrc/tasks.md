## 1. Rust：侧载 .lrc 关联读 + 同步写（先做，契约前置）

- [ ] 1.1 新建 `src-tauri/src/service/lyrics.rs`（design.md D1/D5/D10）：
  - `sidecar_lrc_path(path)`：`with_extension("lrc")` 同目录同名去扩展名
  - `read_sidecar_lrc(path) -> Option<String>`：存在读文本（`fs::read` + `from_utf8_lossy`）；不存在/失败 → None
  - `export_lrc(path, lyrics) -> Result<(), String>`：空歌词 → `Ok(())` no-op（FR-4.4a）；否则同目录临时文件写文本 → rename 原子替换；失败返回中文 Err
- [ ] 1.2 `service/reader.rs` 增强 `lyrics_source` 判定（design.md D2）：内嵌 trim 非空 → Embedded（现状不变）；否则 `read_sidecar_lrc` 有值 → SidecarLrc 且 `lyrics` = 侧载文本；否则 None
- [ ] 1.3 `service/writer.rs` `save_song(song, export_lrc: bool)`（design.md D3/D4）：`apply_meta` 内嵌写回后，`export_lrc == true` 时调 `export_lrc(&path, &song.lyrics)`；`.lrc` 写失败 `?` 并入总 Err（中文原因「写 .lrc 失败: …」）；写顺序内嵌先、`.lrc` 后
- [ ] 1.4 `commands/song.rs` `save_song(song, export_lrc: bool)` 薄壳透传 + `service/mod.rs` 加 `pub mod lyrics;`
- [ ] 1.5 Rust 测试：
  - `service/lyrics.rs` 内联单测：sidecar 路径推导（去扩展名）、read 存在/缺失/非 UTF-8 lossy、export 原子写 / 空歌词 no-op
  - 新集成测试 `src-tauri/tests/lyrics_lrc.rs`（复用 `tests/common/mod.rs` fixture；更新既有 `tests/save_song.rs` 的 `save_song(song)` 调用为 `(song, false)`）：
    - 内嵌非空 + 同名 `.lrc` 存在 → 来源 Embedded、lyrics 取内嵌（内嵌优先）
    - 无内嵌 + `.lrc` 存在 → 来源 SidecarLrc、lyrics 取 `.lrc` 文本
    - 无内嵌 + 无 `.lrc` → 来源 None
    - 勾选 + 非空 → 同目录生成同名 `.lrc`（去扩展名），内容 = 当前歌词；内嵌同步写（FLAC/MP3 各一遍）
    - 勾选 + 空歌词 → 不生成 `.lrc`
    - 取消勾选 → 不写 `.lrc`（既有 `.lrc` 保留不动）
    - 并存同步：内嵌 + `.lrc` 两边都 = 当前编辑内容
    - `.lrc` 写失败（只读目录）→ Err 含「写 .lrc 失败」且如实返回

## 2. 前端：LyricPanel 来源 badge + 复选框（Rust 后接，契约随 save_song 签名同步）

- [ ] 2.1 `api/songs.ts`：`saveSong(song, exportLrc: boolean)` → `invokeCommand('save_song', { song, exportLrc })`；`api/songs.test.ts` 补 exportLrc 传参断言
- [ ] 2.2 `store/song.ts`（design.md D7）：新增 `exportLrc: boolean`（默认 false；`open()` / `activateFolder()` 重置 false）；`save(exportLrc, saveFn?)` 传给 saveFn；**不加入 `DIRTY_FIELDS`**；`store/song.test.ts` 补默认值 / 切歌重置 / save 传参 / 勾选不脏表单
- [ ] 2.3 `components/LyricPanel.vue`（design.md D7/D8）：head 行 = 来源 badge（文案对齐 proposal：`来源: 内嵌标签` / `来源: 侧载 .lrc` / `来源: 无`，现状 sidecar 分支「同名 .lrc」改为「侧载 .lrc」）+ 「同时保存为 .lrc」复选框（默认不勾选、`readonly` 禁用、`v-model` 绑 `songStore.exportLrc`）；textarea 保持等宽 mono 12.5px；新建 co-located `components/lyric-panel.test.ts`（badge 三态、复选框默认不勾选、readonly 禁用、勾选写入 store）
- [ ] 2.4 `components/EditorBar.vue`：保存按钮 `@click="save(songStore.exportLrc)"`

## 3. 验证

- [ ] 3.1 `cargo check` + `cargo test` + `cargo clippy` 通过（侧载/同步写集成测试）
- [ ] 3.2 `npm run build` + `npm run test` 通过（含结构守卫 `design-layering.test.ts` / `layering.test.ts`）
- [ ] 3.3 `npm run tauri dev` 人工确认：内嵌优先读取、无内嵌关联 `.lrc`、badge 来源正确、复选框写 `.lrc`（勾选写/取消不写/空歌词不生成）、`.lrc` 写失败顶栏报错且内容保留可重试
- [ ] 3.4 同步 docs/design/design.md §10.3 command 表：`save_song(song)` → `save_song(song, exportLrc)`（design.md D3，随归档/提交一起同步）
