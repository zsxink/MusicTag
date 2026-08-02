## Context

`v1-lyrics-lrc` 建立了 `.lrc` 命名约定（音频去扩展名同名同目录），`v1-song-save` 定义了保存语义。本变更实现改名独立动作及 `.lrc` 同步。

## Goals / Non-Goals

**Goals:**
- `rename_song(path, new_name) -> Result<(), String>`：改名 + `.lrc` 同步。
- 撞名拒绝覆盖（音频或 `.lrc`）。
- 纯扩展名变化不触发 `.lrc` 改名。

**Non-Goals:**
- 不把改名并入保存（改名是独立动作，FR-5.5）。
- 不做批量改名。

## Decisions

- **改名原子性**：先检测目标存在性（音频 `new_path` 与 `new_lrc_path` 均不存在才继续），再 `std::fs::rename`。**禁止** `std::fs::rename` 覆盖已存在文件的行为（FR-4.7：POSIX 覆盖被禁止）——先 `Path::exists()` 检查，存在则返回 Err「目标已存在」。
- **`.lrc` 同步**：若 `old_lrc = with_extension("lrc")` 存在，且新主干与旧主干不同 → 一并 rename。**纯扩展名变化**：`new_name` 与旧名去扩展名主干相同 → `.lrc` 不 rename（FR-4.6a）。
- **前端流程**：文件名是独立字段。改名字后保存：先调 `rename_song`（撞名 Err → 顶栏「目标已存在」提示，标签仍写回原路径），成功后才 `save_song` 写新路径标签。切歌/换目录重置文件名改动。
- **重命名后路径更新**：store 的 current.path / 列表项 path 同步为新路径，后续保存写新路径。

## Risks / Trade-offs

- 改名与保存的时序：先改名再保存，若改名成功但保存失败 → 文件已改名但标签未写。V1 接受此语义（改错认栽），提示用户重试保存即可。
- 撞名检测的竞态：单用户工具线场景，`exists()` 检查足够；不引入文件锁。
