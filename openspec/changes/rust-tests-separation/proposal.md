## Why

Rust 生产代码与测试代码混搅：13 个生产文件（`src-tauri/src/**`）内嵌约 2234 行 `#[cfg(test)]` 单元测试，与生产逻辑同文件。生产文件难以聚焦业务逻辑、审查噪音大、分层边界模糊。用户明确要求「生产代码和测试代码分开」并「spec 中强调代码规范」。

现状（量化）：`commands/cover.rs`、`model.rs`、`service/cover.rs`、`service/lyrics.rs`、`service/meta.rs`、`service/rename.rs`、`service/searcher/{crypto,itunes,kugou,lrclib,mod,netease,qqmusic}.rs` 共 13 文件内嵌 `#[cfg(test)]`。前端已规范（独立 `*.test.ts`），无需搬。

## What Changes

- **拆出全部内嵌单测**：13 个生产文件的 `#[cfg(test)] mod tests` 全部拆到 `src-tauri/tests/` 独立文件（如 `model_tests.rs`、`searcher_kugou_tests.rs`），`src/` 生产代码**零 `#[cfg(test)]`**。
- **被测私有项提 `pub(crate)`**：`tests/` 是独立 crate，只能访问 `app_lib::` 下 `pub` 项；被测试的私有函数/类型提 `pub(crate)`（crate 内可见，不暴露外部 API）。
- **共用测试工具迁移**：`searcher/mod.rs` 的 `#[cfg(test)] pub(crate) mod test_util`（`mock_http_once`，被 5 源 + mod 测试共用）迁到 `tests/common/mod.rs`（既有 fixture 位置）。
- **零行为变更**：纯搬运 + 可见性提升，不改业务逻辑、不改 command 契约、不改前端。
- **规范入文档**：`design.md §10.4` 测试放置约定从「单测内联」升级为「一律外置 tests/」；结构守卫 `design-layering.test.ts` 同步。

## Capabilities

### New Capabilities
- `rust-tests-separation`: Rust 生产/测试彻底分离——`src/` 生产代码零 `#[cfg(test)]`，所有测试（单元 + 集成）落 `src-tauri/tests/`，共用测试工具收 `tests/common/`。被测私有项提 `pub(crate)`，可见性最小化。

### Modified Capabilities
- `rust-backend-layering`: `design.md §10.4` 测试放置约定从「Rust 纯逻辑单测内联在 service/model 文件内」升级为「一律外置 `src-tauri/tests/`，`src/` 零 `#[cfg(test)]`」。

## 关联 Issue

GitHub Issue：`#90`（分支提交 `refactor(90): ...`、PR `Closes #90`）

## Impact

- `src-tauri/src/`：13 个生产文件删除内嵌测试块；被测私有项提 `pub(crate)`；`searcher/mod.rs` 删除 `test_util`。
- `src-tauri/tests/`：新增约 13 个 `*_tests.rs`（从内嵌拆出）+ `common/mod.rs` 追加 `mock_http_once`。
- `docs/design/design.md`：§10.4 测试放置约定升级。
- `src/styles/design-layering.test.ts`：守卫断言同步（若检查「内联」字样）。
- 前端：零改动。
