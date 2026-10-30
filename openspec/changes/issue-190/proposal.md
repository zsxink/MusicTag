## Why

Issue #190：Linux 下编辑任意标签并保存后，原文件权限从 `-rw-r--r--`（`0644`）变为 `-rw-------`（`0600`），同组和其余用户失去读权限。

根因是保存采用「同目录临时文件 + rename 原子替换」：`tempfile` 创建的临时文件默认权限为 `0600`，替换原路径后原文件权限位随之丢失。`export_lrc` 覆盖已存在 `.lrc` 时使用相同的临时文件 + rename 模式，存在同样缺陷。

GitHub Issue: #190

## What Changes

- 音频标签原子写回在 rename 替换前，把原文件的权限位复制到临时文件；保存成功后原文件权限保持不变（Unix/macOS）。
- 勾选同步写 `.lrc` 且目标 `.lrc` 已存在时，覆盖后保留其原权限位；`.lrc` 不存在时仍按新建文件处理（行为不变）。
- 新增 Unix 权限断言集成测试，覆盖音频保存与 `.lrc` 覆盖两条路径。
- 同步 `docs/V1-PRD.md` 与 `docs/design/design.md` 的保存语义说明。
- 不改变原子写回的其他语义：同卷 rename、写失败原文件零触碰、无备份/无撤销。

## Capabilities

### New Capabilities

（无，仅修改现有能力）

### Modified Capabilities

- `song-save`: 原子写回保存后保留原文件权限位，写失败时原文件内容与权限都不变。
- `lyrics-lrc`: 覆盖已存在的同名 `.lrc` 时保留其原权限位。

## Impact

- `src-tauri/src/service/fs_atomic.rs`：临时文件 persist 前设置原文件权限。
- `src-tauri/src/service/lyrics.rs`：已有 `.lrc` 时同样保留权限。
- `src-tauri/tests/save_song.rs`、`src-tauri/tests/lyrics_lrc.rs`：Unix 权限断言。
- `docs/V1-PRD.md` FR-5、`docs/design/design.md` §9.1。
- 无新增依赖、无前端改动、无 Tauri command 契约变化。
