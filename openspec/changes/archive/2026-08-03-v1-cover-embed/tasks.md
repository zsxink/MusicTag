# v1-cover-embed 任务清单

> 依赖顺序：**Rust → Vue 串行**（变更域 both；未显式创建 worktree 时禁止并行）。
> Rust 分组（1）交付 command 契约后，前端（2→3）方可接入。

## 1. Rust：封面选择与压缩

- [x] 1.1 `model.rs` 新增 `CoverInput { data_url: String, mime: String }`（serde 契约，与 `src/api/types.ts` 对齐）
- [x] 1.2 `service/cover.rs` 新增纯逻辑 `compress_cover(bytes, mime) -> Result<(Vec<u8>, String), String>`：任一边 >2048 → `image::load_from_memory` + 等比 resize（Lanczos3）至 ≤2048×2048 → 按原格式重编码（JPEG/PNG 有损/无损，WebP 走 lossless——image crate 仅支持 lossless）；双维 ≤2048 的图（无论体积，含 >5MB）不放大、原样返回；解码失败 `Err("封面格式无法识别")`；仅重编码失败回退原 bytes
- [x] 1.3 `service/cover.rs` 新增 `cover_from_path(path) -> Result<CoverInput, String>`：`std::fs::read` → `compress_cover` → `encode_data_url`（复用既有）+ mime；读失败/非图片 → Err(中文原因)
- [x] 1.4 `commands/cover.rs` 新增 module：`pick_cover_file() -> Option<CoverInput>`（rfd 文件对话框，`add_filter("图片", &["jpg","jpeg","png","webp"])`，取消 → None）与 `read_cover_path(path: String) -> Result<CoverInput, String>` 薄壳（只委托 `cover_from_path`）
- [x] 1.5 `commands/mod.rs` 追加 `pub mod cover;`；`lib.rs` `generate_handler![...]` 追加 `commands::cover::pick_cover_file, commands::cover::read_cover_path`
- [x] 1.6 单测（内联）：压缩边界（>2048 大图缩至 ≤2048、≤2048 小图不变、>5MB 触发、mime 保持 jpeg/png/webp）、非图片字节 → Err、重编码失败回退原 bytes、WebP lossless 重编码可解码

## 2. 前端 api + store

- [x] 2.1 `src/api/types.ts` 新增 `interface CoverInput { data_url: string; mime: string }`
- [x] 2.2 `src/api/songs.ts` 新增 `pickCoverFile()`（`invoke('pick_cover_file')` → `Promise<CoverInput | null>`）与 `readCoverPath(path)`（`invoke('read_cover_path', { path })` → `Promise<CoverInput>`）；`api/songs.test.ts` 补透传断言
- [x] 2.3 `store/song.ts` 新增 `setCover(input: CoverInput)`（`current.cover = data_url; current.cover_mime = mime`，readonly 时无视）与 `clearCover()`（`current.cover = null; current.cover_mime = null`）；`cover` 已在 `DIRTY_FIELDS`，无需改 dirty 判定；`store/song.test.ts` 补 setCover/clearCover + dirty 翻转单测

## 3. 前端组件：封面区交互

- [x] 3.1 `CoverPanel.vue` 点击选择：封面框 `@click` → `pickCoverFile()` → 非 null 则 `setCover`（readonly 时禁用）
- [x] 3.2 `CoverPanel.vue` 拖拽嵌入：`onMounted` 订阅 `getCurrentWindow().onDragDropEvent`（`@tauri-apps/api/window`），`enter/over` 命中封面框才置 `dragging` class、`drop` 命中封面框取 `paths[0]` → `readCoverPath` → `setCover`、`leave` 复位；`onBeforeUnmount` 调 `unlisten`；**命中判定按 `devicePixelRatio` 把 PhysicalPosition（物理像素）与 `getBoundingClientRect()`（CSS px）对齐**、限定封面框范围（拖到其他区域不嵌入）；readonly 忽略 drop；非 Tauri 环境 try/catch 静默降级；组件经 `api/songs.ts` 发 IPC（不直呼 invoke）
- [x] 3.3 预览与展示：`<img :src="current.cover">` 渲染压缩后小图；`cover_mime` 展示 JPEG/PNG/WEBP；空态虚线框提示「点击选择 / 拖拽嵌入」（替换现「无封面」静态文案）
- [x] 3.4 清空封面：有封面时提供清空操作（如 ✕ / 移除封面按钮）→ `clearCover()`；保存后 `cover=None` 走既有删除语义
- [x] 3.5 错误处理：`pickCoverFile`/`readCoverPath` reject → 不污染现有封面，一行 dim 提示；readonly 时封面区整体禁用；「搜索封面」按钮保持 disabled 占位（v1-search-ui 接）
- [x] 3.6 组件单测：点击选择（mock `@tauri-apps/api/core`）、拖拽（mock `@tauri-apps/api/window` 的 `getCurrentWindow().onDragDropEvent` 返回 fake unlisten）、清空封面、readonly 禁用、非图片 reject 不污染封面

## 4. 验证

- [x] 4.1 `cargo test --manifest-path src-tauri/Cargo.toml` + `cargo clippy` 通过（压缩边界单测 + `tests/save_song.rs::save_song_embeds_compressed_cover_not_original` 压缩链路集成）
- [x] 4.2 `npm run test` + `npm run build` 通过
- [ ] 4.3 `npm run tauri dev` 人工确认：点击选择/拖拽嵌入封面、>5MB 大图压缩后保存、第三方工具（Kid3/mutagen）验证嵌入的是 ≤2048 压缩图、清空封面保存后字段删除
