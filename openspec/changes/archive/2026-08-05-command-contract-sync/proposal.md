## Why

Epic `v1-ux-polish-layering` 的 GATE 总复核（Issue #92）挂起：`dir-memory`（#91）产物未同步三处 Tauri command 契约表。`src-tauri/src/lib.rs` 实际注册 **13 个 command**，但：

- `docs/V1-PRD.md §7`「Tauri command 全量」仅列 11 个——缺 `get_last_dir`/`save_last_dir`
- 记忆 `music-tag-v1-spec.md` command 清单仅 10 个——缺 `get_last_dir`/`save_last_dir`，另缺 `pick_folder`
- `openspec/config.yaml` context command 清单仅 11 个——缺 `get_last_dir`/`save_last_dir`，且自述「与 lib.rs 实际注册一致」与真值不符

规格四源（PRD/design/openspec/记忆）要求一致，command 契约是跨端 IPC 边界的关键契约。三源缺口使 GATE 维度 1（规格一致性）不通过，Epic Issue #86 保持打开。

## What Changes

- **同步三处 command 契约表**为 lib.rs 实际注册的 13 个 command（含 `get_last_dir`/`save_last_dir`/`pick_folder`）：
  - `docs/V1-PRD.md §7`「Tauri command 全量」补 `get_last_dir`/`save_last_dir`
  - 记忆 `music-tag-v1-spec.md` command 契约清单补 `pick_folder`/`get_last_dir`/`save_last_dir`
  - `openspec/config.yaml` context command 清单补 `get_last_dir`/`save_last_dir`
- **加结构守卫**：新增 vitest 守卫测试，断言各 command 契约清单（PRD/design/openspec/config.yaml 提取的 command 名集合）与 `src-tauri/src/lib.rs` `generate_handler!` 实际注册集合一致——防三源缺口复发。

## Capabilities

### New Capabilities
- `command-contract-sync`: Tauri command 契约表与 lib.rs 实际注册的一致性守卫——PRD/design/openspec/config.yaml 四处契约清单与 `generate_handler!` 注册集逐一比对，缺口即测试红。

### Modified Capabilities
- `command-contract-sync`: `docs/V1-PRD.md §7`、记忆 `music-tag-v1-spec.md`、`openspec/config.yaml` 三处 command 契约表同步为 lib.rs 实际注册的 13 个 command。

## 关联 Issue

GitHub Issue：`#103`（分支提交 `feat(103): ...`、PR `Closes #103`；修复后重跑 GATE #92 复核 → 关闭 Epic #86）

## Impact

- `docs/V1-PRD.md`：§7 command 全量表补 2 行（get_last_dir/save_last_dir）。
- 记忆 `music-tag-v1-spec.md`：command 契约清单补 3 个（pick_folder/get_last_dir/save_last_dir）。
- `openspec/config.yaml`：context command 清单补 2 个（get_last_dir/save_last_dir）。
- 新增守卫测试（前端 vitest，结构断言不触 Tauri 运行时）。
- 无生产代码改动、无 Tauri 契约运行时改动（lib.rs 已正确注册，仅文档同步）。
