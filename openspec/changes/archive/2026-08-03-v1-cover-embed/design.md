# v1-cover-embed 技术设计

## Context

`v1-song-save`（已归档）已实现 cover 统一写回通道：`save_song` 接收 `Song.cover`（base64 data URL）→ `service::cover::decode_cover` 解码回原始字节 → `meta::apply_cover` 构造 lofty `Picture`（FLAC PICTURE / MP3 APIC）写回。本变更补齐封面**嵌入交互**：点击选择（`rfd` 文件对话框）、拖拽嵌入、>5MB 自动压缩、封面区预览（压缩后小图），并统一「本地选择 / 网络下载（后续 `v1-search-backend`）= 获得 bytes → 封面区 → `save_song` 嵌入」路径。

复用不动：
- `service::cover::{encode_cover, encode_data_url, decode_cover}`（data URL 编解码，v1-song-read 已落位，design.md §10.0 指明 `v1-cover-embed` 落位 `service/cover.rs` 扩展）。
- `meta::apply_cover` 写盘（PICTURE/APIC，`PictureType::CoverFront`），**无独立 `embed_cover` command**（design.md §10.3 已定：网络/本地统一走 `save_song`）。
- store 的 `DIRTY_FIELDS` 已含 `cover`（`store/song.ts`）——封面预览写入 `current.cover` 即自动翻转 dirty，无需改 dirty 判定。
- `image`（v1-song-read 已引入，用于 mime 探测）、`rfd`（v1-folder-list 已引入，用于 `pick_folder`）依赖均已存在，**无新 Rust 依赖**。

## Goals / Non-Goals

**Goals:**
- Rust command `pick_cover_file() -> Option<CoverInput>`（rfd 原生文件对话框，jpg/png/webp 过滤器，返回压缩后 bytes 的 data URL + mime）。
- Rust command `read_cover_path(path) -> Result<CoverInput, String>`（拖拽路径 → 读文件 → 压缩 → data URL），与点击选择同压缩路径。
- 压缩函数 `compress_cover(bytes, mime)`：任一边 >2048 或 bytes >5MB → 等比缩至 ≤2048×2048；≤2048×2048 的小图**不放大**、原尺寸保留（PRD §5.3 / spec「小图不放大」）。
- 封面区预览 = 压缩后小图（`current.cover` data URL），`save_song` 统一嵌入压缩图，**原图丢弃**（PRD §5.3 决策 A）。
- 拖拽嵌入 + 封面区清空操作（置 null → 保存后字段删除，配合全量覆盖语义）。

**Non-Goals:**
- 不做网络封面下载（`v1-search-backend` 的 `download_cover`；其结果走同一条「获得 bytes → 封面区」路径）。
- 不做封面候选网格与搜索（`v1-search-ui`；「搜索封面」按钮保持 disabled 占位）。
- 不改 `save_song` / `meta::apply_cover` 写盘逻辑、不改 `Song`/TS 契约。

## 变更域判定

**both（跨前后端）**。

- Rust 侧独立可先行：`compress_cover` 纯逻辑（`service/cover.rs` 内联单测）、两个 command 薄壳（`commands/`）、`lib.rs` 注册。前端不依赖 Rust 内部实现，只依赖 command 契约 `Option<CoverInput>` / `Result<CoverInput, String>`。
- 前端依赖后端契约定型：`api/songs.ts` 封装、`store` 动作、`CoverPanel` 交互（点击/拖拽/预览/清空）都消费这两个 command 的返回。
- **执行顺序：Rust → Vue 串行**（任务分组见「任务拆分建议」）；未显式创建 worktree 时禁止并行（`music-tag-branch-switch` 记忆：workflow 运行中勿切分支）。

## Decisions

### D1 Command 契约：`pick_cover_file` / `read_cover_path`

新增 Rust 结构（`model.rs`，与 TS 契约对齐）：

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoverInput {
    pub data_url: String, // data:<mime>;base64,...（压缩后小图的 base64 data URL）
    pub mime: String,     // image/jpeg | image/png | image/webp
}
```

新增 command（`commands/cover.rs` 薄壳，只做参数接收与对 service 委托）：

```rust
#[tauri::command]
pub fn pick_cover_file() -> Option<CoverInput> {
    // rfd FileDialog::new().add_filter("图片", &["jpg","jpeg","png","webp"]).pick_file()
    // 取消 → None；选中 → service::cover::cover_from_path(path)
}

#[tauri::command]
pub fn read_cover_path(path: String) -> Result<CoverInput, String> {
    // 拖拽路径 → service::cover::cover_from_path(path)，读/解/压缩失败 → Err(中文原因)
}
```

- `lib.rs` `generate_handler![...]` 追加 `commands::cover::pick_cover_file, commands::cover::read_cover_path`。
- **为什么 `data_url` 而非裸 bytes_base64**：`CoverInput.data_url` 直接进 `current.cover`（`<img :src>` 直接用，与 `open_song` 返回的 `cover` 同形状），避免前端再拼 `data:` 前缀；mime 一并返回供 `cover_mime` 展示。契约与 `Song.cover` 完全同构，前端零转换。
- **为什么两个 command**：点击选择需要系统对话框（rfd，同步在主线程——同 `pick_folder` 既有模式，macOS 对话框必须在主线程）；拖拽走 Tauri 原生 `onDragDropEvent` 拿到的是**文件路径**（见 D4），需 Rust 读文件。两者压缩逻辑复用同一 `cover_from_path`。
- **取消/失败同 `None`**：`pick_cover_file` 中 `cover_from_path` 失败（所选文件非图片/读失败）与用户取消**同返回 `None`**——前端无差别处理（`null` → 不操作，不弹错），与 `pick_folder` 的 null 语义对齐；拖拽路径的失败才经 `read_cover_path` 以 `Err(中文原因)` 暴露给前端一行 dim 提示（D5）。
- **无独立 `embed_cover`**：封面不单独写盘，一律并入 `save_song`（design.md §10.3 已定）。本变更**不新增任何写盘 command**。

### D2 压缩策略（`service/cover.rs` 扩展）

纯逻辑函数（无文件系统操作，内联单测；`service/cover.rs` 现状是「纯逻辑 data URL 编解码」，本变更保持其纯逻辑定位）：

```rust
/// bytes + mime → 压缩后 bytes + 原 mime。
/// 触发：任一边 > 2048 → 等比缩至 ≤2048×2048（维度目标；spec「>5MB 压缩」
///       落在大图——维度过限才需缩，缩至 ≤2048 即消除元数据膨胀）。
/// 双维 ≤2048 的图（无论体积，含 >5MB）→ 原 bytes 原样返回（不放大）。
/// 解码失败 → Err；仅重编码失败（解码成功）→ 回退原 bytes（静默，不阻塞嵌入）。
pub fn compress_cover(bytes: &[u8], mime: &str) -> Result<(Vec<u8>, String), String>
```

实现要点：
1. `image::load_from_memory(bytes)` 解码（`image` 0.25.10，default features 已含 jpeg/png/webp，`Cargo.lock` 确认 `image-webp` 已编入）。
2. `img.width()` / `img.height()`：若均 ≤2048 → `Ok((bytes.to_vec(), mime.to_string()))`（小图不放大、原尺寸保留嵌入；含 >5MB 但双维 ≤2048 的罕见边界——维度目标已满足，同样原样返回，见 D7）。
3. 否则 `img.resize(nw, nh, FilterType::Lanczos3)` 等比缩放（`DynamicImage::resize`，等比 = 保证单边 ≤2048），再按**原格式**重编码。
4. 原格式判定：`ImageFormat::from_mime_type(mime)` 优先，兜底 `image::guess_format(bytes)`。重编码走 `img.write_to(&mut buf, format)` → `buf.into_inner()`。
5. **格式分支**：
   - JPEG → JPEG 重编码（有损，尺寸压下来即达标）；
   - PNG → PNG 重编码（无损，原像素保留）；
   - **WebP → WebP 重编码（image crate 仅支持 lossless 编码，源码确认 `codecs/webp/encoder.rs: only lossless encoding supported`）**——像素无损、不引入额外画质损失；体积可能偏大属可接受（单首场景）。
   - 其余格式（bmp/gif/tiff，rfd 过滤器虽只留 jpg/png/webp，但拖拽可带任意文件）→ 解码失败即 `Err`；解码成功则按 `guess_format` 原格式重编码。
6. **失败语义**：`load_from_memory` 失败（非图片字节）→ `Err("封面格式无法识别")`（与 `decode_cover` 拒绝写坏封面对称，前端不预览不嵌入）；重编码失败（极罕见，解码已成功）→ 回退**原 bytes**（`Ok((bytes, mime))`，静默保留，不阻塞嵌入——spec/design 既定的「压缩失败静默保留原 bytes」）。

文件读取编排（service 层，含 fs I/O；commands 薄壳只委托）：

```rust
/// 读文件 → compress_cover → data URL。读失败/非图片 → Err(中文原因)。
pub fn cover_from_path(path: &Path) -> Result<CoverInput, String>
```

- `std::fs::read` → `image::guess_format` 按字节探测 mime（**非图片字节 → `Err("封面格式无法识别")`，先于解码拦截**）→ `compress_cover(&bytes, &mime)` → `CoverInput { data_url: encode_data_url(&compressed, &mime), mime }`（复用 `cover::encode_data_url`，见 Context）。**mime 探测必须先于 `compress_cover`**：小图路径原样返回字节，`CoverInput.mime` 只能由 `guess_format` 提供。
- 返回的 `data_url` 即为压缩后小图；原图字节丢弃（PRD §5.3 决策 A：进标签的是 ≤2048 压缩图）。

### D3 统一封面路径（无独立 embed_cover）

本地选择（`pick_cover_file`）、拖拽（`read_cover_path`）、网络下载（后续 `v1-search-backend` 的 `download_cover`）全部归一为：

```
获得 bytes → compress_cover（≤2048）→ CoverInput.data_url → current.cover
                                                        ↓ save_song
                              meta::apply_cover（PICTURE/APIC 原始字节）
```

- 封面区预览的就是压缩后 data URL，`save_song` 收 `Song.cover` 统一嵌入；**前端不持有原图，原图在 Rust 侧压缩后即弃**。
- 本变更为该统一路径落地「本地」分支；`v1-search-backend` 只补「网络」分支（`download_cover` 返回 bytes 后走同一条 `compress_cover`）。

### D4 拖拽嵌入：Tauri 原生 drag-drop（非 WebView FileReader）

**决策**：拖拽用 Tauri 原生 `getCurrentWindow().onDragDropEvent`（`@tauri-apps/api/window`，`webview.d.ts` 确认：`DragDropEvent` 的 `drop` 变体携带 `paths: string[]`），drop 时取 `paths[0]` → `api/songs.ts` 的 `readCoverPath(path)`（invoke `read_cover_path`）→ Rust 读文件 + 压缩 → `CoverInput`。

**为什么不用 HTML5 `dragover/drop` + `FileReader`**（design.md 旧版 Risks 的顾虑，此处定为正式决策）：
- Tauri 2 的 WebView（尤其 macOS WKWebView）对拖入文件的 `File` 对象**不保证暴露本地路径**（安全限制），`FileReader` 可能读到空/失败；native drag-drop 由 Tauri 进程侧直接给**真实绝对路径**，`fs::read` 可靠。
- 拖拽与点击共用 Rust 压缩路径，行为完全一致（spec「拖拽文件到封面区 → 封面区预览该图」）。

前端接入点（分层约束，见 D5）：`CoverPanel.vue` 内 `onMounted` 订阅 `getCurrentWindow().onDragDropEvent`
（`@tauri-apps/api/window`；返回的 `unlisten` 在 `onBeforeUnmount` 调用释放防泄漏）：
- `enter/over`：`isInsideCoverBox(event.payload.position)` **命中封面框矩形才**置 `dragging` class（虚线框 hover 琥珀，design §6.1 封面区样式）；
- `drop`：命中封面框且 `paths[0]` 非空 → `readCoverPath` → `setCover`；**拖到歌词区/字段区/顶栏任意处落下一律不嵌入**（spec「拖拽文件到封面区」）；
- `leave`：复位 `dragging`。
- **命中判定细节（CR 定稿，易踩坑）**：`onDragDropEvent` 的 `position` 是 **PhysicalPosition（物理像素）**，而 `getBoundingClientRect()` 返回 **CSS 像素** → 须按 `window.devicePixelRatio` 把封面框矩形缩放对齐后再做包含判定；不换算会在 Retina（dpr=2）下把命中框偏移/缩小一半而错判。无 `position`（如 leave）一律视为未命中。
- **readonly 时 drop 一律忽略**（事件回调首行 `if (readonly.value) return`，含高亮复位）。
- **非 Tauri 环境静默降级**：`onDragDropEvent` 用 try/catch 包裹——`npm run dev` 浏览器态或单测 mock 缺失时无拖拽能力，静默降级不报错（点击选择仍可用）。
- **组件不直接 invoke**（guard `components/layering.test.ts` 只禁 `@tauri-apps/api/core`；`@tauri-apps/api/window` 事件订阅属窗口事件、非 IPC，IPC 仍经 `api/songs.ts`，符合 §10.0 分层）。

### D5 前端接入（api / store / CoverPanel）

- **`api/songs.ts`** 追加两个类型化封装（命令名逐字对齐 Rust 契约，仿既有 `pickFolder`/`openSong` 透传）：
  ```ts
  export function pickCoverFile(): Promise<CoverInput | null>   // invoke('pick_cover_file')
  export function readCoverPath(path: string): Promise<CoverInput> // invoke('read_cover_path', { path })
  ```
  `types.ts` 追加 `interface CoverInput { data_url: string; mime: string }`（与 Rust struct 对齐）。
- **`store/song.ts`** 追加两个动作（组件不直接改 store 对象，封装为 action 便于测试注入与守卫）：
  ```ts
  export function setCover(input: CoverInput): void   // current.cover = data_url; current.cover_mime = mime
  export function clearCover(): void                  // current.cover = null; current.cover_mime = null
  ```
  - `cover` 已在 `DIRTY_FIELDS`（`store/song.ts`）→ 预览/清空自动翻转 dirty，无需改 dirty 判定；`cover_mime` 不在 `DIRTY_FIELDS`，但 `setCover`/`clearCover` 总随 `cover` 同步赋值，不会产生 dirty 漂移。
  - `readonly`（坏标签只读）时禁止 set/clear（`CoverPanel` 按钮与 drop handler 均 `:disabled="songStore.readonly"` 守卫）。
  - `clearCover` 置 `null` 后保存：`save_song` 收到 `cover=None` → `apply_cover` 不 push、`clear()` 已删封面（spec「清空封面」/「统一写盘」）。
- **`CoverPanel.vue`**（既有组件改造，spec 场景全落）：
  - **点击选择**：封面框 `@click`（空态或已有封面均可点）→ `pickCoverFile()` → 非 null 则 `setCover`。
  - **拖拽嵌入**：D4 的 `onDragDropEvent` 订阅 → `readCoverPath(paths[0])` → `setCover`；`dragging` class 高亮。
  - **预览**：既有 `<img :src="current.cover">`（已有形态）继续渲染压缩后小图；`cover_mime` 展示 mime（JPEG/PNG/WEBP）。
  - **空态占位**：无封面时虚线框 + 「点击选择 / 拖拽嵌入」提示（替换现「无封面」静态文案，design §6.1 封面区）。
  - **清空封面**：有封面时封面区提供清空操作（如右上角 ✕ 或底部「移除封面」按钮）→ `clearCover()`。
  - 错误处理：`pickCoverFile`/`readCoverPath` reject（非图片/读失败）→ 不污染现有封面，可给一行 dim 提示（不弹窗，工具线克制）。
  - `readonly` 时整个封面区禁用（不响应点击/drop）。
  - 「搜索封面」按钮保持 disabled 占位（`v1-search-ui` 接语义，本变更不动）。

### D6 依赖与模块边界

Rust 依赖变化：**无新增**。`image`（0.25.10，压缩 + mime 探测）、`rfd`（0.17.2，文件对话框）、`base64`（data URL 编码）均已存在；`image` default features 已含 `webp`/`jpeg`/`png`（`Cargo.lock` 确认 `image-webp` 编入）。

落位（design.md §10.0 强制）：
- `service/cover.rs`：新增 `compress_cover`（纯逻辑，内联单测）+ `cover_from_path`（fs 读 + 压缩 + data URL 编排）。
- `commands/cover.rs`：新增 module，`pick_cover_file` / `read_cover_path` 薄壳（`commands/mod.rs` 追加 `pub mod cover;`）。
- `model.rs`：新增 `CoverInput` struct（serde 契约，与 `src/api/types.ts` 对齐）。
- `lib.rs`：`generate_handler![...]` 追加两个 command。
- 前端：`api/types.ts`（`CoverInput`）、`api/songs.ts`（两个封装 + 单测）、`store/song.ts`（`setCover`/`clearCover` + 单测）、`components/CoverPanel.vue`（交互 + 组件单测）。

**测试放置（design.md §10.4）**：
- `compress_cover`/`cover_from_path` 纯逻辑单测 **内联** `service/cover.rs`（无文件 I/O；`cover_from_path` 的 fs 读用 `std::fs` 写临时图片文件即可，或拆出纯 `compress_cover` 测试）。
- command 契约单测 `commands/cover.rs` 内联（`read_cover_path` 给不存在路径 → Err）。
- 前端 `api/songs.test.ts`（透传断言）、`store/song.test.ts`（setCover/clearCover + dirty 翻转）、`components/editor.test.ts` 或新建 `components/cover-panel.test.ts`（点击/拖拽/清空，mock `@tauri-apps/api/window` 的 `getCurrentWindow().onDragDropEvent` 返回 fake unlisten）。
- 集成验证（已落位 `src-tauri/tests/save_song.rs::save_song_embeds_compressed_cover_not_original`）：大图 bytes → `compress_cover` → `encode_data_url` → `Song.cover` → `save_song` 写盘 → `read_song_meta` 读回 → 解码字节 = 压缩图（≤2048×2048 且 ≠ 原大图）——「统一写盘」「进标签的是压缩图、原图丢弃」的端到端断言。

### D7 边界与风险

- **UI 短暂阻塞**：`pick_cover_file` 是同步 command（同 `pick_folder`，macOS 对话框须主线程）；压缩大图时 decode+encode 会在主线程跑几十~几百 ms。单首场景可接受（工具线，一次选一张）。若后续性能告警再改 async + rfd async API，不在本变更处理。
- **>5MB 但双维 ≤2048 的图**：spec「对 >5MB 图片自动等比缩至 ≤2048×2048」按体积表述，但压缩目标是**维度**（≤2048×2048）——双维已 ≤2048 时**无法再缩**（等比目标已满足），`compress_cover` 原样返回（不放大、不重编码）。该场景罕见（≤2048 维度的图超过 5MB 极少），且维度不超即不会造成「元数据膨胀」，属可接受边界。
- **WebP 重编码为 lossless**：image crate 仅支持 lossless WebP 编码（源码确认），重编码像素无损但体积可能偏大；不引入画质损失，单首封面体积可控（≤2048 维度）。
- **拖拽非图片文件**：drop 任意文件 → `read_cover_path` 的 `load_from_memory` 失败 → `Err` → 前端不污染封面、显示提示。rfd 过滤器（jpg/png/webp）已拦点击路径。
- **原图丢弃**：压缩在 Rust 侧完成，前端只拿压缩后 data URL，原图无处残留（PRD §5.3 决策 A 既定）。

## 任务拆分建议

依赖顺序 **Rust → Vue 串行**（变更域 both；`config.yaml rules.tasks`：Rust 后端 command 优先于前端接入）：

1. **Rust（D1–D2、D6）**：`model.rs` 加 `CoverInput` → `service/cover.rs` 加 `compress_cover`（压缩边界单测）+ `cover_from_path` → `commands/cover.rs` 两个薄壳 + `commands/mod.rs`/`lib.rs` 注册 → 单测（大图缩至 ≤2048、小图不变、mime 保持、非图片 Err、重编码失败回退原 bytes、WebP lossless 重编码）。
2. **前端 api + store（D5）**：`types.ts` 加 `CoverInput` → `api/songs.ts` 加 `pickCoverFile`/`readCoverPath`（透传单测）→ `store/song.ts` 加 `setCover`/`clearCover`（dirty 翻转单测）。
3. **前端组件（D4–D5）**：`CoverPanel.vue` 点击选择 + 预览 + mime 展示 + 空态提示 + 清空封面 + 拖拽（`onDragDropEvent` → `readCoverPath`）+ readonly 守卫 + 组件单测（mock `@tauri-apps/api/window`）。
4. **验证**：`cargo test` + `cargo clippy`、`npm run test` + `npm run build`、`npm run tauri dev` 人工确认（点击/拖拽嵌入、>5MB 大图压缩后保存、第三方工具 Kid3/mutagen 验证嵌入 ≤2048 压缩图、清空封面保存后字段删除）。
