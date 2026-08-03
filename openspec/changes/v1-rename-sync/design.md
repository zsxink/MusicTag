## Context

`v1-lyrics-lrc` 建立了 `.lrc` 命名约定（`service::lyrics::sidecar_lrc_path`：同目录、去扩展名主干同名），`v1-song-save` 定义了保存语义（写回原路径、全量覆盖、原子写、保存状态机）。本变更实现「文件名改名独立动作」+ `.lrc` 同步（FR-4.6 / 4.6a / 4.7、FR-5.5 / 5.6），前端把文件名从只读展示改为可编辑字段，保存时先改名再写标签。

## Goals / Non-Goals

**Goals:**
- `rename_song(path, new_name) -> Result<(), String>`：改名音频 + 存在同名 `.lrc` 一并改名。
- 撞名拒绝覆盖：音频或 `.lrc` 目标已存在 → Err「目标已存在」，不执行 rename（禁止 `std::fs::rename` 的 POSIX 覆盖，FR-4.7 / FR-5.6）。
- 纯扩展名变化（新旧主干相同）不触发 `.lrc` 改名（FR-4.6a）。
- 前端：文件名可编辑；保存联动「先改名 → 再写标签」；改名被拒**不影响**标签保存（标签仍写回原路径）。

**Non-Goals:**
- 不把改名并入标签保存的字段语义（改名是独立动作，FR-5.5）。
- 不做批量改名（V2）。
- 不做文件名扩展名强校验（V1 接受任意输入；无扩展名改名后保存会格式报错上抛，改错认栽，见 Risks）。

## 技术方案

### 1. Rust：`service/rename.rs` + `commands/song.rs` 薄壳

按 design.md §10.0/10.4「薄 command 壳 → 纯业务 service」落位：

- `commands/song.rs` 加 `#[tauri::command] pub fn rename_song(path: String, new_name: String) -> Result<(), String>`（与 `save_song` 同文件，song 级文件操作）；`lib.rs` `generate_handler![...]` 注册。
- 业务进新 `service/rename.rs`（`service/mod.rs` 声明 `pub mod rename;`）；`.lrc` 路径**复用** `service::lyrics::sidecar_lrc_path`（命名约定单一来源，避免两处漂移）。

**算法（`rename_song(old_path, new_name)`）：**

1. 解析：`dir = old_path.parent()`、`new_path = dir.join(new_name)`；`old_stem = old_path.file_stem()`、`new_stem = new_path.file_stem()`。
2. `new_name` 防御校验：含 `/`、`\` 或 `..` → Err「文件名不合法」（防改名逃逸当前目录；纯安全护栏，非产品需求）。
3. **撞名预检（原子性核心，FR-4.7）**：在**第一次 `fs::rename` 之前**一次性完成——
   - `new_path` 已存在（`Path::exists()`）→ Err「目标已存在」；
   - 若旧 `.lrc` 存在（`is_file()`）且 `old_stem != new_stem`，则目标 `new_lrc = dir.join(new_stem + ".lrc")` 已存在 → Err「目标已存在」。
   - 预检全部通过才动手 → 撞名（最常见失败）场景零部分状态。
4. **改名顺序：`.lrc` 先、音频后（D2 失败自愈）**：需要移动的 `.lrc` 先 `fs::rename(old_lrc, new_lrc)`，再 `fs::rename(old_path, new_path)`。任一失败 → 返回中文 Err，原文件保持原样可重试。
5. **纯扩展名变化**（`old_stem == new_stem`，FR-4.6a）：仅 rename 音频；`.lrc` 不移动、不参与撞名预检。

### 2. 前端：文件名可编辑 + 改名-保存联动

文件名是**独立 UI 状态**，不是 `Song` 字段、不进 `DIRTY_FIELDS`（仿 `exportLrc` 的 D7 模式）：

- `store/song.ts` 新增状态：`pendingRename: string | null`（改后的新文件名；null = 未改）、`renameRejected: boolean`（撞名被拒标记，供行内提示）。动作 `setPendingRename(name)`：写入 pendingRename（空串 → null）并清 `renameRejected`。
- `lib/path.ts` 新增 `replaceFileName(path, newName)`：跨 `/` / `\` 替换路径末段 → 新路径（store 改名成功后用它算新 path，纯函数 + 单测）。
- `api/songs.ts` 新增 `renameSong(path, newName)` → `invokeCommand('rename_song', { path, newName })`（Tauri camelCase↔snake_case 自动映射 `newName → new_name`，同 `save_song` 的 `exportLrc` 模式）。
- `FieldRow.vue` `file` 形态改为可编辑 input：显示值 = `pendingRename ?? fileName(selectedPath)`；`:disabled="songStore.readonly"`；输入即 `setPendingRename`；`renameRejected` 时行内 danger 提示「目标已存在」。
- `EditorBar.vue` 保存按钮门禁扩展：`dirty || exportPending() || renamePending()`（`renamePending = pendingRename !== null`）；保存调用 `save(songStore.exportLrc)` 不变。
- `store.save()` 流程（保存状态机扩展，`save(exportLrc, saveFn, renameFn)` 注入，默认 renameFn = api/songs.renameSong）：

```
save(exportLrc):
  if readonly / current null: return
  saveState = 'saving'
  if renamePending():
    if pendingRename == fileName(current.path): setPendingRename(null)   // 与当前同名 = 无操作
    else:
      try:
        await renameFn(current.path, pendingRename)
        // 成功 → 路径同步：current.path / selectedPath / songs 列表项 path
        //   = replaceFileName(old, pendingRename)；setPendingRename(null)
      catch e:
        renameRejected = true; saveError = String(e)   // 「目标已存在」
        // 不 return：FR-5.6 标签仍写回原路径
  try:
    await saveFn(current, exportLrc)   // current.path = 新路径（改名成功）或原路径（被拒）
    original = {...current}; saveState = 'saved'
    // renameRejected 时行内提示保持「目标已存在」，换名后重存即完成改名
  catch e:
    saveError = String(e); saveState = 'save_failed'   // 内容保留、dirty 保持 true，绝不假报
```

- 重置语义：`open()` / `activateFolder()` / `undo()` 均清 `pendingRename` / `renameRejected`（切歌、换目录、撤销都回到打开时文件名）。

### 3. 测试落位（§10.4）

- Rust 文件 I/O 集成测试：`src-tauri/tests/rename_song.rs`（复用 `tests/common/mod.rs` 的 `write_tagged_flac` / `write_tagged_mp3` + 手工写 `.lrc`），经 `app_lib::service::rename::rename_song` 调用。
- 前端测试：co-located——`src/lib/path.test.ts`（replaceFileName）、`src/store/song.test.ts`（rename-save 流程）、`src/api/songs.test.ts`（参数透传）、`src/components/*.test.ts`（FieldRow 编辑、EditorBar 门禁）。

## 关键决策

- **D1 撞名预检先行（原子性）**：全部 `exists()` 检查在第一次 `fs::rename` 之前完成。撞名是最常见失败路径，必须零部分状态；预检只覆盖存在性，权限等 IO 错误仍可能留中间态（由 D2 自愈）。
- **D2 `.lrc` 先改名、音频后改名（失败自愈）**：若音频 rename 失败而 `.lrc` 已迁 → 前端 path 未更新（仍指向旧音频，文件还在）→ 用户重试时旧 `.lrc` 已不存在 → 命中「无 `.lrc`」分支仅迁音频 → 收敛到一致终态。反向（音频先）失败会让 UI 指向已消失的文件，不可自愈。
- **D3 复用 `sidecar_lrc_path`**：`.lrc` 路径判定唯一来源是 `service/lyrics.rs`（v1-lyrics-lrc 已定）。rename 业务引它，避免两处实现漂移（FR-4.6a 依赖的正是该命名约定）。
- **D4 契约保持 `Result<(), String>`（proposal 定稿）**：新路径由前端 `replaceFileName` 计算，Rust 不返回新路径——守住已批准契约，跨端不重复维护路径算法。
- **D5 `pendingRename` 独立于 `DIRTY_FIELDS`**：改名不是标签内容，单改文件名不脏表单；保存门禁单独放行 `renamePending()`（同 `exportLrc` 的 D7 先例）。
- **D6 撞名被拒 ≠ 保存失败（FR-5.6）**：rename Err 时置 `renameRejected`、标签**仍写回原路径**（改名被拒不影响标签保存）；保存状态按标签写盘结果定，绝不把「改名被拒」报成「保存失败」造成假象。用户换名后重存即完成改名。
- **D7 `new_name` 防御校验**：拒绝路径分隔符与 `..`（防改名逃逸当前目录），纯安全护栏，非产品需求。
- **D8 重置语义跟随 `exportLrc` 先例**：`open` / `activateFolder` / `undo` 都清 `pendingRename` / `renameRejected`，保证「切歌即弃改名草稿」。

## 变更域与依赖顺序

- **变更域：both**（Rust command/service + 前端文件名编辑与保存联动）。
- **依赖顺序：Rust → Vue 串行**（未显式创建 worktree 时禁止并写）：先 `service/rename.rs` + `commands/song.rs` + 集成测试 + `lib.rs` 注册；再前端 api 封装 → store → FieldRow/EditorBar → 测试。
- 依赖前置子变更：`v1-lyrics-lrc`（`.lrc` 命名约定与 `sidecar_lrc_path`）、`v1-song-save`（保存状态机与 FR-5.6 语义）。

## Risks / Trade-offs

- 改名成功但标签保存失败：文件已改名、标签未写新路径。V1 接受（改错认栽），`current` 保留、提示重试，重试即写新路径（current.path 已是新路径）。
- 权限类 IO 错误的中间态：第二个 `rename` 失败（首个已成功）时留部分状态——D2 保证重试自愈。
- 不改扩展名强校验：用户输入无扩展名文件名后保存会因格式无法识别而失败，错误正常上抛提示（V1 不做输入拦截，改错认栽）。
- 竞态：单用户工具线场景，`exists()` 预检足够，不引入文件锁。
