# Design: 封面右键导出内嵌封面原图到磁盘

GitHub Issue: #124　　规格：`specs/cover-embed/spec.md`（ADDED，8 scenario）+ `specs/command-contract-sync/spec.md`（MODIFIED，3 scenario）

## 1. 范围与结论

本变更属于 **`both` 域**，顺序固定为 **Rust → Vue**：Rust 侧先落地 `pick_cover_save_path` / `export_cover` 两个 command 与字节导出 service，Vue 侧再接 `api/songs.ts` 封装与 `CoverPanel.vue` 右键浮层菜单。产品行为未扩范围——只增加一个**只读导出入口**，不改标签写入、不改表单状态、不碰歌词/搜索/批量、不引入 Tauri 原生菜单。

导出内容是**标签内嵌图片的原始字节**（lofty `Picture::data()`），不是前端 ≤2048 压缩预览图。前端跨 IPC **不传图片字节**，只传源路径与目标路径，图片字节在 Rust 侧内侧出侧写（spec requirement 明文约束）。

> ### 0. 已裁决：`dest_path` 参数去留 → 采用方案 Y（拆两个 command）
>
> Architect 交回主会话的开放点，**主会话已于 2026-10-02 与用户确认采用方案 Y**，本 design 按 Y 落笔：
>
> | 方案 | 签名 | 新增 command | 裁决 |
> |---|---|---|---|
> | X | `export_cover(song_path: String) -> Result<(), String>`（读图 → 弹框 → 写盘一次 IPC 闭环） | 1（→15） | 否决：与已批准 spec delta 与 Issue #124 明文「前端跨 IPC 只传源路径与目标路径」冲突，需改已批准措辞 |
> | **Y（本 design 采用）** | `pick_cover_save_path(song_path: String) -> Option<String>` + `export_cover(song_path: String, dest_path: String) -> Result<(), String>` | 2（→16） | **采纳**：字面保住 spec delta 与 Issue 的两参签名；`export_cover` 成为无 UI 副作用的纯只读写盘函数，字节一致性与只读性可在 Rust 集成测试中直接断言 |
> | Z | `export_cover(song_path, dest_path)`，`dest_path` 仅作对话框起始目录/文件名提示（前端传空串） | 1（→15） | 否决：`dest_path` 变成工件未定义的新语义（提示而非目标） |
>
> 原先 proposal 初稿同时要求「两参签名」与「rfd `save_file` 对话框在 Rust 侧」——对话框返回前 `dest_path` 尚不存在，两句不能并存。方案 Y 通过把「弹框取路径」与「写盘」分到两个 command 化解：`dest_path` 是 `pick_cover_save_path` 的**返回值**，在前端第二次 IPC 才作为实参传入。
>
> **代价与承担方**：command 由 14 增至 **16**，守卫 `command-contract.test.ts` 的 4 处硬编码计数与 `openspec/config.yaml` 同步改为 16（均在 `command-contract-sync` delta 覆盖范围内）；标签读两次（选默认文件名一次、写盘一次）——两次都是 `Probe::open().read()`，与既有同步 `open_song` 同量级，且第二次发生在用户确认路径之后。
>
> **工件同步**：`proposal.md` What Changes 与 Impact、`specs/command-contract-sync/spec.md` 三处契约表点名、`specs/cover-embed/spec.md` requirement 段与「取消」「失败」两个 scenario、`tasks.md` 任务 3/6/7/9 已按 Y 更新。

## 2. 领域判定与落位顺序

| 层 | 落位 | 说明 |
|---|---|---|
| `both` | Rust 先、Vue 后 | Rust command 未注册前，前端测试无法通过契约守卫；且「导出字节与标签内图片一致」是本变更的核心断言，必须先用 Rust 测试钉住 |

Rust 侧分层落位（design.md §10.0「薄 command 壳 → 纯业务 service」）：

- `commands/cover.rs` —— 新增 `pick_cover_save_path` 与 `export_cover` 两个薄壳（`#[tauri::command]` + 参数接收 + 委托）。
- `service/reader.rs` —— 抽出 `pub fn first_embedded_picture`（导出与 `read_song_meta` 共用同一 APE 回退），并把现有私有 `read_ape_cover` 提为 `pub`，**不改动既有读取语义**。
- `service/cover.rs` —— 新增 `export_cover_bytes`（只读开标签取原图字节 + mime）、`cover_extension_for`（mime/字节 → 扩展名）、`default_cover_file_name`（音频文件名 + 扩展名 → 默认名）、`write_cover_to`（写盘 + 错误文案）。
- `lib.rs` —— `generate_handler!` 注册 `commands::cover::pick_cover_save_path` 与 `commands::cover::export_cover`。

前端侧分层落位（design.md §10.0 `components → store → api`）：

- `api/songs.ts` —— 新增 `pickCoverSavePath(songPath)` 与 `exportCover(songPath, destPath)` 两个封装（一行 JSDoc + `invokeCommand` 透传）。
- `components/CoverPanel.vue` —— 右键浮层菜单（**组件局部状态**，不进 store：导出不改变任何 store 字段）。
- `api/client.ts` —— **零改动**（`import { invoke } from '@tauri-apps/api/core'` 是硬依赖，vi.mock 依赖该 import 源）。

## 3. Rust 设计

### 3.1 command 签名与线程模型

按 §0 方案 Y：

```rust
// src-tauri/src/commands/cover.rs（两个薄壳）
#[tauri::command]
pub fn pick_cover_save_path(song_path: String) -> Result<Option<String>, String>

#[tauri::command]
pub fn export_cover(song_path: String, dest_path: String) -> Result<(), String>
```

- **同步还是 async**：`pick_cover_save_path` 需要打开原生存盘对话框，`pick_cover_file` / `pick_folder` 已是**同步 command**（注释明确「macOS 对话框须主线程」）。若把对话框放进 `spawn_blocking`，worker 线程不是 macOS 主线程，`rfd` 的 `NSSavePanel` 在非主线程构造会崩或行为异常。因此**不套 `spawn_blocking`**，保持同步形态，与 `pick_cover_file` 完全同构。
- **`export_cover` 同样同步**：它要 `Probe::open().read()` 读整个文件，与既有同步 `open_song` 同量级。**两个 command 都同步**——前端顺序 `await` 调用，无需 `async` + `spawn_blocking`（与 `scan_missing` 不同——那个扫目录可能上千文件才需要让出线程）。
- **取消语义**：`pick_cover_save_path` 返 `Ok(None)`（**不是** `Err`）——取消是用户的正常选择而非错误，交给前端静默终止流程。这与 `pick_folder` / `pick_cover_file` 的 `Option` 返法一致。
- **只有 `pick_cover_save_path` 需要读标签**（为了算默认文件名与扩展名）；`export_cover` 也读一次，两次都是同一份 `first_embedded_picture` 语义。
- 参数形态与 `rename_song` 一致：`String` 入参，command 内 `Path::new(&x)` 转换；前端传 `{ songPath }` 与 `{ songPath, destPath }`（Tauri 自动 snake_case ↔ camelCase）。

### 3.2 取图逻辑：必须复用 reader 的 APE 回退

`service/reader.rs:139-147` 是封面读侧唯一出口，其取图语义为：

```rust
tag.and_then(|t| t.pictures().first().cloned())          // primary tag 第一个 picture
   .or_else(|| path.extension().eq_ignore_ascii_case("ape")
                 .then(|| read_ape_cover(path))         // APE 原生 "Cover Art (Front)" binary item
                 .flatten())
```

**关键坑**：lofty 0.24 的通用 `Tag` 转换路径不映射 APE 图片，APE 的内嵌封面只能经 `read_ape_cover`（`ApeFile` 专用 API + 去掉 APEv2 binary item 的头部分隔符及其描述串）取到。若 `export_cover` 自行写一份 `tag.pictures().first()`，**APE 文件会取不到图 → 误报「无内嵌封面」**，这是静默的功能回退。

因此设计为：**提取公共取图函数 `reader::first_embedded_picture(path, tag)`**，`read_song_meta` 与导出 service 走同一条路径，保证「界面上看得到的封面」与「导出的字节」判定完全一致（spec「导出字节与标签内图片一致」）。

- `read_ape_cover` 由私有 `fn` 提为 `pub fn`（模块内可见性提升，逻辑零改动；跨 crate 测试需要时再考虑 `pub`——见 §7 验证矩阵）。
- `read_song_meta` 内的 `.map(encode_cover)` 编排改为调用同一个 helper，**行为等价回归**：既有 `open_song` 测试（FLAC/MP3/APE/WAV/M4A）必须全绿，作为「提取不改变读取语义」的证据。

### 3.3 mime → 默认扩展名映射与未知兜底

spec 场景「默认文件名基于音频文件名」明确：`jpeg → .jpg`、`png → .png`，**未知 mime 兜底 `.jpg`**。

```rust
// service/cover.rs（纯逻辑，便于单测）
pub fn cover_extension_for(mime: Option<&str>, bytes: &[u8]) -> &'static str {
    // 1) mime 判定：优先 Picture::mime_type()，空则 image::guess_format(bytes)
    // 2) 映射：Jpeg→"jpg"、Png→"png"、Gif→"gif"、WebP→"webp"、Bmp→"bmp"、Tiff→"tiff"
    // 3) 未知 / 无 mime / 探测失败 → "jpg"
}
```

- mime 取值优先级**与 `encode_cover`（`service/cover.rs:18-38`）保持一致**：先 `picture.mime_type()`，空则 `image::guess_format(bytes)`。二者都拿不到时（`encode_cover` 会退 `application/octet-stream` 且 `mime = None`），扩展名按 spec 兜底 `.jpg`。
- 映射用 `image::ImageFormat::from_mime_type(mime)` 归一（image 0.25.10 已核实支持 `image/jpeg`→`Jpeg`、`image/png`→`Png`、`image/webp`→`WebP` 等；**该函数只接受标准小写 MIME**），再按 `ImageFormat` 分支给扩展名；未覆盖的格式与探测失败统一 `"jpg"`。
- `image` crate 在本仓库**没有** `extension_str()` 辅助（已核实 0.25.10 源码，只有 `from_mime_type`），所以扩展名表必须**手写** `ImageFormat → &'static str`，不能假设存在该 API。
- 纯逻辑、零 IO → 直接可单测（`src-tauri/tests/service_cover_tests.rs` 追加用例）。

### 3.4 写盘方式：为什么不用 tempfile + persist

**结论：直接 `std::fs::write(dest_path, &bytes)`，不走 tempfile + persist。**

取舍理由：

1. **目标不是既有文件**。`tempfile + persist` 的价值在于「同目录临时文件 → rename 原子替换」，避免**覆盖已有文件**时中途失败留下半截文件（`fs_atomic.rs:14-20` 与 `lyrics.rs:28-30` 的注释都指向这个动机）。导出场景下 `dest_path` 是用户在 `save_file` 对话框里选定的新路径；即便用户在对话框里确认了覆盖一个已存在的文件，那也是**用户显式授权的覆盖**。
2. **`tempfile::persist` 覆盖目标已存在会失败**。`NamedTempFile::persist` 在 POSIX 上用 `rename(2)`，`rename` 覆盖同名目标虽成功，但 `persist` 内部走的是「确保目标不存在」语义（本仓库 `lyrics.rs` 的 `.lrc` 场景目标必然已存在却能用，说明平台差异存在，行为不确定）。为「可能覆盖」的情况引入 tempfile 反而引入不确定性。
3. **保持错误语义简单**：`fs::write` 失败（父目录不存在、路径不可写、目标是个目录）直接返回 `Err(中文原因)`，符合 spec「导出失败如实报错」；不会像 tempfile 那样需要区分「persist 失败」与「目标已存在」两类文案。
4. **不承担数据保护责任**。产品约束是「直接写盘、无备份、无撤销」，导出的是新文件，不改原音频（原音频零触碰，见 §3.5）。

若主会话/CR 认为必须保护「覆盖已有目标文件」的原子性，那是**范围外**的产品决策（涉及「导出撞名拒绝覆盖」与否，spec 未定义），应在 CR 阶段提出，不在实现里自行发明。

### 3.5 只读性保证

导出是只读动作，Rust 侧的保证点：

- 只调用 `Probe::open(...).read()`（**只读打开**）与 `pictures()` / `read_ape_cover`（`File::open` 只读），**绝不**调用 `Tag::save_to` / `fs_atomic::write_atomic` / `writer::save_song`。
- 唯一的写操作是 `fs::write(dest_path, ...)`，`dest_path` 来自用户对话框；若用户把目标路径选成音频自身，那是用户显式行为，不在 spec 约束内（spec 只要求「原歌曲标签不被本动作改写」——`export_cover` 物理上不碰源文件，除了用户自己选它当目标）。
- 前端不碰 store（见 §4.3），`dirty` 与 `save_song` 路径完全不受影响。

### 3.6 存盘对话框：位置与形态

按 §0 方案 Y，对话框在 **`pick_cover_save_path`** 内，`export_cover` 是不含任何 UI 的纯写盘函数。

- **位置**：`commands/cover.rs` 的 `pick_cover_save_path` 内，与 `pick_cover_file`（同文件、同为 rfd 对话框）对称。`commands/` 允许 rfd（既有 `pick_folder` / `pick_cover_file` 都在这一层），符合 §10.0「command 薄壳：参数接收 + 对 service 委托」，rfd 对话框属「参数获取」而非业务逻辑。
- **形态**：
  ```rust
  // pick_cover_save_path 内部
  let (bytes, mime) = cover::export_cover_bytes(&song)?;      // 无内嵌封面 → Err（前置失败，不弹框）
  let default_name = cover::default_cover_file_name(&song, mime.as_deref(), &bytes);
  let dest = rfd::FileDialog::new()
      .set_title("导出封面")
      .set_file_name(&default_name)      // 音频文件名去扩展名 + 推断扩展名
      .set_directory(parent_dir)         // 源音频所在目录（与 pick_folder 的 set_directory 先例一致）
      .add_filter(ext, &[ext])           // 按实际推断出的扩展名过滤
      .save_file();
  Ok(dest.map(|p| p.to_string_lossy().into_owned()))   // None = 取消
  ```
  rfd 0.17.2 的 `set_title` / `set_file_name` / `set_directory` / `add_filter` / `save_file` 均已核实存在（`src/file_dialog.rs:51/63/77/172`）。
- **`export_cover` 内**（无 UI）：
  ```rust
  pub fn export_cover(song_path: String, dest_path: String) -> Result<(), String> {
      let (bytes, _) = service::cover::export_cover_bytes(Path::new(&song_path))?;
      service::cover::write_cover_to(Path::new(&dest_path), &bytes)
  }
  ```
  **不重算扩展名、不再弹框、不校验 `dest_path` 扩展名**——用户在对话框里可以改名改扩展名，那是用户的决定（与「撞名拒绝覆盖」等产品约束一致：导出是用户显式授权的写新文件）。
- **默认文件名生成在 service 层**：command 需要「默认文件名」这个值，但它依赖读出的图片 mime，属于业务判定 → 由 `service::cover` 提供 `default_cover_file_name(audio_path, mime, bytes) -> String`（实现即 `file_stem` 去扩展名 + `"."` + `cover_extension_for(mime, bytes)`），command 只做拼装。
- **默认目录**：用源音频所在目录，符合「整理封面时取回原图」的自用场景（大概率存回音乐库附近）。这是**便利性默认**，用户可在对话框里改。

### 3.7 错误文案（中文，遵循仓库既有惯例）

仓库**无自定义 error 类型、无 thiserror/anyhow**，统一 `Result<T, String>`；业务拒绝用纯中文短语，技术细节用 `format!("动作失败: {e}")`。

| 场景 | 文案 |
|---|---|
| 读标签失败（坏标签） | `读取标签失败: {e}`（与 `reader.rs:95` 逐字一致） |
| 无内嵌封面 | `该歌曲没有内嵌封面`（纯中文业务拒绝；前端此时应已置灰菜单项，Rust 侧仍需兜底——菜单置灰依赖前端 `current.cover`，而磁盘真值以 Rust 为准） |
| 写盘失败 | `导出封面失败: {e}`（IO 技术原因附后；与 `lyrics.rs` 的 `写入临时文件失败: {e}` 同形） |
| 默认名构造失败（无父目录） | 退化为纯文件名 `封面.jpg`（不阻断） |

**不假报成功**：只有 `fs::write` 返回 `Ok` 才 `Ok(())`；用户取消对话框时 `pick_cover_save_path` 返回 `Ok(None)`（取消不是错误，spec「取消对话框无副作用」），前端据此**不调用** `export_cover`。

## 4. 前端设计

### 4.1 浮层挂载位置：解决 `.cover-box { overflow: hidden }` 裁剪

**问题**：`CoverPanel.vue:233` 的 `.cover-box` 有 `overflow: hidden`，会裁掉任何溢出其边界盒的子元素。若浮层作为 `.cover-box` 的子节点渲染（哪怕 `position: absolute`），菜单会被裁成只剩封面框内的部分。

**方案（三条同时满足）**：

1. **挂载点在 `.cover-box` 之外**。模板结构改为：`.cover-box` 保持不变（`has-cover` / `cover-empty` 两分支互斥、共用 `ref="coverEl"`），**浮层作为 `.cover`（面板根，200px 宽、无 overflow）的兄弟子节点**放在 `.cover` 内、`.cover-box` 之后。`.cover` 无 `overflow`，`.cover-box.has-cover` 的 `position: relative` 也**不再被用作浮层定位基准**（见下条）。
2. **`position: fixed` + 事件坐标计算**，不用 `absolute`：
   - 用 `fixed` 而非 `absolute` 的理由：`fixed` 的包含块是视口，**不受任何祖先 `overflow` 裁剪**（除非祖先有 `transform`/`filter`/`contain`——已核实 `App.vue` / `Editor.vue` / `FieldGrid.vue` / `EditorBar.vue` / `CoverPanel.vue` 的祖先链上**只有按钮 `:active` 的 `translateY(1px)`，无常态 `transform`**，故 `fixed` 安全）。
   - 定位值直接取自 **右键事件坐标**：`onContextMenu(e)` 里记下 `menuPos = { x: e.clientX, y: e.clientY }`（CSS px，与 `fixed` 同坐标系；**不需要 dpr 缩放**——这点与拖拽命中的 `PhysicalPosition` 不同，是有意区分）。浮层 `style="{ left: menuPos.x + 'px', top: menuPos.y + 'px' }"`。
   - 右下溢出兜底：菜单宽约 140px，若 `e.clientX + MENU_W > window.innerWidth`（或 `clientY + MENU_H > innerHeight`）则改用 `x - MENU_W` / `y - MENU_H`（菜单向左/上展开），保证贴边时不被视口裁掉。happy-dom 不算布局，**该兜底走纯数值判断**，可测。
   - 为什么不用「锚定封面框 + absolute」：`absolute` 在 `.cover-box` 内被 `overflow: hidden` 裁（已排除挂载在 box 内的方案），挂到 `.cover` 上再 absolute 就得用 `getBoundingClientRect()` 反算容器偏移，代码更绕且依赖布局；直接用事件坐标 + `fixed` 更短、更可测。
3. **不引入 Portal/Teleport**。`vue` 的 `<Teleport to="body">` 技术上可行，但会脱离组件作用域样式（scoped CSS 需要额外处理）、增加 vitest 挂载复杂度（`wrapper.find` 需 `attachTo` + `document.body` 查询），对单菜单项场景属过度设计。放 `.cover` 兄弟位已足够。

### 4.2 DOM 结构与状态

```html
<!-- .cover 根内，.cover-box 之后：两个封面分支之外 -->
<div v-if="menuOpen" class="cover-menu" :style="{ left: menuLeft + 'px', top: menuTop + 'px' }"
     role="menu" aria-label="封面操作">
  <button class="cover-menu-item" type="button" role="menuitem"
          :disabled="!hasCover" @click="onExport">
    导出封面…
  </button>
</div>
```

- **状态**（组件局部 `ref`，不进 store）：`menuOpen: boolean`、`menuX/menuY: number`（或合并为 `menuPos`）、`exporting: boolean`。
- **`hasCover = computed(() => cover.value !== null)`** —— 与模板 `v-if="cover"` 同一数据源（`songStore.current?.cover`）。
- **置灰**：`:disabled="!hasCover"`（原生 `disabled`，兼得「不可点击」与键盘不可聚焦；样式用 `:disabled` 规则给 40% 透明 + `cursor: not-allowed`，与 `.search-trigger:disabled` 同款——**design.md §8「状态不只靠颜色」**靠原生 disabled 语义 + 文字本身表达，不额外加图标）。置灰时点它**不触发任何 IPC**（`@click` 处理器内 `if (!hasCover.value) return` 双重保险，对齐仓库既有「组件守卫 + store 守卫」双保险惯例）。
- **readonly（坏标签只读）**：封面区整块已禁用（`onClickPick` / 拖拽都有 readonly 守卫）。菜单仍可打开（spec 只规定「无内嵌封面置灰」，未规定 readonly 下不许开菜单），但导出项与点击选择一样视为禁用——readonly 时必然 `current === null`（store `open()` 失败路径把 current/original 置 null），故 `hasCover` 天然为 false、**自动置灰，无需额外分支**。
- **导出项文案**：`导出封面…`（用单字符 `…` 与仓库既有 `搜索中…` 一致）。

### 4.3 关闭交互（四个出口）

| 出口 | 实现 |
|---|---|
| 点菜单项 | `onExport` 内第一行 `menuOpen.value = false`（**先关后 await**，避免原生对话框开着时浮层还挂在上面） |
| Esc | `onMounted` 挂 `window.addEventListener('keydown', onKeydown)`、`onBeforeUnmount` 移除（**SwitchDialog.vue:22-30 完全同款**）。`keydown` 里 `if (e.key === 'Escape' && menuOpen.value) menuOpen.value = false` |
| 点击外部 | `onMounted` 挂 `window.addEventListener('click', ...)`（`{ capture: true }` 或普通冒泡均可，菜单项 `@click` 用 `.stop` 或靠「先关」的顺序避免抢跑）；`if (menuOpen.value && !menuInside(e.target)) menuOpen.value = false` |
| **切歌** | 复用既有 `watch(() => songStore.current?.path, ...)`（`CoverPanel.vue:38-43`，现只重置 `candidatesCollapsed`）——**在同一 watch 回调里追加 `menuOpen.value = false`**，一行改动，spec「切歌后菜单不残留」直接满足 |

补充：
- 右键本身要 `@contextmenu.prevent`（阻止 WebView 默认菜单），否则 macOS 原生右键菜单会与浮层并存。**这是 `@contextmenu` 在本仓库的首次使用**（全仓零先例），已核实无冲突。
- **左键点击封面框不弹菜单**：`onClickPick` 行为零改动（`@click` 照旧选图），右键才开菜单。浮层的 `@click.stop` / `contextmenu.prevent` 只作用在菜单自身。
- 菜单关闭不重置 `exporting`；`exporting` 只防连点（一次导出期间禁用该项），导出结束（无论成败）恢复。

### 4.4 导出执行与错误提示落位

```ts
async function onExport(): Promise<void> {
  menuOpen.value = false
  const song = songStore.current
  if (song === null || !hasCover.value || exporting.value) return
  errorHint.value = ''
  exporting.value = true
  try {
    const dest = await pickCoverSavePath(song.path)   // rfd 存盘框；None = 用户取消
    if (dest === null) return                          // 取消：不调 export_cover，无任何副作用
    await exportCover(song.path, dest)                 // 纯只读写盘
  } catch (e) {
    errorHint.value = String(e)                        // 复用既有 errorHint（.cover-error，role="alert"）
  } finally {
    exporting.value = false
  }
}
```

- **错误提示落位：复用组件既有 `errorHint` ref**（`CoverPanel.vue:56`）与其 `.cover-error` 渲染（`:176`，已带 `role="alert"`）。不新增错误 UI，与「工具线克制、不弹窗」的既有取向一致（`CoverPanel.vue:11` 注释）。spec「封面区显示明确的中文错误原因」由此满足。
- **store 零改动**：不调 `setCover` / `clearCover` / `save`，`dirty` 与表单内容天然不变（spec「导出为只读动作」）。
- **两次 IPC 的分工**（见 §3.6）：`pick_cover_save_path` 只弹框取路径（含读标签算默认文件名），`export_cover` 只取图写盘。取消语义落在前端中间态——`dest === null` 即 `return`，`finally` 仍复位 `exporting`。
- **`exporting` 覆盖两次 IPC 全程**：从弹框前到写盘后都处于 `exporting === true`，期间菜单项禁用，防连点产生多个对话框。

### 4.5 a11y 与样式 token

**a11y（design.md §8 + §7）**：

- `role="menu"` + `aria-label="封面操作"`；项 `role="menuitem"`。
- 菜单项是**原生 `<button>`** → 自带 Tab 可达、`Enter`/`Space` 激活、`:focus-visible` 琥珀描边（`theme.css:119-122` 全局已有）。
- 打开菜单后 `nextTick` 聚焦菜单项（SwitchDialog `onMounted` 聚焦取消按钮同款），Esc 关闭后焦点自然回到触发元素（浏览器默认行为）。
- 「置灰」用原生 `disabled`（语义即「不可用」，读屏可读），文案本身表意，不只靠颜色（design.md §8）。
- 不用 `aria-modal` —— 这是非模态浮层，不阻断主界面交互（与 `SwitchDialog` / `EulaDialog` 的全窗口模态不同）。

**样式 token（design.md §4 + `src/styles/theme.css`）**：

| 属性 | 值 | 依据 |
|---|---|---|
| 背景 / 描边 / 文字 | `var(--panel)` / `1px solid var(--border)` / `var(--text)` | 与 `SwitchDialog.dialog` 同源 |
| 圆角 | `6px` | design.md §4「按钮 6px」——浮层菜单是控件族，不算「弹窗」（12px）也非「输入框/列表」（8px）；6px 与 `.cand-cell` / `.btn` 一致 |
| 阴影 | `var(--shadow)` | design.md §4「阴影仅弹窗使用」——浮层菜单是脱离文档流的准弹层，是全仓**除 SwitchDialog/EulaDialog 外第三处**用 `--shadow`；若 CR 认为该规则只覆盖全窗口模态，则降级为 `1px solid var(--border)` 无阴影（见 §7 风险） |
| padding / 字号 | `8px 12px` / `12px` | 与 `.btn` 字号一致（正文 13px 的下一档，≥11.5px 最小目标字号） |
| hover | `background: var(--hover)` | 同 `.btn-ghost:hover` |
| 过渡 | `transition: background 0.12s` | design.md §4 统一 120ms |
| z-index | `40` | 低于 `SwitchDialog`(50) 与 `EulaDialog`(60) —— 切歌确认弹窗出现时菜单必须被盖住 |

无 Tailwind，全部 scoped CSS 内联在 `CoverPanel.vue`。

### 4.6 前端测试落点

- `src/api/songs.test.ts` 追加两条透传断言：`('pick_cover_save_path', { songPath })` 与 `('export_cover', { songPath, destPath })`。
- `src/components/cover-panel.test.ts` 追加 `describe('CoverPanel — 封面右键导出（export-embedded-cover）')`：菜单开合、置灰、Esc、点外部、切歌重置、导出调用与失败提示。**happy-dom 不算 CSS**（`getBoundingClientRect` 全 0、`position: fixed` 无从计算）→ 定位值断言走**内联 style 字符串**（`left/top` 来自事件坐标，与布局无关），无需 rect 桩；贴边翻转走纯数值判断（需 stub `window.innerWidth/innerHeight`）。
- `src/components/layering.test.ts` —— 无需改动（组件仍零 invoke 直呼，经 `api/songs.ts`）。

## 5. 契约同步清单（新增 command 必须同步的四处 + 守卫硬编码）

`command-contract.test.ts` 以 `lib.rs` 的 `generate_handler!` 为真值，比对 **三处文档契约清单**；另有四处**硬编码计数 14** 与一处注释。按方案 Y 新增 **2** 个 command，计数 14 → **16**。全部必须同批改，否则守卫红。

| # | 位置 | 现有内容锚点 | 需改为 |
|---|---|---|---|
| 1 | `src-tauri/src/lib.rs:24-39` | `generate_handler![...]` 注册 14 个 | 追加 `commands::cover::pick_cover_save_path,` 与 `commands::cover::export_cover,`（并在顶部注释加两行说明） |
| 2 | `docs/design/design.md` §10.3 表 | `\| read_cover_path(path) \| ...` 行 | 追加**两行**：<br>`\| pick_cover_save_path(song_path) \| String → Result<Option<String>, String> \| 弹 rfd 存盘框取导出目标路径，默认文件名 = 音频文件名去扩展名 + 按图片 mime 推断的扩展名；取消 → Ok(None) \|`<br>`\| export_cover(song_path, dest_path) \| (String, String) → Result<(), String> \| 把标签内第一个 front cover 的**原始字节**写到 dest_path（`std::fs::write`，无 UI）；只读、不改标签/表单 \|` |
| 3 | `docs/V1-PRD.md` §7「Tauri command 全量」 | 「- 封面：`pick_cover_file()` ... `read_cover_path(path)` ...」条目 | 在同一条目内补 `pick_cover_save_path(song_path) -> Result<Option<String>, String>` 与 `export_cover(song_path, dest_path) -> Result<(), String>`。**格式必须与守卫正则 `\`([a-z_]+)\(` 匹配** |
| 4 | `openspec/config.yaml:25` | `Tauri command 契约（前端全走 invoke）：pick_folder/list_songs/.../scan_missing。... 与 lib.rs 实际注册的 14 个 command 一致。` | 清单加两个名字；**「14 个」字样改「16 个」**（守卫额外检查「不再自述与 lib.rs 一致而实际不一致」——即这句数量声明本身也会被读） |
| 5 | `src/styles/command-contract.test.ts:95-98` | `expect(libCommands).toHaveLength(14)` + `expect(new Set(libCommands).size).toBe(14)` | 两处改 `16` |
| 6 | `src/styles/command-contract.test.ts:104-107` | `toHaveLength(14)` / `.toBe(14)`（三源各恰为 14） | 两处改 `16` |
| 7 | `src/styles/command-contract.test.ts:4` + `:39` | 注释「实际注册的 14 个 command」/「14 个 command 中无参者恰为 …」 | 改为 16；**`:39` 的无参集合需重新核对**：`pick_cover_save_path(song_path)` 与 `export_cover(song_path, dest_path)` **都有参**，无参仍是 `pick_folder` / `pick_cover_file` / `get_last_dir` 三者，断言体**无需改**，但注释里的数字要改 |
| 8 | `src-tauri/tests/commands_cover_tests.rs` | 覆盖 `read_cover_path` 三个用例 | 追加 service 委托层用例（见 §7 矩阵）——注意 **rfd 存盘框无法在测试里自动确认**，`pick_cover_save_path` 的弹框分支不可自动化测试（见 §7 人工项）；`export_cover` 的纯写盘路径**可以**直接测 |

> `command-contract.test.ts:41-43` 的 `sigSource` 数组含 `'cover.rs'`，新 command 定义在同文件，**签名提取无需改动**。
> `docs/design/design.md` §10.4 的 `subchange 落位记录` 表是「历史归档参照」（`:399` 明示不再有「未来/后续」含义）→ **本变更不往该表加行**。

## 6. 文档同步（design.md / PRD 正文）

| 文档 | 改什么 | 依据 |
|---|---|---|
| `docs/design/design.md` §10.3 | command 契约表加**两行**（见上表 #2） | 强制：`command-contract.test.ts` 扫 |
| `docs/design/design.md` §6 | **组件清单加「浮层菜单」条目**：§6.1 基础组件表新增一行「右键浮层菜单（`.cover-menu`）」，状态列写「封面区右键弹出；单菜单项「导出封面…」；无内嵌封面 → 项置灰；`role="menu"`，Esc / 点外部 / 点菜单项 / 切歌均关闭」。**不新建 §6.x 章节**（该章是「组件清单与状态」的表格化枚举，一行足够，与 §6.2–§6.6 的多状态组件不同量级） | 浮层菜单是本变更新增的唯一 UI 构件，§6 是组件清单的权威落位 |
| `docs/design/design.md` §4 | **不改**（阴影/圆角/动效规则本身不变，本变更只是遵守它们） | — |
| `docs/design/design.md` §10.1 组件树 | **不改**（浮层是 `CoverPanel` 内部实现，不是新组件文件） | 保持「不新建平级组件」的最小面 |
| `docs/V1-PRD.md` §7 | command 全量加两个新 command（见上表 #3） | 强制：守卫扫描 |
| `docs/V1-PRD.md` §5.3 封面细节 | 加一条只读导出说明：「**导出内嵌封面原图**：封面预览图右键可「导出封面…」，经存盘对话框写出标签内第一个 front cover 的**原始字节**（非 ≤2048 压缩预览图）；纯只读，不改标签/表单；无内嵌封面时菜单项置灰；取消对话框不做任何事」 | 产品行为权威；§5.3 是封面行为落位 |
| `docs/V1-PRD.md` FR-3 表 | **不改**：FR-3 是「可编辑字段与表单结构」表，导出不是字段也不是表单能力；加进去会与 FR-3.7「字段无特例」语义混淆 | 保守不改，避免范围外扩 |
| `docs/V1-PRD.md` §8 验收标准 | **不改**（V1 Done 定义的既有条目不因新增只读动作而重开） | — |
| `openspec/config.yaml` | 见上表 #4（强制：守卫扫描） | — |

## 7. 验证计划（8 scenario → 可验证矩阵）

**fixture 早检（硬要求）**：任何业务断言前，先确认 fixture 存在且可被目标 reader 解析。沿用归档 change `fix-wav-riff-info-tags` 的早检先例（其 design.md 明确「所有新 fixture 在业务测试开始前通过 `Probe::open(...).read()`」）。

| # | spec scenario | 覆盖层 | 落点文件 | 判据 |
|---|---|---|---|---|
| S1 | 右键打开导出菜单，项可点击 | 前端 vitest | `src/components/cover-panel.test.ts` | `trigger('contextmenu', { clientX, clientY })` → `.cover-menu` 存在、`.cover-menu-item` `disabled === false`；同时断言 `@contextmenu.prevent` 已阻止默认 |
| S2 | **导出字节与标签内图片一致** | **Rust 集成测试（核心）** | 新建 `src-tauri/tests/export_cover.rs` | fixture（FLAC + APE 各一，cover bytes = `common::tiny_png_bytes()`）；导出后 `std::fs::read(dest)` **逐字节等于** fixture 内嵌 bytes（**不是** ≤2048 压缩图——用 >2048 的大图 fixture 才能区分，见下） |
| S2a | （APE 专项，隐含于 S2） | Rust | 同上 | APE fixture 走 `add_ape_tags_with_picture`（原生 `Cover Art (Front)`）→ 导出字节与内嵌 bytes 一致，**证明 `read_ape_cover` 回退在导出路径生效** |
| S2b | （非压缩证明） | Rust | 同上 | 构造一张 >2048 的 fixture 图（如 2100×2100）内嵌 → 导出文件 `image::guess_format` + 尺寸断言仍为 2100（未被 `compress_cover` 压过），锁住「原始字节非压缩预览图」 |
| S3 | 默认文件名 = 音频文件名去扩展名 + 推断扩展名（jpeg→.jpg / png→.png / 未知→.jpg） | **Rust 单测（纯逻辑）** | `src-tauri/tests/service_cover_tests.rs` | 直接测 `cover_extension_for`：`Some("image/jpeg")→"jpg"`、`Some("image/png")→"png"`、`None` + 非图片 bytes → `"jpg"`、`Some("application/octet-stream")` → `"jpg"`；再测 `default_cover_file_name("/a/告白气球.mp3", …) == "告白气球.jpg"` |
| S4 | 取消对话框无副作用 | 前端 vitest（可覆盖一半）+ 人工 | `cover-panel.test.ts` | **前端可自动**：`mockInvoke` 对 `pick_cover_save_path` 返 `null` → 断言 `export_cover` **未被调用**、`errorHint` 为空、dirty 不变。**人工半项**：rfd `save_file()` 在无头测试里无法自动点「取消」，故 Rust 侧 `Ok(None)` 分支只靠代码逻辑 + `pick_cover_file` 的 `None` 处理先例背书；手动验收 = `npm run tauri dev` 导出后点取消 → 检查标签/封面/表单/dirty 全不变 |
| S5 | 导出为只读动作 | Rust + 前端双侧 | `src-tauri/tests/export_cover.rs` + `src/components/cover-panel.test.ts` | Rust：导出前后**源音频字节完全相同**（`fs::read(song)` 前后 `assert_eq!`）+ mtime 语义不被改（只断言字节一致，mtime 只作为人工项）；前端：调用导出后 `songStore.dirty === false`（前后 `current`/`original` 快照未变） |
| S6 | 导出失败如实报错（路径不可写/父目录不存在） | 前端 vitest + Rust 单测 | `cover-panel.test.ts` + `service_cover_tests.rs` | 前端：`pick_cover_save_path` 返 `'导出封面失败: …'`（坏标签）或 `export_cover` 抛 `'导出封面失败: …'` → `.cover-error` 可见、含中文原因、封面与 `dirty` 不变（**不假报成功**）；Rust：单测 `write_cover_to(path)` 对不可写父目录返回 `Err` 且文案含「导出封面失败」 |
| S7 | 无内嵌封面时菜单项置灰、不弹对话框 | 前端 vitest | `cover-panel.test.ts` | `current.cover = null` → 右键出菜单、`.cover-menu-item` `disabled === true`；`trigger('click')` 后 `mockInvoke` **未被调用** |
| S8 | 切歌后菜单不残留 | 前端 vitest | `cover-panel.test.ts` | 打开菜单 → 改 `songStore.current.path` → `await nextTick` → `.cover-menu` 不存在；再右键 → 菜单项 `disabled` 状态与新歌封面一致 |
| 契约 | 3 个 command-contract scenario | 前端守卫 | `src/styles/command-contract.test.ts` | 四源（lib.rs / design §10.3 / PRD §7 / config.yaml）一致 + 计数 16 |
| 回归 | `reader` 取图提取不改变既有语义 | Rust | `src-tauri/tests/open_song.rs`（既有，不改） | FLAC/MP3/APE/WAV/M4A 读取全绿（**只跑不改**） |
| 回归 | 分层守卫 | 前端 | `src/components/layering.test.ts`、`src/styles/design-layering.test.ts`、`src/styles/protocol-content.test.ts` | 全绿，**无需改动** |

**fixture 早检的具体做法**（写进 Tester 任务的判据）：`export_cover.rs` 的第一个测试只做「构造 + 读回」——写 fixture → `Probe::open().read()` 成功 → `first_embedded_picture` 返回 `Some` 且其 `data()` 与构造 bytes 一致。**早检不过就不许写后续业务断言**（先修 fixture，不许把断言改松）。fixture 复用 `common::tiny_png_bytes()` / `add_tags` / `add_ape_tags_with_picture`，**不新增二进制 fixture 文件**（沿用仓库「全部运行时构造」惯例）。>2048 大图 fixture 用 `image` crate 运行时生成（`common/mod.rs` 已有 `png_of_size` 类先例见归档 change 描述，实际当前 `common` 只有 `tiny_png_bytes`；若需大图，**在 `export_cover.rs` 测试文件内本地生成**，不进 `common`，避免无谓扩大 fixture 公共面）。

**验证顺序**（由主会话执行）：

```sh
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml --test export_cover --test service_cover_tests --test open_song
cargo test --manifest-path src-tauri/Cargo.toml
npm run test
npm run build
npx openspec validate export-embedded-cover --strict --no-interactive
```

**只能人工/TDD 的项**：S4（rfd 取消）、S5 的 mtime 半句、S1 的 `@contextmenu.prevent` 真实拦截效果、浮层视觉（圆角/阴影/贴边翻转的真机观感）。这些在 CR/Verify 阶段以「代码逻辑 + 手动验收清单」覆盖，不得声称自动化通过。

## 8. 风险与取舍

| 风险 | 处置 |
|---|---|
| **`dest_path` 签名不自洽**（§0） | **已裁决**：采用方案 Y，拆 `pick_cover_save_path` + `export_cover` 两个 command，已批准工件（proposal / 两份 delta spec / 本 design / tasks.md）全部同步。残留风险仅为「标签读两次」的轻微冗余，无功能影响 |
| **`export_cover` 二次读标签可能与首次不一致** | 用户在存盘框停留期间若外部改了标签，导出的是**确认时刻**的文件内容。这是只读导出的可接受语义（用户看到的是自己选的目标路径），且比「先取字节再弹框、把字节暂存内存」更简单。**不做**快照缓存（无收益、反增状态） |
| **浮层被裁剪 / 定位错位** | `.cover-box` 的 `overflow: hidden` 是硬约束 → 浮层挂 `.cover` 兄弟位 + `position: fixed` + 事件坐标；祖先链无常态 `transform`（已核实）故 `fixed` 安全。**若未来给祖先加 `transform`/`filter`/`contain`，fixed 会退化为局部坐标系，需重评**——在组件注释里写明这条依赖 |
| **`--shadow` 适用范围**（design.md §4 写「仅弹窗使用」） | 浮层菜单按「准弹层」处理并使用 `--shadow`。若 CR 判定越界，降级为无阴影 + 1px 描边（视觉可接受，不影响任何 scenario），**不改 spec** |
| **APE 导出回退**（最大功能风险） | 静默失败点：自行 `pictures().first()` 会让 APE 全部取不到图。已用「与 `read_song_meta` 共用 `first_embedded_picture`」消解，并以 APE 专项测试（S2a）锁定 |
| `read_ape_cover` 可见性提升 | 私有 `fn` → `pub fn` 是可见性放宽，非行为改动；`read_song_meta` 全格式回归测试为证据。若需要跨 crate 测试它，则再提 `pub`（同 `MAX_DIM` 先例，`service/cover.rs:82`）——**优先让 `first_embedded_picture` 承担测试入口，避免无谓扩面** |
| 覆盖已有目标文件不做原子保护 | 见 §3.4 取舍；若被判定需「撞名拒绝覆盖」，那是 spec 未定义的新产品行为，须升级主会话，**实现阶段不得自行发明** |
| 对话框阻塞主线程 | `pick_cover_save_path` 与 `pick_cover_file` / `pick_folder` 同一既有模式，`export_cover` 与 `open_song` 同量级，可接受。**不得**为「优化」套 `spawn_blocking`（会破 macOS 主线程约束） |
| 首次引入 `@contextmenu` | 全仓零先例；已加 `.prevent` 阻止 WebView 默认菜单。需回归既有左键选图与拖拽嵌入互不干扰（S1 测试同时断言 click 路径仍工作） |
| happy-dom 不算 CSS | 定位断言只依赖**内联 style 字符串**（来自事件坐标）与**纯数值贴边判断**，不依赖任何 `getComputedStyle`；沿用 `cover-panel.test.ts` 既有「显式 stub rect」与 `ui-editor-layout.test.ts`「扫源码守卫 CSS」两条先例 |
| 范围外诱惑 | 远程候选封面导出（=下载）、批量导出、其他面板复用右键菜单、Tauri 原生菜单 —— proposal 已明列不在范围，实现阶段遇到一律回报主会话 |