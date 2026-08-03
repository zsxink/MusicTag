## Context

`v1-song-read` 已定义 `lyrics_source` 枚举（Embedded / SidecarLrc / None）与内嵌判定（trim 非空 → Embedded，否则 None，见 `service/reader.rs`）；`v1-song-save` 已实现内嵌歌词写回（`service/meta.rs::apply_lyrics`：FLAC→`LYRICS` / MP3→`USLT` lang=eng）。本变更补全 `.lrc` 侧载关联读、复选框 opt-in 同步写 `.lrc`、来源 badge UI 三件事，全部为应用层逻辑（lofty 只报内嵌字段、无 rename API；`.lrc` 读写由本变更新建的 `service/lyrics.rs` 承担）。

## Goals / Non-Goals

**Goals:**
- 读取：内嵌优先 → 侧载 `.lrc` 关联 → None，badge 展示来源。
- 保存：复选框 opt-in 同步写同目录同名 `.lrc`；空歌词不写。
- 内嵌 + `.lrc` 并存时两边同步更新。

**Non-Goals:**
- 不做结构化歌词（SYLT/逐字时间轴）。
- 不做音频 + `.lrc` 改名同步（`v1-rename-sync`）。
- 不碰搜索触发按钮 / 候选区（`v1-search-ui` 接语义；`LyricPanel` 的搜索按钮保持现有 disabled 占位）。

## 技术方案

### 模块划分与边界（design.md §10 分层规范落位）

**Rust 侧（后端先行）**：新增 `service/lyrics.rs`（§10.4 已预留落位），其余改动分布到既有模块：

| 文件 | 改动 |
|---|---|
| `src-tauri/src/service/lyrics.rs`（**新增**） | `.lrc` 路径推导 / 读取 / 原子写。纯应用层，依赖 `std::fs` + `crate::model`，无 lofty。 |
| `src-tauri/src/service/reader.rs` | 增强 `lyrics_source` 判定：内嵌非空 → Embedded；否则 `.lrc` 存在 → SidecarLrc 并读文本；否则 None。 |
| `src-tauri/src/service/writer.rs` | `save_song` 加参数 `export_lrc: bool`；内嵌写回后按需原子写 `.lrc`，失败并入 Err。 |
| `src-tauri/src/commands/song.rs` | `save_song(song, export_lrc)` 薄壳透传（新增布尔参数）。 |
| `src-tauri/src/service/mod.rs` | 增加 `pub mod lyrics;`（`pub` 供 `src-tauri/tests/` 集成测试经 `app_lib::` 访问）。 |

**前端侧（后端之后）**：

| 文件 | 改动 |
|---|---|
| `src/api/songs.ts` | `saveSong(song, exportLrc: boolean)` → `invokeCommand('save_song', { song, exportLrc })`。 |
| `src/store/song.ts` | 新增 `exportLrc: boolean` 状态（默认 false，切歌/换目录重置）；`save(exportLrc, saveFn?)` 传参。 |
| `src/components/LyricPanel.vue` | head 行 = 来源 badge + 「同时保存为 .lrc」复选框；badge 文案对齐定稿。 |
| `src/components/EditorBar.vue` | 保存按钮 `@click="save(songStore.exportLrc)"`。 |

### `service/lyrics.rs` 函数契约

```rust
/// `.lrc` 路径 = 音频文件 `with_extension("lrc")`（同目录、去扩展名同名，PRD §5.4 / FR-4.3）。
pub fn sidecar_lrc_path(audio_path: &Path) -> PathBuf;

/// 侧载读取：`.lrc` 存在 → 读文本（UTF-8 全链路，非 UTF-8 经 `from_utf8_lossy` 鲁棒读入）；
/// 文件不存在或读取失败 → None（不触发只读表单，`.lrc` 只是 fallback，不得锁死编辑）。
pub fn read_sidecar_lrc(audio_path: &Path) -> Option<String>;

/// 同步写 `.lrc`：歌词为空 → `Ok(())` 直接返回（FR-4.4a 空歌词忽略复选框，不生成空文件）；
/// 否则同目录临时文件写文本 → rename 原子替换（复用 `fs_atomic` 的临时文件 + 同卷 rename 语义，
/// 避免写失败留下半截/空 `.lrc`）。失败返回 `Err(中文原因)`。
pub fn export_lrc(audio_path: &Path, lyrics: &str) -> Result<(), String>;
```

### 数据流

1. **读取**：`open_song(path)` → `reader::read_song_meta` → 判定 `lyrics_source`：内嵌 trim 非空 → `Embedded`（现状不变）；否则 `lyrics::read_sidecar_lrc(path)` 有值 → `SidecarLrc` 且 `Song.lyrics` = 侧载文本；否则 `None`。badge 只消费 `lyrics_source`，不重复判源。
2. **编辑**：textarea `v-model` 绑 `current.lyrics`；复选框 `v-model` 绑 `store.exportLrc`（独立 UI 状态，非 `Song` 字段，见 D7）。
3. **保存**：`save()` → `saveSong(current, exportLrc)` → `save_song` command → `writer::save_song`：`apply_meta` 全量覆盖（内嵌歌词走既有 `apply_lyrics`）→ `export_lrc == true` 时 `lyrics::export_lrc`（空歌词内部 no-op）→ `Ok(())` / `Err(中文原因)`。
4. **失败**：Err → store 既有 `save_failed` 分支：内容保留、dirty 保持 true、顶栏「✕ 保存失败：原因」——`export_lrc` 的失败语义复用同一通道，零新增前端状态。

## 关键技术决策

### D1 `.lrc` 命名约定：`Path::with_extension("lrc")`

- **方案**：`.lrc` 路径 = 音频绝对路径 `with_extension("lrc")`——同目录、音频去扩展名（PRD §5.4 / FR-4.3 / FR-4.6a 同名主干）。
- **为什么**：一处实现、读写共用，保证「读到的 `.lrc`」与「写出的 `.lrc`」永远同一个路径；`with_extension` 正确处理无扩展名/多后缀情况。改名同步（FR-4.6）属 `v1-rename-sync`，本变更只冻结命名约定。

### D2 读取来源判定（增强，非新枚举）

- **方案**：内嵌 trim 非空 → `Embedded`；否则 `.lrc` 存在 → `SidecarLrc` 且 `lyrics` = `.lrc` 文本；否则 `None`。
- **为什么**：PRD FR-4.3 明确「内嵌优先」，内嵌是权威字段、`.lrc` 只是 fallback——判定顺序即需求顺序。判定落在 service 层（`reader.rs` 内），badge 只展示 `lyrics_source`，前端零判源逻辑。

### D3 `save_song` 加独立参数 `export_lrc: bool`（Tauri command 契约变更）

- **方案**：`save_song(song: Song, export_lrc: bool)`；前端 `saveSong(song, exportLrc)`；Rust `export_lrc` ← JS `exportLrc`（Tauri 参数 camelCase↔snake_case 自动映射）。
- **为什么**：复选框是「保存时的一次性策略」而非歌曲属性——不向 `Song` struct 增加与标签无关的字段（避免污染跨 IPC 契约模型）；与现有「保存 = 表单全量覆盖」语义正交。契约变更属既有 command 扩参，前端同步更新即兼容（无新增 command、无需 `lib.rs` 注册改动）。

### D4 `.lrc` 写失败并入 `save_song` 的 Err

- **方案**：`export_lrc` 返回 `Err` 时，`writer::save_song` 用 `?` 并入总错误（中文原因「写 .lrc 失败: …」），绝不吞错报成功。写顺序：**内嵌原子写 → `.lrc` 原子写**。
- **为什么**：PRD「稳健：写失败报错且不损坏原文件」+ 本变更「不能只写内嵌成功而 `.lrc` 失败却报成功」。内嵌是主存储（FR-4.1 默认内嵌），先落主存储；`.lrc` 失败时标签已达最终态、错误如实上报（store 保留内容 + dirty + 失败提示），重试为幂等全量覆盖、自然收敛。`.lrc` 写失败通常与内嵌写失败同因（同目录权限），先写内嵌先暴露更完整的错误链。

### D5 `.lrc` 写原子化（临时文件 + rename）

- **方案**：`export_lrc` 复用 `fs_atomic` 的「同目录临时文件 → rename 原子替换」模式（为纯文本实现一个同构小函数）。
- **为什么**：直接 `fs::write` 中途失败会留下半截/空 `.lrc`；原子替换保证磁盘上要么是旧 `.lrc`、要么是完整新 `.lrc`，与主写盘（`write_atomic`）的稳健语义一致。

### D6 空歌词忽略复选框（FR-4.4a）

- **方案**：`export_lrc` 内部以 `lyrics.is_empty()` 守卫——空 → `Ok(())` 不生成文件；写侧判定与 `apply_lyrics` 的 `is_empty()` 一致。
- **为什么**：需求明说「歌词为空时忽略复选框，不生成空 `.lrc`」；守卫放 service 单点实现，`writer` / 前端都不需要重复判空。

### D7 前端 `exportLrc` 独立状态（不污染 `Song`）

- **方案**：`store/song.ts` 新增 `exportLrc: boolean`：默认 `false`；`open()`（切歌）与 `activateFolder()`（换目录）重置 `false`；**不参与 `DIRTY_FIELDS`**（勾复选框本身不是编辑内容，不脏表单）；`save()` 签名 `save(exportLrc, saveFn?)`，`EditorBar` 保存按钮传 `songStore.exportLrc`。
- **为什么**：spec「默认不勾选」按歌粒度（每次打开默认不勾选）；复选框是保存期选项、与歌曲字段正交，放 store 便于组件与 save 共用，又不进 `Song` 契约。保存成功后保持勾选（不重置）——连续保存多首时可保持导出意愿，仅切歌/换目录重置，符合「显式 opt-in」的直觉。

### D8 badge 文案对齐 proposal 定稿

- **方案**：`来源: 内嵌标签` / `来源: 侧载 .lrc` / `来源: 无`；现状 `LyricPanel.vue` 的 sidecar 分支文案「同名 .lrc」统一改为「侧载 .lrc」。
- **为什么**：proposal 定稿文案即需求；badge 胶囊样式沿用 design.md §6.1（`--panel-2` 底 + 描边 + dim 文字）。

### D9 侧载来源保存后的语义（并存/覆盖的边界）

- **方案**：保存以当前编辑内容为准（FR-4.5）：内嵌全量覆盖写当前歌词；勾选且非空 → `.lrc` 同步写当前歌词。下次打开内嵌非空 → 来源变 `Embedded`（内嵌优先）。若未勾选复选框，`.lrc` 保留旧内容（仅写内嵌）——这是 opt-in 的预期结果，非缺陷。
- **为什么**：`save_song` 返回 `Result<(), String>` 不回传新 `Song`，前端 `lyricsSource` 快照在保存后不变（仍显示旧来源）；下次 `open_song` 重新判定即收敛。如实记录该行为边界，避免实现时误加「保存后改 badge」逻辑。

### D10 `.lrc` 读取用 UTF-8 lossy

- **方案**：`read_sidecar_lrc` 用 `fs::read` + `String::from_utf8_lossy`；写回始终 UTF-8（`export_lrc` 写 `str`）。
- **为什么**：全链路 UTF-8 是 NFR「编码」，但存量 `.lrc` 常见 GBK 编码——lossy 读入保证打开不因编码失败、badge 仍能正常展示；`from_utf8_lossy` 对真正非法字节降级为替换符，不产生 panic。

## 变更域判断

**跨前后端（both）**。Rust 侧先落（`service/lyrics.rs` 新建 → `reader.rs` / `writer.rs` / `commands/song.rs` 扩参 → 集成测试），前端后接入（`api/songs.ts` 签名 → store `exportLrc` → LyricPanel / EditorBar）。`save_song` 契约扩参是前端的前置依赖（前端须与 Rust 新签名同步），故**严格 Rust→Vue 串行，不并行**（本变更未创建 worktree，禁止并写）。

**依赖序（epic.json 关联）**：本变更 `dependsOn: [v1-refactor-layering]`（已 done）；下游 `v1-search-ui` dependsOn 本变更（LyricPanel 的搜索区由 search-ui 接管）。本变更不得触碰搜索触发/候选区语义，避免与 v1-search-ui 的落位冲突。

## 对定稿规格的落位

- PRD §5.4（`.lrc` 命名 = 去扩展名同名同目录）→ D1。
- FR-4.1/4.2（内嵌默认、纯文本、LRC 时间标签原样保留）→ 现状已满足，本变更不改写侧。
- FR-4.3（内嵌优先 → 侧载关联）→ D2。
- FR-4.4 / 4.4a（复选框 opt-in、空歌词不写）→ D3 / D6 / D7。
- FR-4.5（并存同步更新）→ D4 / D9。
- FR-3.6（歌词区 = 来源 badge + 复选框 + 等宽 textarea）→ D7 / D8，textarea 现状已是 mono 12.5px（design.md 字号表），保留。
- design.md §10.3 command 契约：`save_song(song)` → `save_song(song, exportLrc)`，**归档/同步时须更新 docs/design/design.md §10.3 的 command 表该行**（本变更先落在变更设计里，随代码一起提交同步）。

## Risks / Trade-offs

- `.lrc` 同步写盘是文件 I/O：写失败并入 `save_song` 的 Err（D4）——不新增前端状态，复用既有 `save_failed` 通道（内容保留、dirty 保持 true）。
- 侧载读取跨 IPC：`lyrics_source=SidecarLrc` 时 `lyrics` 字段直接放 `.lrc` 文本，保存时内嵌写回也用它（全量覆盖语义）；`.lrc` 不可读 → 按 None 处理（badge「无」），不锁死表单（D2 注）。
- `.lrc` 与内嵌跨文件非原子：失败时可能出现「标签新 / `.lrc` 旧」（未勾选）或「`.lrc` 新 / 标签新但报失败」的瞬时不一致——如实上报 + 幂等重试收敛（D4 / D9）。
