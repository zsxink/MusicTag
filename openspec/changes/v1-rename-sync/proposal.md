## Why

V1 中「文件名改名」是独立动作，不与保存绑定。改名时需同步关联 `.lrc`（音频 + `.lrc` 一并改），纯扩展名变化不影响 `.lrc` 名；撞名（音频或 `.lrc` 目标已存在）拒绝覆盖并提示。这些规则依赖 `v1-lyrics-lrc` 建立的 `.lrc` 命名约定与 `v1-song-save` 的保存语义。

## What Changes

- 新增 Rust command `rename_song(path, new_name) -> Result<(), String>`：改名音频文件，若存在同名 `.lrc` 一并改名。
- 规则：
  - 纯扩展名变化不触发 `.lrc` 改名（`.lrc` 名 = 去扩展名主干同名）。
  - 目标文件名已存在（音频或 `.lrc`）→ **拒绝覆盖并提示**（不静默覆盖，禁止 `std::fs::rename` 的 POSIX 覆盖行为），用户改名字后重试。
  - 改名失败（目标已存在/权限）返回 Err，前端提示。
- 前端：文件名可编辑字段独立于标签保存，改名字后保存时先改名再写标签；撞名时保存先弹提示「目标已存在」，标签仍写回原路径，重命名被拒绝直到换名。

## Capabilities

### New Capabilities
- `rename-sync`: 音频 + `.lrc` 一并改名 + 纯扩展名变化不影响 `.lrc` + 撞名拒绝覆盖

### Modified Capabilities
（无）

## Impact

- 复用 `v1-lyrics-lrc` 的 `.lrc` 命名约定（去扩展名同名同目录）。
- `rename_song` 是独立 command，与 `save_song` 解耦（保存写回原路径，改名是独立动作）。
- 撞名检测在 Rust 侧做（禁止 POSIX 覆盖），前端只负责提示与重试引导。
