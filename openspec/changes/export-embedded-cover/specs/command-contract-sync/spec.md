# command-contract-sync Specification Delta

## MODIFIED Requirements

### Requirement: 三处 command 契约表同步为 lib.rs 实际注册

`docs/V1-PRD.md §7`「Tauri command 全量」、记忆 `music-tag-v1-spec.md` command 契约清单、`openspec/config.yaml` context command 清单 SHALL 与 `src-tauri/src/lib.rs` `generate_handler!` 实际注册的 command 集合一致（含 `get_last_dir`/`save_last_dir`/`pick_folder`/`export_cover`）。

#### Scenario: PRD §7 契约表齐全

- **WHEN** 读取 `docs/V1-PRD.md §7`「Tauri command 全量」
- **THEN** 列出全部已注册 command，含 `get_last_dir`、`save_last_dir`、`export_cover`（与 lib.rs 注册一致）

#### Scenario: 记忆 spec 契约清单齐全

- **WHEN** 读取记忆 `music-tag-v1-spec.md` command 契约清单
- **THEN** 列出全部已注册 command，含 `pick_folder`、`get_last_dir`、`save_last_dir`、`export_cover`（与 lib.rs 注册一致）

#### Scenario: openspec/config.yaml context 齐全

- **WHEN** 读取 `openspec/config.yaml` context command 清单
- **THEN** 列出全部已注册 command，含 `get_last_dir`、`save_last_dir`、`export_cover`，且不再自述与 lib.rs「一致」而实际不一致
