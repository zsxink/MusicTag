# 封面右键导出：保存歌曲内嵌封面原图到磁盘

GitHub Issue: #124

## Why

整理封面时想取回原始高清封面（比如从封面反推歌名、或另存整套图库），目前前端预览图是压缩后的 base64，无法拿到原图；只能去原文件里手动抠出来。缺一个**只读导出**入口。

## What Changes

- 在封面预览图上右键弹出「导出封面…」菜单项，导出该歌曲标签内第一个 front cover 的**原始字节**。
- 新增只读 Tauri command `pick_cover_save_path(song_path) -> Option<String>`：用 rfd `save_file` 弹存盘框，默认文件名取音频文件名去扩展名 + 按图片 mime 推断的扩展名；用户取消返 `None`。
- 新增只读 Tauri command `export_cover(song_path, dest_path) -> Result<(), String>`：Rust 侧重新打开标签 → 取图片字节 → 写盘，原图字节不出 Rust 侧（前端只传源路径与目标路径）。
- 前端顺序：先 `pick_cover_save_path` 取目标路径（`None` 即取消、不做任何事），再 `export_cover` 写盘。
- 前端在 `CoverPanel.vue` 内自绘浮层菜单；无内嵌封面时菜单项置灰。
- 封面导出为**纯只读动作**：不改标签任何字段、不改表单状态、不影响 `save_song` 行为。

## Impact

- Affected specs: `cover-embed`（新增导出要求）、`command-contract-sync`（新增 2 个 command 需同步四处契约表）
- Affected code: `src-tauri/src/commands/cover.rs`、`src-tauri/src/service/cover.rs`、`src-tauri/src/service/reader.rs`、`src-tauri/src/lib.rs`、`src/api/songs.ts`、`src/components/CoverPanel.vue`
- Tests: Rust 导出字节一致性/只读性测试；前端右键菜单交互测试
- Issue: #124

## 已拍板决策（2026-10-02 主会话与用户确认）

Issue 正文「待拍板」四项已定，不再是开放问题：

1. **导出内容 = 标签内嵌原图的原始字节**（lofty `Picture::data()`），不是前端 ≤2048 压缩预览图。
2. **右键菜单 = 前端 DOM 自绘浮层**，不用 Tauri 原生菜单（零后端 UI 依赖、样式受 design.md 约束）。
3. **默认文件名 = 音频文件名去扩展名 + 扩展名**（歌名可能为空，不作文件名来源）。
4. **无内嵌封面 = 菜单项置灰**，不是整个菜单不出现。

## 追加拍板：command 签名（2026-10-02，Architect 交回主会话裁决后与用户确认）

Issue 正文与本文件初稿同时要求「`export_cover(song_path, dest_path)` 两参签名」与「rfd `save_file` 对话框在 Rust 侧」，二者不能共存——对话框返回前 `dest_path` 尚不存在。采用**方案 Y：拆成两个 command**：

- `pick_cover_save_path(song_path) -> Option<String>` —— 只弹框取路径，取消返 `None`，**不写任何文件**。
- `export_cover(song_path, dest_path) -> Result<(), String>` —— 纯只读取图写盘，无 UI 副作用。

这样字面保住已批准 spec delta 的「前端跨 IPC 只传源路径与目标路径」，且 `export_cover` 的字节一致性与只读性可在 Rust 集成测试中直接断言。代价是 command 由 14 增至 16、标签读两次（选默认文件名一次、写盘一次）、守卫计数同步改为 16——均在 `command-contract-sync` delta 覆盖范围内。

## 不在此范围内（V2 / 另开）

- 导出搜索候选封面（远程 URL，属下载行为）。
- 批量导出 / 导出整个文件夹的封面。
- 在其他面板（歌词区、列表行）复用右键菜单。
