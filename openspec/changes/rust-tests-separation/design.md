## Context

Rust 生产/测试混搅：13 个生产文件内嵌约 2234 行 `#[cfg(test)]` 单测。既有 `v1-refactor-layering`（已归档）定稿了目录分层（command 薄壳/service/model），但当时约定「Rust 纯逻辑单测内联」——本次升级为「一律外置」，生产代码零 `#[cfg(test)]`。

## Goals / Non-Goals

**Goals:**
- `src/` 生产代码零 `#[cfg(test)]`，单测全部外置 `src-tauri/tests/`。
- 共用测试工具 `mock_http_once` 迁 `tests/common/`。
- 被测私有项提 `pub(crate)`（可见性最小化，不泄漏公开 API）。
- 零行为变更，`cargo test` 全绿。
- §10.4 规范升级 + 守卫同步。

**Non-Goals:**
- 不改业务逻辑、不改 command 契约、不改前端。
- 不做功能新增/重构（纯搬运）。
- 不引入新测试框架/断言库。

## Decisions

### 1. 拆分形态：tests/ 独立 crate

`tests/` 目录是独立 crate，只能访问 `app_lib::` 下 `pub` 项（`lib.rs` 已 `pub mod commands/model/service`）。拆出的测试文件：

```rust
// src-tauri/tests/model_tests.rs
use app_lib::model::{...};  // 被测 pub(crate) 项
```

原内嵌测试的 `use super::*;` 替换为具体 `use app_lib::<module>::<item>;`；测试专用私有 helper（如 `cand()`、fake source 实现）复制进测试文件（测试专用，不属生产代码）。

### 2. 私有项提 pub(crate)

仅「被测试引用」的私有函数/类型提 `pub(crate)`（如 `searcher/mod.rs` 的 `search_song_with_sources`、`search_source_with`、`download_cover_with_timeout`、`aggregate`、`to_halfwidth`、`title_match`、`artist_match`、`source_rank`）。不做全量提权。

> 注意：`cfg(test)` 移除后，某些仅测试使用的函数在生产编译下无调用者 → `dead_code` 警告。处理：`#[allow(dead_code)]` 标注（clippy `-D warnings` 时需处理）。

### 3. test_util 迁移

`searcher/mod.rs` 的 `#[cfg(test)] pub(crate) mod test_util { pub fn mock_http_once }` 迁到 `tests/common/mod.rs`（`pub fn mock_http_once`），生产代码删除该模块。各源测试 `use crate::common::mock_http_once;`。

### 4. 拆分顺序（每模块独立保绿提交）

`commands/cover` → `model` → `service/cover` → `service/{lyrics,meta,rename}` → `searcher/{crypto,itunes,kugou,lrclib,netease,qqmusic}` → `searcher/mod`（最大 614 行 + test_util 迁移收尾）。每拆一个 `cargo test` 保绿。

### 5. §10.4 规范升级

`docs/design/design.md:367`：

```markdown
- **Rust 单测（纯逻辑）**：一律外置 `src-tauri/tests/`（与集成测试同目录），`src/` 生产代码**零 `#[cfg(test)]`**；共用测试工具收 `tests/common/`。
```

结构守卫 `design-layering.test.ts` 若断言旧「内联」文案，同步更新。

## Risks

- `pub(crate)` 提权后 `dead_code` 警告（无生产调用者）——`#[allow(dead_code)]` 或接受。
- 拆分量大（2234 行），需按模块分步、每步 `cargo test` 保绿，避免一次性大炸。
- `searcher/mod.rs` 测试大量用 `MusicSource` trait（pub）与 fake 源——fake 实现复制进测试文件，trait 用 `use app_lib::service::searcher::MusicSource;`。
