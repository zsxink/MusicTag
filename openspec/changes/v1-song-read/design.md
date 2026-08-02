# v1-song-read 技术设计

## Context

`v1-folder-list` 已交付 `SongSummary` 与左栏列表（`pick_folder` / `list_songs`），并预留了 `Song`/`LyricsSource` TS 契约类型（`src/lib/tauri.ts`）、`store/song.ts` 的 `SongEditor` 占位字段、`App.vue` 的 `.editor-slot` 挂载点。本变更实现「选中 → `open_song` 读全量 → 渲染表单」与编辑状态模型（`current`/`original`/`dirty`），并落 `open_song` command 契约。

## Goals / Non-Goals

**Goals:**
- Rust command `open_song(path) -> Result<Song, String>`：读全量标签（10 字段 + 歌词 + 封面 base64 data URL + `lyrics_source`）；读标签失败返回 Err（坏标签只读）。
- 定义完整 `Song` struct（含 `LyricsSource` 枚举、`cover`/`cover_mime`），TS 类型与 Rust 对齐。
- store 落 `SongEditor { current, original, dirty }`：`dirty` 为 computed 逐字段对比；`open()` action 调 `open_song` 读全量并渲染。
- 编辑表单组件骨架：`Editor`/`EditorBar`/`FieldGrid`/`FieldList`/`FieldRow`/`CoverPanel`/`LyricPanel`，两列布局（左字段列 + 右封面区 `1fr 200px`），封面 base64 预览、无封面空态占位、歌词来源 badge + 等宽 textarea。本变更先渲染**展示形态**（字段可编辑但无保存语义）。

**Non-Goals:**
- 不做保存写回（`v1-song-save`）：撤销/保存按钮为占位，不接 `save_song`。
- 不做 `.lrc` 侧载关联读（`v1-lyrics-lrc`）：本变更只落 `lyrics_source` 内嵌判定（非空→Embedded，否则 None）。
- 不做封面嵌入/压缩（`v1-cover-embed`）。
- 不做自动搜索（`v1-search-backend`/`v1-search-ui`）：搜索按钮为占位。
- 不做切歌确认弹窗（`v1-ux-settings`）：本变更只提供 store 状态与「未保存修改」判定能力。

## 变更域判定

**both（跨前后端）**。

- Rust 依赖（lofty 读、image 探测 mime、base64 编码）独立可先行；`Song` struct 与 `open_song` 是前端 `invoke` 的契约前提。
- 前端 store `open()` 与表单组件渲染依赖后端 `open_song` 契约定型。
- **执行顺序：Rust → Vue 串行**（任务分组见「任务拆分建议」），未显式创建 worktree 时禁止并行。

## Decisions

### D1 `Song` struct 契约落点（本变更定义完整 `Song`）

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Song {
    pub path: String,        // 绝对路径（与 SongSummary.path 同构，字符串）
    pub title: String,
    pub artist: String,
    pub album: String,
    pub album_artist: String,
    pub track: String,       // 音轨号
    pub track_total: String,
    pub year: String,
    pub genre: String,
    pub lyrics: String,      // 内嵌歌词（含 LRC 时间标签原文）
    pub lyrics_source: LyricsSource,   // Embedded | SidecarLrc | None
    pub cover: Option<String>,         // base64 data URL（跨 IPC 序列化）
    pub cover_mime: Option<String>,
}
```

- 序列化字段用 `snake_case`（serde 默认），与 TS `Song` 契约（`design.md §10.3`）逐字段对齐。
- `LyricsSource` 枚举（与 PRD §6 一致）：
  ```rust
  #[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
  pub enum LyricsSource { Embedded, SidecarLrc, None }
  ```
  serde 默认的 enum 序列化是 `{"Embedded":null}` 对象形状，会破坏 TS 契约；**必须逐变体 rename 对齐 §10.3 的字面量**：
  ```rust
  #[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
  #[serde(rename_all = "snake_case")]
  pub enum LyricsSource {
      Embedded,
      #[serde(rename = "sidecar")]
      SidecarLrc,
      None,
  }
  ```
  - **契约形状（已冻结，勿偏离）**：`"embedded" | "sidecar" | "none"`（`src/lib/tauri.ts` 第 22 行；design.md §10.3 类型映射表）。
  - **注意**：`#[serde(rename_all = "snake_case")]` 会把 `SidecarLrc` 序列化为 `"sidecar_lrc"`，**与 TS 的 `"sidecar"` 不一致**——故 `SidecarLrc` 必须显式 `#[serde(rename = "sidecar")]`。单元测试需断言 `"sidecar"` 而非 `"sidecar_lrc"`。
- **MP3 读取版本**：lofty 读 MP3 时自动识别 ID3v2.3 / v2.4 均可读（PRD「兼容」：ID3v2.3 / v2.4 可读）；**写入统一 v2.4 由 `v1-song-save` 负责**，本变更只读不写。

### D2 字段映射（读）

**FLAC → Vorbis Comment**（PRD §5.1）：

| 字段 | Vorbis key | lofty ItemKey |
|---|---|---|
| title | `TITLE` | `ItemKey::TrackTitle` |
| artist | `ARTIST` | `ItemKey::TrackArtist` |
| album | `ALBUM` | `ItemKey::AlbumTitle` |
| album_artist | `ALBUMARTIST` | `ItemKey::AlbumArtist` |
| track | `TRACKNUMBER` | `ItemKey::TrackNumber` |
| track_total | `TRACKTOTAL` | `ItemKey::TrackTotal` |
| year | `DATE` | `ItemKey::Year` |
| genre | `GENRE` | `ItemKey::Genre` |
| lyrics | `LYRICS` | `ItemKey::Lyrics` |
| cover | PICTURE 块 | `tag.pictures()` |

**MP3 → ID3v2**（PRD §5.2）：

| 字段 | 帧 ID | lofty ItemKey |
|---|---|---|
| title | `TIT2` | `ItemKey::TrackTitle` |
| artist | `TPE1` | `ItemKey::TrackArtist` |
| album | `TALB` | `ItemKey::AlbumTitle` |
| album_artist | `TPE2` | `ItemKey::AlbumArtist` |
| track(+total) | `TRCK`（`x/y`） | `ItemKey::TrackNumber` / `ItemKey::TrackTotal` |
| year | `TDRC` | `ItemKey::Year` |
| genre | `TCON` | `ItemKey::Genre` |
| lyrics | `USLT` | `ItemKey::UnsyncLyrics`（用 `Tag::get_string(&ItemKey::UnsyncLyrics)` 取回纯文本） |
| cover | `APIC` | `tag.pictures()` |

实现统一抽象：
- **文本字段**：`ItemKey` 的 `Tag::get_string(key)` 返回 `Option<Cow<str>>` → `unwrap_or_default()`。`track`/`track_total` 在 MP3 的 `TRCK` 帧中可能写成 `x/y` 混合形式，lofty 的 `TrackNumber`/`TrackTotal` ItemKey 在**读**侧对 `TRCK` 已做 `x/y` 拆分；若个别文件仍返回合串，按 `/` 拆分一次兜底。
- **封面**：`tag.pictures()` 返回 `Vec<&Picture>`；取第一张（`CoverFront` 优先，V1 单封面场景取 `pictures[0]` 即可），`picture.data()` 为原始字节、`picture.mime_type()` 为 MIME（如 `image/jpeg`）。
- **未设置字段**：一律读为空串（PRD §6：读取时 Option，未设置为空串）；`cover` 无则 `None`。

### D3 封面 IPC（base64 data URL）

- Rust 侧 `open_song` 把封面 bytes + MIME 组装成 `data:<mime>;base64,...` 字符串放进 `cover`；`cover_mime` 单独存 MIME 字符串（供保存与展示用）。
- 前端 `<img :src="song.cover">` 直接用，无需 asset 协议（design.md §10.3：一次只编辑一首、图不大）。
- **MIME 探测**：优先用 lofty `Picture::mime_type()`（内嵌图片自带声明）；为空时退回 `image` crate 的 `image::guess_format(&bytes)` 探测。
- **解码时机**：`save_song`（v1-song-save）收到 base64 后 Rust 侧解码回 `Vec<u8>` 再写盘；本变更只做**编码**（读侧）。

### D4 坏标签只读

- `open_song` 返回 `Result<Song, String>`（`String` 为错误原因，方便前端直接展示）。
- 内部 `read_song_meta` 返回 `Result<Song, String>`：`Probe::open` 或 `.read()` 任一失败 → Err。前端捕获 Err → 表单 `readonly` 禁用 + 提示「标签损坏，只读」（FR-5.7），不进入可编辑状态。
- **与 `list_songs` 的差异**（重要边界）：`list_songs` 对坏文件**返回空串**保证列表不崩（已实现）；`open_song` 对坏标签**返回 Err**触发只读表单。两者语义不同，不可混用。
- 轻微异常字段（单个 key 解析失败）返回空串，不阻塞表单；仅结构级损坏（probe/read 失败）才 Err。

### D5 `lyrics_source` 内嵌判定

- 本变更先做「内嵌歌词 `trim()` 非空 → `Embedded`，否则 `None`」。
- `SidecarLrc`（同目录同名 `.lrc` 检测）由 `v1-lyrics-lrc` 补充，本变更不实现，但**枚举三值完整落位**（含 serde rename）以冻结契约。

### D6 前端 store：`SongEditor` 落位

`src/lib/tauri.ts` 已含 `Song`/`LyricsSource` 契约类型（v1-folder-list 预置），本变更**不需改动** TS 契约文件。

`src/store/song.ts` 落 `SongEditor` 形态：

```ts
interface SongEditor {
  folderPath: string | null
  songs: SongSummary[]
  searchQuery: string
  selectedPath: string | null
  current: Song | null      // 编辑中（open_song 结果）
  original: Song | null     // 打开时快照
  dirty: boolean            // computed：current/original 逐字段对比
  lyricsSource: LyricsSource // 快照 `current.lyrics_source`（占位，供 UI）
  readonly: boolean         // 坏标签只读开关（Err → true，禁用表单）
}
```

- **`dirty`**：`computed(() => 字段逐项对比)`；`current === null || original === null` → false（「打开即干净」场景）。对比字段 = 全部 10 个可编辑字段（`title`/`artist`/`album`/`album_artist`/`track`/`track_total`/`year`/`genre`/`lyrics`/`cover`）；`path`/`lyrics_source` 不参与 dirty 判定（不可编辑元数据）。
- **`open(path)` action**：`invoke('open_song', { path })` → 成功则 `current = original = song`、`readonly = false`；失败（Err）则 `current = original = null`、`readonly = true`（表单显示只读提示，不进入编辑态）。
- **切歌确认**：dirty 时切歌弹窗由 `v1-ux-settings` 统一实现；本变更只保证 store 持有 `dirty` 状态与选中联动。**行为底线**：本变更切歌不弹窗（spec 未要求），直接替换 current/original，`dirty` 随 computed 自动归零。
- **store 保持单文件**：`selectSong` 已在（左栏点击设 `selectedPath`）；本变更在 `selectSong` 内追加 `open()` 调用（或由 SongRow 的 click handler 编排，见任务 2.8）。

### D7 组件结构与渲染

组件树（对齐 design.md §10.1，本变更交付骨架）：

```
Editor.vue          # 右栏编辑表单：EditorBar + FieldGrid + LyricPanel；空态/只读态分支
├── EditorBar.vue   # 「正在编辑: 文件名 + 作者」+ 保存状态占位 + 撤销/保存占位（disabled）
├── FieldGrid.vue   # 字段网格 1fr 200px（两列布局）
│   ├── FieldList.vue   # 8 字段列表（歌名/作者/专辑/专辑作者/音轨号/年份/流派/文件名）
│   │   └── FieldRow.vue
│   └── CoverPanel.vue  # 封面区（1:1）+ 空态占位 + 搜索封面按钮占位
└── LyricPanel.vue  # 歌词来源 badge + 搜索歌词按钮占位 + 等宽 textarea
```

- **两列布局**：`.field-grid { display: grid; grid-template-columns: 1fr 200px; }`（spec「编辑表单两列布局」；design.md §5 字段网格 `1fr 200px`）。
- **文件名行**：只读展示 `fileName(current.path)`（mono），不可编辑（改名属 `v1-rename-sync`）。
- **CoverPanel 空态**：无封面时虚线框 + 占位提示（spec「封面区占位」）。
- **LyricPanel badge**：显示「来源: 内嵌标签 / 未关联 .lrc / 无」对应 `lyrics_source`；textarea 等宽 mono、`readonly` 跟随表单状态。
- **可编辑性**：字段输入框本变更即可编辑（v-model 绑 `current`），`dirty` 随之变化；**保存/撤销按钮 disabled 占位**，保存语义由 `v1-song-save` 接。

### D8 依赖与模块边界

Rust 新增依赖（`Cargo.toml`）：
- `image`（MIME 探测兜底；版本对齐 PRD §7）
- `base64`（data URL 编码）

新增模块：
- `commands.rs` 追加 `open_song` command 与 `read_song_meta` 内部函数；`Song`/`LyricsSource` 定义放 `commands.rs`（与 `SongSummary` 同文件，V1 规模不拆 module）。封面 base64 组装为私有 helper。
- `lib.rs` `generate_handler![...]` 追加 `commands::open_song`。

**API 边界**：
- `list_songs` → `Vec<SongSummary>`（不变）
- `open_song(path: PathBuf) -> Result<Song, String>`（新增）
- `Song`/`SongSummary` 共用 `path: String` 形状；前端 `open_song` 入参直接复用列表项的 `path`。

## Risks / Trade-offs

- **封面 bytes 经 IPC**：单首封面 ≤2048×2048 通常 <2MB，base64 膨胀约 33%，可接受（一次只编辑一首；design.md §10.3 已拍板 data URL 方案）。
- **坏标签边界**：结构严重损坏 → probe/read Err → 只读；轻微字段异常 → 空串不阻塞。列表层（空串）与详情层（Err）语义差异已明确隔离。
- **MP3 TRCK 混合串**：极少数 `TRCK` 含 `x/y` 合并形式，读侧按 `/` 拆分兜底，避免 track_total 丢失。
- **serde 枚举序列化**：若不加 `#[serde(rename_all = "snake_case")]`，`LyricsSource` 会序列化成对象形状破坏 TS 契约——测试必须覆盖 `song-open` 契约序列化形状。

## 任务拆分建议

分组与依赖（Rust 优先于前端接入）：

1. **Rust（D1–D5）**：`Song`/`LyricsSource` 定义 + serde 契约 → `read_song_meta` 读字段映射 → 封面 base64 → `lyrics_source` 判定 → `open_song` command + 注册 → 单元测试（字段映射/坏标签/契约形状）。
2. **前端 store（D6）**：`SongEditor` 形态落位（`dirty` computed、`open()` action、`readonly`）→ store 测试。
3. **前端组件（D7）**：`Editor`/`EditorBar`/`FieldGrid`/`FieldList`/`FieldRow`/`CoverPanel`/`LyricPanel` 骨架 + 两列布局 → 选中联动 → 坏标签只读提示。
4. **验证**：`cargo test` + `cargo clippy`、`npm run build` + `npm run test`、`npm run tauri dev` 人工确认。
