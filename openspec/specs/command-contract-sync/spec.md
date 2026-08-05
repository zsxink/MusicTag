# command-contract-sync Specification

## Purpose
TBD - created by archiving change command-contract-sync. Update Purpose after archive.
## Requirements
### Requirement: 三处 command 契约表同步为 lib.rs 实际注册

`docs/V1-PRD.md §7`「Tauri command 全量」、记忆 `music-tag-v1-spec.md` command 契约清单、`openspec/config.yaml` context command 清单 SHALL 与 `src-tauri/src/lib.rs` `generate_handler!` 实际注册的 command 集合一致（含 `get_last_dir`/`save_last_dir`/`pick_folder`）。

#### Scenario: PRD §7 契约表齐全

- **WHEN** 读取 `docs/V1-PRD.md §7`「Tauri command 全量」
- **THEN** 列出全部 13 个 command，含 `get_last_dir`、`save_last_dir`（与 lib.rs 注册一致）

#### Scenario: 记忆 spec 契约清单齐全

- **WHEN** 读取记忆 `music-tag-v1-spec.md` command 契约清单
- **THEN** 列出全部 13 个 command，含 `pick_folder`、`get_last_dir`、`save_last_dir`（与 lib.rs 注册一致）

#### Scenario: openspec/config.yaml context 齐全

- **WHEN** 读取 `openspec/config.yaml` context command 清单
- **THEN** 列出全部 13 个 command，含 `get_last_dir`、`save_last_dir`，且不再自述与 lib.rs「一致」而实际不一致

### Requirement: command 契约一致性守卫

仓库 SHALL 有一个可运行的守卫测试，断言 PRD/design/openspec/config.yaml 各 command 契约清单与 `lib.rs` `generate_handler!` 注册集一致，防三源缺口复发。

#### Scenario: 守卫通过

- **WHEN** 运行守卫测试（npm run test 内）
- **THEN** 四处 command 契约清单与 lib.rs 注册集一致，测试绿

#### Scenario: 守卫捕获缺口

- **WHEN** 任一契约清单缺 command（或 lib.rs 新增 command 未同步）
- **THEN** 守卫测试红，指出缺的 command 名

