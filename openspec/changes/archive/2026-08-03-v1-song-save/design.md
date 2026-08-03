# v1-song-save 技术设计

## Context

`v1-song-read`（已归档）已交付 `Song`/`LyricsSource`/`SongSummary` 契约（`commands.rs`）、`open_song` 读取命令与 store 的 `SongEditor` 编辑状态模型（`current`/`original`/`dirty`/`readonly`）、编辑表单组件骨架（`Editor`/`EditorBar`/`FieldGrid`/`FieldList`/`FieldRow`/`CoverPanel`/`LyricPanel`）。本变更实现「保存 = 表单全量覆盖写回原路径」的落盘闭环：新增 `save_song` command、前端保存状态机（`dirty → saving → saved / save_failed`）与编辑区撤销。撤销/保存按钮当前为 disabled 占位（`EditorBar.vue`），本变更接语义。

## Goals / Non-Goals

**Goals:**
- Rust command `save_song(song: Song) -> Result<(), String>`：接收前端完整 `Song`（`cover` 为 base64 data URL），Rust 侧解码回 `Vec<u8>`，构造 lofty `Tag` 写回**原路径**（PRD FR-5.5 写回原路径）。
- 字段映射符合 PRD §5：FLAC→Vorbis Comment，MP3→ID3v2.4（lofty 默认，**不调用 `use_id3v23`**）。
- 「表单全量覆盖」语义：非空字段 set、空字段从既有标签**删除**（留空即清空删除，无空字段保护）。
- 封面写回随 `save_song` 完成（FLAC→PICTURE CoverFront / MP3→APIC，原始字节）；**本变更只做「获得 bytes → 写盘」的统一落盘通道**，嵌入交互（点击/拖拽/压缩）归 `v1-cover-embed`。
- 保存状态机（前端 store）：`saveState: 'idle'|'saving'|'saved'|'save_failed'`（动作态）+ `dirty` computed（编辑即翻转），展示态由 readonly/dirty/saveState 三者合成；顶栏渲染 dirty 琥珀 / 保存中 / ✓ 已保存 绿 / ✕ 保存失败：原因。
- 保存失败：表单内容保留、仍可编辑可重试、`dirty` 保持 true，绝不假报已保存（FR-5.4a）。
- 编辑区撤销：`current` 恢复为打开时 `original` 的深拷贝（编辑区内撤销，非磁盘级），`dirty` 归 false（FR-5.3）。

**Non-Goals:**
- 不做封面嵌入交互/压缩（`v1-cover-embed`）：本变更只落 PICTURE/APIC 写盘通道与 save 后的 UI 基础态。
- 不做 `.lrc` 写入与侧载（`v1-lyrics-lrc`）。
- 不做改名（`v1-rename-sync`）：`save_song` 只写回原路径，不改文件名。
- 不做切歌三选一弹窗（`v1-ux-settings`）：本变更只保证 store 的 `dirty`/`saveState` 状态正确；切歌弹窗的保存/不保存/取消编排由该变更接入本变更的 `save()`。

## 变更域判定

**both（跨前后端）**。

- Rust 依赖（lofty 写、base64 解码、临时文件原子写回）独立可先行；`save_song` 的 `Song` 契约（含 cover base64）已由 `v1-song-read` 冻结，无契约改动风险。
- 前端 store `save()`/`saveState` 与 `EditorBar` 状态渲染依赖后端 `save_song` 契约定型。
- **执行顺序：Rust → Vue 串行**（任务分组见「任务拆分建议」）；未显式创建 worktree 时禁止并行。

## Decisions

### D1 `save_song` command 契约

```rust
#[tauri::command]
pub fn save_song(song: Song) -> Result<(), String>
```

- 入参 `Song` 与 `open_song` 返回值同构（`v1-song-read` D1 已冻结），字段 `snake_case`，`cover: Option<String>`（base64 data URL）。
- `path` 为绝对路径字符串（与 `SongSummary.path` 一致），写回**该路径原文件**，不产生新文件（PRD FR-5.5）。
- 返回 `Result<(), String>`：`String` 为错误原因（`{e}` 中文前缀，前端直接展示于「✕ 保存失败：原因」）。
- **`path`/`lyrics_source`/`cover_mime` 不参与写盘**：`path` 是写回目标；`lyrics_source` 是读取时的来源判定，写盘后下次读取会重新判定；`cover_mime` 用于封面 MIME 探测兜底（见 D4），不作为落盘字段。
- `lib.rs` `generate_handler![...]` 追加 `commands::save_song`。

### D2 写回策略：构造 Tag → 覆盖式写回原路径

`save_song` 内部流程：

1. `Probe::open(&path)` + `.read()` 读入 `TaggedFile`（与 `open_song` 同路径；写前校验格式 = PRD「稳健」的「写文件前校验格式」）。读失败 → `Err`（格式损坏不可写，前端显示保存失败，原文件未动）。
2. 取 `primary_tag_mut()`（lofty `Tag`，`TagExt::clear()` 清空既有条目）。
3. **逐字段应用**（见 D3）：非空字段 `insert_text`（替换式，lofty `insert` 语义 = 同 key 替换）；空字段 = 留空（已 clear，天然删除）。
4. **封面应用**（见 D4）：`Some(bytes)` → 构造 `Picture` push；`None` → 不 push（已 clear 即删除）。
5. **原子写回**（见 D6）：把 Tag 写入同目录临时文件，成功后 rename 替换原文件。

**为什么用「读入 → clear → 重建」而非「读入 → 只 set 非空字段」**：lofty 的 `insert_text` 对同 `ItemKey` 是替换式（`Tag::insert` 替换同 key 条目），但要实现「表单全量覆盖 = 表单里没有的字段要删掉」，最干净的做法是 `clear()` 清空既有标签再按表单重建。这保证：
- 表单里留空的字段必然从标签中消失（哪怕原标签有 `COMMENT`/`DISCNUMBER` 等表单不暴露的字段——表单全量覆盖语义 = 最终标签 = 表单内容，这是 V1 拍板语义，误删属「改错认栽」）。
- 不受「要删除的字段还需 `remove_key` 一次」的逐 key 枚举负担。

> 边界说明：`Tag::clear()` 清的是**标签条目与图片**，不破坏音频帧/流本身（lofty 写时只重写标签区）。这也是「表单全量覆盖」的语义落点：一次保存后标签 == 表单。

### D3 字段映射（写）

沿用 `v1-song-read` D2 的读侧 ItemKey 映射，写侧一一对应：

**FLAC → Vorbis Comment**（PRD §5.1）：

| 字段 | Vorbis key | lofty ItemKey |
|---|---|---|
| title | `TITLE` | `ItemKey::TrackTitle` |
| artist | `ARTIST` | `ItemKey::TrackArtist` |
| album | `ALBUM` | `ItemKey::AlbumTitle` |
| album_artist | `ALBUMARTIST` | `ItemKey::AlbumArtist` |
| track | `TRACKNUMBER` | `ItemKey::TrackNumber` |
| track_total | `TRACKTOTAL` | `ItemKey::TrackTotal` |
| year | `DATE` | `ItemKey::RecordingDate`（读侧 RecordingDate 优先、Year 兜底；**写侧统一写 RecordingDate** 保证 `DATE` key，与读侧优先分支对齐） |
| genre | `GENRE` | `ItemKey::Genre` |
| lyrics | `LYRICS` | `ItemKey::Lyrics` |
| cover | PICTURE 块 | `Tag::push_picture` |

**MP3 → ID3v2.4**（PRD §5.2）：

| 字段 | 帧 ID | lofty ItemKey |
|---|---|---|
| title | `TIT2` | `ItemKey::TrackTitle` |
| artist | `TPE1` | `ItemKey::TrackArtist` |
| album | `TALB` | `ItemKey::AlbumTitle` |
| album_artist | `TPE2` | `ItemKey::AlbumArtist` |
| track | `TRCK`（`x/y`） | `ItemKey::TrackNumber` / `ItemKey::TrackTotal` |
| year | `TDRC` | `ItemKey::RecordingDate` |
| genre | `TCON` | `ItemKey::Genre` |
| lyrics | `USLT` | `ItemKey::UnsyncLyrics`（`TagItem::set_lang(ENGLISH)`，见 D5） |
| cover | `APIC` | `Tag::push_picture` |

实现细节：
- 统一 helper：`fn set_text(tag: &mut Tag, key: ItemKey, value: &str)`——`value` 非空则 `insert_text(key, value)`（空则不写，已在 D2 中被 clear 删除）。
- **track / track_total 写 TRCK 合串**：lofty `ItemKey::TrackNumber`/`TrackTotal` 在写侧对 MP3 会合成 `TRCK` 为 `x/y`（当两者都非空）。若 `track_total` 空而 `track` 非空，则只写 `TrackNumber`（TRCK 只有 `x`）。与读侧拆分对称。
- **year 写 TDRC**：MP3 统一 ID3v2.4 后 `TDRC`（RecordingDate）为完整 ISO 时间帧，无需 `TYER`（PRD §5.2 拍板）。`v1-song-read` 读侧 year 取 `RecordingDate` 优先，写 `RecordingDate` 保证读写对称。

### D4 封面写盘（PICTURE/APIC）

- 入参 `song.cover: Option<String>`（base64 data URL，`data:<mime>;base64,...`）。
- 解码 helper：`fn decode_cover(cover: &str) -> Option<(Vec<u8>, Option<String>)>`：
  - 剥离 `data:<mime>;base64,` 前缀（无前缀时按纯 base64 处理）；`BASE64.decode` 解出 `Vec<u8>`。
  - MIME：优先取 data URL 前缀中的 `<mime>`；缺省/兜底用 `image::guess_format(&bytes)` 探测（与 `v1-song-read` D3 的读侧探测对称，`cover_mime` 字段可作校验参考）。
- 构造 `Picture`（`lofty::picture::{Picture, PictureType, MimeType}`）：
  ```rust
  let pic = Picture::unchecked(bytes)
      .pic_type(PictureType::CoverFront)   // =3，PRD §5.3
      .mime_type(MimeType::from_str(&mime)?) // "image/jpeg" → Jpeg
      .build();
  tag.push_picture(pic);
  ```
- `None` → 不 push（已 clear 即删除封面，表单清空封面 = 移除标签封面）。
- **MIME 探测失败**：`image::guess_format` 无法识别时返回 `Err("封面格式无法识别")`（拒绝写坏封面，而非用通用 MIME 硬写——APIC 需正确 MIME 才能被播放器识别）。
- **统一通道**：本变更只落「bytes → PICTURE/APIC 写盘」。网络下载/本地选择/压缩（`v1-cover-embed` 的 `download_cover` 与预览压缩）最终都以「填入 `Song.cover` 的 base64」进入本变更的保存通道（design.md §10.3「统一封面路径」）。

### D5 MP3 歌词：USLT lang=eng

- 用 `ItemKey::UnsyncLyrics` 写 USLT 帧，**必须** `TagItem::set_lang(ENGLISH)`（lofty 写 ID3v2 时 USLT 要求 lang 非空，PRD §5.2/§5.4 拍板 `lang='eng'`）：
  ```rust
  let mut item = TagItem::new(ItemKey::UnsyncLyrics, ItemValue::Text(lyrics.to_string()));
  item.set_lang(lofty::tag::items::ENGLISH);
  tag.push(item);
  ```
- FLAC 走 `ItemKey::Lyrics`（Vorbis `LYRICS` 帧），不需要 lang。
- **MP3 版本：不调用 `use_id3v23`**。`WriteOptions::default()` 的 `use_id3v23 = false`（lofty 0.24 源码确认），保持默认即 ID3v2.4。测试需断言写后文件版本为 ID3v2.4（帧头 `ID3\x04`）。

### D6 原子写回（写失败不损坏原文件）

lofty 0.24 的 `Tag::save_to_path`（源码确认）是**就地打开**（`OpenOptions::read(true).write(true).open(path)`）后 `truncate(0)` + `write_all`——中途写失败会损坏原文件。PRD「稳健」要求「写失败报错且不损坏原文件」，故**不用** `tag.save_to_path(path)`，改用**写临时文件 + rename 替换**：

1. 在**同目录**创建临时文件（同目录保证 rename 在同一文件系统内，原子）。
   - 命名：`.<文件名>.<随机后缀>.tmp`（用 `tempfile::Builder::new().suffix(".tmp").tempfile_in(dir)`，`dev-dependencies` 已有 `tempfile`；**提升为 `dependencies`**，或直接用 `std::fs` + 唯一后缀自管）。设计倾向 `tempfile`：自动清理 + 同目录保证同文件系统。
2. 把构造好的 `Tag` 写入临时文件：`tag.save_to(&mut temp_file, WriteOptions::default())`（`save_to` 接受 `FileLike`，临时 `File` 满足）。`save_to` 走同一 `write_tag` 逻辑（FLAC PICTURE / MP3 APIC / USLT 编码一致）。
3. `temp_file.flush()` + 落盘（可选 `sync_all`），然后 `rename(temp_path, path)` **覆盖原路径**。
4. 任一环节失败 → 删除临时文件（`Drop` 自动）+ 返回 `Err(String)`；原文件未被触碰（临时文件写在旁边，rename 只在全量成功后发生）。

> 原子性说明：`rename` 在 POSIX 与 Windows 上都是「同卷原子替换」。此方案把「写坏原文件」窗口压缩到 rename 本身；rename 失败（如目标被占用）原文件仍完好。这正是「写失败不损坏原文件」的落点。临时文件与目标同目录，避免跨文件系统 `rename` 报错。
>
> 边界：V1 无备份、无撤销（FR-5.4 拍板）。原子写只是「失败不损坏」，不是「可回滚」。保存成功后原标签即被覆盖，改错认栽。

### D7 保存状态机（前端 store）

`store/song.ts` 扩展 `SongEditor`：

```ts
saveState: 'idle' | 'saving' | 'saved' | 'save_failed'  // 动作态四态
saveError: string    // save_failed 原因（顶栏展示）
// dirty 仍是独立 computed（v1-song-read 已有），不存入 saveState
```

- **`dirty`（computed）**：沿用 `v1-song-read` 逐字段对比（`DIRTY_FIELDS` 10 字段）。`saveState` 由 UI 在调用 `save()` 前后设置，`dirty` 与 `saveState` 协同但不互斥：
  - 编辑字段 → `dirty` computed 自动 true。UI 层把 `saveState` 置为 `'dirty'`（顶栏琥珀）。
  - 保存成功 → `saveState='saved'`（绿「✓ 已保存」）；`dirty` 仍由 computed 判定（理论上保存后 current==写盘内容，但因写入是「表单全量覆盖」，保存后 `dirty` 应为 false——`current` 未变，`original` 未更新，故 **保存成功后把 `current` 快照进 `original`** 使 `dirty` 归 false，且为下次编辑提供新的对比基准）。
  - 保存失败 → `saveState='save_failed'` + `saveError`；`current` **不还原**（内容保留可重试）、`original` **不更新**（`dirty` 保持 true，绝不假报已保存）。

- **`save()` action**（`store/song.ts`）：
  ```ts
  export async function save(): Promise<void> {
    if (songStore.readonly || songStore.current === null) return
    songStore.saveState = 'saving'
    try {
      await saveSong(songStore.current)           // invoke('save_song', { song: current })
      songStore.original = { ...songStore.current } // 新基准
      songStore.saveState = 'saved'
    } catch (e) {
      songStore.saveError = String(e)
      songStore.saveState = 'save_failed'          // current 保留，dirty 保持 true
    }
  }
  ```
  - IPC 依赖以参数注入（仿 `open` 的 `loadSong` 注入模式）：`save(saveFn?: (song: Song) => Promise<void>)`，便于测试不依赖 Tauri；组件侧传 `(song) => invokeCommand<void>('save_song', { song })`。
  - **保存中禁用再次保存**（`saving` 时保存按钮 disabled，防连点并发写同一文件）。

- **`saveState` 生命周期重置**：
  - `open()` 成功/失败 → `saveState='idle'`、`saveError=''`（新歌打开，dirty 归 false）。
  - `activateFolder()` 换目录 → 重置 `saveState='idle'`、`saveError=''`。
  - 编辑任一字段 → `dirty` computed 自动翻转（`saveState` 无需置 dirty）。`FieldRow`/`CoverPanel`/`LyricPanel` 的 `v-model` 更新后统一在 store 内联处理：给 `current` 字段 setter 无法拦，故由组件 `watch`/`@update` 或 `EditorBar` 计算渲染（渲染优先级：`saved` > `save_failed` > `saving` > `dirty` > `idle`）。**实现落点**：`saveState` 不手动置 dirty，而是展示态把 `dirty` 与 `saveState` 合并（`EditorBar` 展示时：`readonly` → 只读文案；`saving` → 保存中；`save_failed` → ✕ 保存失败；`saved` → ✓ 已保存；否则 `dirty` → 有未保存的修改；否则「已就绪」）。即 `saveState` 只存 `idle/saving/saved/save_failed` 四态，只读/脏态由 `readonly`/`dirty` 推导，避免双写失步。

  > **状态模型说明**：proposal/spec 用「dirty → saving → saved / save_failed」五态描述需求语义；实现拆为「`dirty` computed（编辑即翻转）+ `saveState` 动作态四态」以保持单一状态来源——`dirty=true 且 saveState=idle` 即 spec 的 dirty 态，展示无遗漏。保存成功快照 `original` 使 `dirty` 归 false，保存失败不动 `original`（`dirty` 保持 true）。

### D8 编辑区撤销

- store 新增 `undo()` action：`current = { ...original }`（深拷贝原始快照）、`saveState='idle'`、`saveError=''`。
- 语义：恢复到打开时值，**编辑区内撤销**（非磁盘级，FR-5.3）；`original` 不被覆盖（撤销回到打开时基准，再编辑可再撤销）。
- 撤销按钮禁用态：`!dirty`（无修改无需撤销）或 `saving`。
- 不逐字段撤销（V1 无历史栈）；撤销 = 整体回到打开时快照，一次到位。

### D9 组件与 UI

- **`EditorBar.vue`** 撤销/保存按钮去掉 disabled 占位，接语义：
  - 撤销按钮：`@click="songStore.undo()"`，disabled 当 `!dirty || saving`。
  - 保存按钮：`@click="save()"`，disabled 当 `!dirty || saving || readonly`（无 dirty 或保存中禁用，40% 透明，design §6.1）。
  - 保存状态渲染（与 mockup 对齐）：
    - `readonly` → `✕ 标签损坏，只读`（danger，已有）
    - `saving` → `保存中…`
    - `save_failed` → `✕ 保存失败：{saveError}`（danger）
    - `saved` → `✓ 已保存`（绿 `--success`）
    - `dirty` → `有未保存的修改`（琥珀 `--accent`，已有）
    - 否则 → `已就绪`
- **按钮文案**：`撤销`（ghost）/ `保存`（primary），沿用 mockup。

### D10 依赖与模块边界

Rust 依赖变化（`Cargo.toml`）：
- `base64` 已存在（`v1-song-read` 引入，编码）；本变更**复用**做解码（`BASE64.decode`），无新增。
- `tempfile` 从 `[dev-dependencies]` **提升到 `[dependencies]`**（原子写临时文件用）。

新增代码（`commands.rs` 单文件追加，V1 规模不拆 module）：
- `save_song` command + `write_song_meta(song: &Song) -> Result<(), String>` 内部函数。
- 私有 helper：`decode_cover`（data URL → bytes+mime）、`set_text`（非空才 insert）、`build_picture`、`write_atomic`（临时文件 + rename）。
- 读侧既有 `encode_cover`/`encode_data_url` 保留不动。

**API 边界**：
- 新增 `save_song(song: Song) -> Result<(), String>`；`Song` 契约不变（无 TS 契约改动）。

## Risks / Trade-offs

- **表单全量覆盖是破坏性语义**：`clear()` 重建会删除表单不暴露的标签字段（如 `COMMENT`、`DISCNUMBER`、`RATING`）。与 PRD 拍板一致（「填了就存、不填即清空删除」），但保存前 UI 必须给足 dirty 提示。**风险控制**：V1 字段集即表单字段集，表单外的字段在 V1 工具定位下不承诺保留。
- **写失败不损坏原文件**：lofty 就地 `save_to_path` 会 truncate 原文件——故强制走临时文件 + rename。临时文件写失败由 `Drop` 清理，原文件零触碰。
- **cover base64 跨 IPC**：单首 ≤2048×2048 封面经 base64 膨胀 ~33%，可接受（一次一首；design.md §10.3 已拍板）。
- **USLT lang 遗漏**：若忘 `set_lang(ENGLISH)`，lofty 写 ID3v2 时 USLT 编码可能失败或默认 lang 非 eng——测试必须断言 `lang=eng`。
- **dirty 与 saveState 双状态失步**：已通过「saveState 只存动作态、展示态由 readonly/dirty/saveState 合成」规避（D7 修正）。

## 任务拆分建议

依赖顺序 **Rust → Vue 串行**（变更域 both）：

1. **Rust（D1–D6）**：`Cargo.toml` 提升 `tempfile` → `decode_cover`（base64 data URL → bytes+mime）→ `write_song_meta` 字段映射（D3）+ USLT lang（D5）→ 封面 Picture（D4）→ `write_atomic` 临时文件 + rename（D6）→ `save_song` command + 注册 → 单元测试（映射/清空/版本/USLT/封面/原子写）。
2. **前端 store（D7–D8）**：`saveState`/`saveError` 落位 + `save()`/`undo()` action（IPC 注入）→ store 测试（成功/失败保留 dirty/撤销归零/打开重置）。
3. **前端组件（D9）**：`EditorBar` 撤销/保存按钮接语义 + 保存状态渲染（dirty 琥珀 / 保存中 / ✓ 已保存 绿 / ✕ 保存失败：原因）+ 按钮禁用态 → 组件测试。
4. **验证**：`cargo test` + `cargo clippy`、`npm run build` + `npm run test`、`npm run tauri dev` 人工确认（Kid3/mutagen 验证写回；清空字段保存后字段被删；失败场景提示正确）。
