# Tasks: 封面右键导出内嵌封面原图

GitHub Issue: #124

## 领域

`both`（Rust 后端 → Vue 前端；同一 worktree 跨域写入必须遵守该方向，Rust 任务先落盘并通过 `cargo test` 后再动前端）

## 任务顺序与文件所有权

以下任务按 Rust 实现 → Rust 测试 → 文档契约同步 → 前端实现 → 前端测试 → 验证门禁顺序执行。每项只由对应 Agent 修改列出的 `paths`；**任务之间 `paths` 不重叠**。主会话负责勾选完成状态、审计差异并记录 progress。

> 分层与只读约束（贯穿全部任务，CR 必查）：
> - IPC 只允许出现在 `src-tauri/src/commands/`（Rust）与 `src/api/client.ts`（前端）。命令层薄壳，业务在 `service/`。
> - 前端组件禁止直呼 `invoke`，一律经 `src/api/songs.ts`。
> - 导出是**纯只读**动作：不得改标签、不得改 store 的 `current`/`original`、不得置 `dirty`、不得触发 `save_song`。
> - **不扩大范围**：不碰歌词、不碰搜索、不做批量、不做 Tauri 原生菜单。

- [ ] 1. **提取共享取图逻辑（含 APE 回退）** — owner: Dev；paths: `src-tauri/src/service/reader.rs`
  - 抽出 `pub fn first_embedded_picture(path, tag) -> Option<Picture>`：先 `tag.pictures().first().cloned()`，再对 `.ape` 扩展名回退 `read_ape_cover`（后者提升为 `pub`）。
  - `read_song_meta` 改为调用该 helper，**取值语义与改前逐字节等价**（`map(encode_cover).unwrap_or((None, None))` 链不变）。
  - 只做提取与可见性放宽，不新增业务分支、不改错误文案。
- [ ] 2. **service 层导出实现（取图 / 扩展名推断 / 写盘）** — owner: Dev；paths: `src-tauri/src/service/cover.rs`
  - 新增 `pub fn export_cover_bytes(song_path: &Path) -> Result<(Vec<u8>, Option<String>), String>`：用 `Probe::open` + `first_embedded_picture`，返回 `picture.data().to_vec()` 与 `picture.mime_type()`；无内嵌封面 → `Err("该歌曲没有内嵌封面")`。
  - 新增 `pub fn cover_extension_for(mime: Option<&str>, bytes: &[u8]) -> &'static str`：mime 走 `ImageFormat::from_mime_type`，为 `None` 时回落 `image::guess_format`；**手写 `ImageFormat → &'static str` 映射表**（image 0.25.10 **没有** `extension_str()`，勿调用）；jpeg→`"jpg"`、png→`"png"`、webp→`"webp"`、gif/tiff/bmp 等按表；表未命中与 mime/字节都判不出时**兜底 `"jpg"`**。
  - 新增 `pub fn default_cover_file_name(audio_path: &Path, mime: Option<&str>, bytes: &[u8]) -> String`：音频文件名去扩展名（`file_stem`）+ `"."` + `cover_extension_for(mime, bytes)`；stem 为空时兜底 `"cover"`。
  - 新增 `pub fn write_cover_to(dest_path: &Path, bytes: &[u8]) -> Result<(), String>`：`std::fs::write`，失败 → `Err(format!("导出封面失败: {e}"))`。**不做原子替换、不做备份、不做撞名保护**（见 design.md §3.4 取舍）。
- [ ] 3. **command 薄壳 ×2 + rfd 存盘对话框** — owner: Dev；paths: `src-tauri/src/commands/cover.rs`
  - **两个同步 command**（签名以 design.md §0 方案 Y 为准，**已由主会话与用户裁决**）：
    - `pub fn pick_cover_save_path(song_path: String) -> Result<Option<String>, String>`
    - `pub fn export_cover(song_path: String, dest_path: String) -> Result<(), String>`
  - `pick_cover_save_path` 顺序：`export_cover_bytes` 取 bytes 与 mime（失败直接回中文错误，**不弹框**）→ `default_cover_file_name` 算默认名与扩展名 → `FileDialog::new().set_title("导出封面").set_file_name(&default_name).set_directory(song_path 父目录).add_filter(ext, &[ext]).save_file()` → `Ok(dest.map(路径转字符串))`。对话框返回 `None`（取消）→ `Ok(None)`，**不写任何文件**。
  - `export_cover` 顺序：`export_cover_bytes` → `write_cover_to(dest_path, &bytes)`。**不弹框、不重算扩展名、不校验 `dest_path` 扩展名**（用户在对话框里改名改扩展名是用户的决定）。
  - `pick_cover_save_path` 顶部注释标注「macOS 对话框须主线程」，与 `pick_cover_file` 一致；**两个都不得**套 `spawn_blocking`。
  - 业务逻辑全部委托 `service::cover`，本文件只做编排与错误文案包装。
- [ ] 4. **Rust 测试：导出行为** — owner: Tester；paths: `src-tauri/tests/export_cover.rs`（新建）
  - **第一个测试必须是 fixture 早检**：构造 FLAC（`common::add_tags`）与 APE（`common::add_ape_tags_with_picture`）fixture → 断言 `Probe::open().read()` 成功且 `first_embedded_picture` 返回 `Some`、`data()` 与构造 bytes 一致。**早检不过则先修 fixture，不许继续写业务断言、不许放宽断言。**
  - 覆盖 spec S2：`export_cover_bytes` 返回 bytes 与内嵌原图逐字节相等（FLAC + APE 双格式）。
  - 覆盖 **端到端写盘**：`export_cover(song, dest)` 两参语义在 service 层等价 —— 取 `export_cover_bytes` + `write_cover_to` 后 `fs::read(dest)` 与内嵌 bytes 逐字节相等（rfd 弹框不可自动测，但纯写盘路径可测）。
  - 覆盖 S2b（非压缩证明）：内嵌 >2048 的大图（在本文件内本地生成，不进 `common`）→ 导出 bytes 尺寸仍为原尺寸，未被 `compress_cover` 处理。
  - 覆盖 S5（只读）：导出前后 `std::fs::read(song_path)` 完全相同。
  - 覆盖 S6 写盘失败：`write_cover_to` 对不存在的父目录返回 `Err` 且文案含「导出封面失败」。
  - 覆盖 S7 后端侧：无内嵌封面 fixture → `export_cover_bytes` 返回 `Err("该歌曲没有内嵌封面")`。
  - **S4（取消）不自动化**：rfd `save_file()` 在无头测试里无法点「取消」，只靠代码逻辑 + `pick_cover_file` 的 `None` 先例背书；由任务 9 的前端断言（`null` → 不调 `export_cover`）+ 主会话人工验收覆盖。
  - 不新增二进制 fixture 文件，全部运行时构造（沿用仓库惯例）。
- [ ] 5. **Rust 测试：扩展名与默认文件名** — owner: Tester；paths: `src-tauri/tests/service_cover_tests.rs`
  - 覆盖 spec S3：`cover_extension_for` 的 jpeg→`jpg`、png→`png`、webp 等表内命中、未知 mime + 未知字节 → `"jpg"`、`Some("application/octet-stream")` → `"jpg"`。
  - `default_cover_file_name`：带扩展名音频 → `告白气球.jpg`（`mime = Some("image/png")` 时为 `告白气球.png`）；无 stem 边界 → 兜底名。
  - 复用本文件既有 `png_of_size` / `jpeg_of_size` / `webp_of_size` helper，不新增。
- [ ] 6. **契约四处同步（文档 + 守卫）** — owner: Dev；paths: `src-tauri/src/lib.rs`, `docs/design/design.md`, `docs/V1-PRD.md`, `openspec/config.yaml`, `src/styles/command-contract.test.ts`
  - `lib.rs`：`generate_handler!` 追加 `commands::cover::pick_cover_save_path,` 与 `commands::cover::export_cover,`（14 → **16**），顶部注释同步加两行。
  - `docs/design/design.md` §10.3 表追加**两行**：`pick_cover_save_path(song_path)` 与 `export_cover(song_path, dest_path)`（**签名与 `lib.rs` 逐字一致**）；§6.1 基础组件表追加「右键浮层菜单（`.cover-menu`）」一行。
  - `docs/V1-PRD.md` §7「Tauri command 全量」补两个新 command（格式须匹配守卫正则 `` ([a-z_]+)\( ``）；§5.3 封面细节补一条只读导出说明。
  - `openspec/config.yaml` 第 25 行 slash 清单加两个名字，并把「实际注册的 14 个 command 一致」改为 16。
  - `src/styles/command-contract.test.ts`：4 处硬编码计数（96、97、105、106 行）14 → 16；`:4` 与 `:39` 注释里的 14 改 16。**无参 command 集合断言体不变**——两个新 command 都有参，无参仍是 `pick_folder` / `pick_cover_file` / `get_last_dir`。
  - **不改** `sigSource` 数组（已含 `cover.rs`）、**不改** design §10.1 组件树、**不往** design §10.4 落位表加行。
  - 判据：`npx vitest run src/styles/command-contract.test.ts` 全绿。
- [ ] 7. **前端 api 层** — owner: Dev；paths: `src/api/songs.ts`
  - 追加 `pickCoverSavePath(songPath: string): Promise<string | null>`，形如 `invokeCommand<string | null>('pick_cover_save_path', { songPath })`，附一行 JSDoc。
  - 追加 `exportCover(songPath: string, destPath: string): Promise<void>`，形如 `invokeCommand<void>('export_cover', { songPath, destPath })`，附一行 JSDoc。
  - 与既有 `pickCoverFile` / `readCoverPath` 同风格：**不写 try/catch**，错误交组件处理；`pickCoverSavePath` 的 `null` 语义在 JSDoc 里写明「取消 = null」。
  - **不改** `src/api/client.ts`（唯一 invoke 出口，不得新增站点）。
- [ ] 8. **前端浮层菜单（CoverPanel）** — owner: Dev；paths: `src/components/CoverPanel.vue`
  - 状态：`menuOpen` / `menuX` / `menuY` / `exporting`，均在组件内，**不入 store**。
  - DOM：浮层挂在 `.cover` 下、与 `.cover-box` **兄弟**（`.cover-box` 有 `overflow: hidden`，挂在其内必被裁剪）；`position: fixed` + 内联 `left/top` 取自 `contextmenu` 事件的 `clientX/clientY`；**不使用 Teleport**、**不使用 `getBoundingClientRect`**。
  - 贴边翻转：用 `window.innerWidth/innerHeight` 纯数值判断后回夹，不依赖 `getComputedStyle`（happy-dom 不计算 CSS）。
  - 触发：`.cover-box` 上 `@contextmenu.prevent="onContextMenu"`（阻止 WebView 默认菜单）。
  - 菜单结构：`role="menu"` + 单个 `role="menuitem"` 按钮「导出封面…」；无内嵌封面（`!songStore.current?.cover`）→ `disabled`。
  - 关闭出口四条：点外部（`@click` 在浮层外的 document 监听）/ Esc（`keydown`，`onMounted` 加、`onUnmounted` 移除）/ 点菜单项后 / 切歌（`watch(() => songStore.current?.path)` 复位，与既有 `candidatesCollapsed` 复位同一 watch 内追加）。
  - 执行：`const dest = await pickCoverSavePath(song.path)`；`dest === null` → 直接 `return`（**不调 `export_cover`**，无任何副作用）；否则 `await exportCover(song.path, dest)`。失败写 `errorHint`（复用既有 `ref('')` 与 `.cover-error role="alert"`），成功不弹提示、封面与 dirty 不变。`exporting` 覆盖两次 IPC 全程防连点。
  - 样式：仅用 `theme.css` 既有 token（`--panel`、`--border`、`--text`、`--text-dim`、`--hover`、`--shadow`、**6px 圆角**、120ms 过渡，见 design.md §4.5 表）；置灰态**不仅靠颜色**（原生 `disabled` + `--text-dim` + `cursor: not-allowed`）。
  - `z-index` 取 **40**（design.md §4.5 已裁决：`SwitchDialog` 50 / `EulaDialog` 60 必须盖住菜单——切歌确认弹窗出现时浮层必须被遮住），并在注释里写明「祖先链不得加常态 `transform`/`filter`/`contain`，否则 fixed 坐标系失效」。
- [ ] 9. **前端测试** — owner: Tester；paths: `src/components/cover-panel.test.ts`, `src/api/songs.test.ts`
  - 沿用文件既有 `vi.mock('@tauri-apps/api/core')` 与 `mockInvoke` 模式。
  - **`src/api/songs.test.ts`（design.md §4.6 要求，勿漏）**：追加两条透传断言 —— `pickCoverSavePath` → `('pick_cover_save_path', { songPath })`；`exportCover` → `('export_cover', { songPath, destPath })`。
  - S1：`trigger('contextmenu', { clientX, clientY })` → `.cover-menu` 存在、菜单项 `disabled === false`、内联 `left/top` 反映事件坐标。
  - S4（取消，**前端可自动**）：`mockInvoke` 对 `pick_cover_save_path` 返 `null` → 断言 `export_cover` **未被调用**、`errorHint` 为空、`dirty` 不变。
  - S7：`current.cover = null` → 菜单项 `disabled === true`；`trigger('click')` 后 `mockInvoke` **未被调用**。
  - S6：`mockInvoke.mockRejectedValue('导出封面失败: …')`（分别对两个 command 各一条）→ `.cover-error` 可见且含中文原因，`dirty` 不变。
  - S8：开菜单 → 改 `songStore.current.path` → `await nextTick` → `.cover-menu` 不存在；再次右键时 `disabled` 随新歌封面变化。
  - 关闭交互：点外部与 Esc 各一条用例（`document` 事件 + `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`）。
  - 只读断言：导出调用前后 `songStore.current` / `original` 快照相同、`dirty === false`。
  - 定位断言只依赖**内联 style 字符串**与纯数值翻转逻辑，**不依赖任何 `getComputedStyle`**。
- [ ] 10. **验证门禁** — owner: 主会话；paths: `openspec/changes/export-embedded-cover/tasks.md`
  - 依序运行：`cargo check --manifest-path src-tauri/Cargo.toml` → `cargo test --manifest-path src-tauri/Cargo.toml` → `npm run test` → `npm run build` → `npx openspec validate export-embedded-cover --strict --no-interactive`。
  - 回归重点：`src-tauri/tests/open_song.rs`（FLAC/MP3/APE/WAV/M4A 取图不变）、`src/components/layering.test.ts`、`src/styles/design-layering.test.ts`、`src/styles/protocol-content.test.ts` 全绿且无需改动。
  - 人工验收（无法自动化，CR/Verify 不得声称自动化通过）：rfd 存盘框真机取消无副作用、默认文件名与扩展名推断在真机对话框中的呈现、浮层贴边翻转与圆角观感、`z-index: 40` 被切歌确认弹窗正确盖住。
  - 若 fixture 早检失败、实现跨出上述 `paths`、或出现新的规格冲突，停止扩展并回报主会话。
