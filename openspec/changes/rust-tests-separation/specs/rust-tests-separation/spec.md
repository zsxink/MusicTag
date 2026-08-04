# rust-tests-separation Specification

## Purpose

Rust 生产代码与测试代码彻底分离：`src/` 生产代码零 `#[cfg(test)]`，所有测试（单元 + 集成）落 `src-tauri/tests/`，共用测试工具收 `tests/common/`。纯重构零行为变更。

## ADDED Requirements

### Requirement: src/ 生产代码零内嵌测试

Rust 生产代码 `src-tauri/src/` SHALL 不含任何 `#[cfg(test)]` 模块；所有单元测试外置 `src-tauri/tests/`。

#### Scenario: 无内嵌测试

- **WHEN** 检索 `src-tauri/src/`
- **THEN** 不存在 `#[cfg(test)]` 标记，生产文件仅含生产逻辑

#### Scenario: 单测全量外置

- **WHEN** 运行 `cargo test`
- **THEN** 原 13 个生产文件的内嵌单测（commands/cover、model、service/*、searcher/*）在 `src-tauri/tests/` 下全部存在并全绿

### Requirement: 共用测试工具收 tests/common

各源测试共用的 `mock_http_once`（原 `searcher/mod.rs` 内 `test_util`）SHALL 迁入 `src-tauri/tests/common/mod.rs`。

#### Scenario: 无 test_util 残留

- **WHEN** 检索 `src-tauri/src/`
- **THEN** 不存在 `test_util` / `mock_http_once`

#### Scenario: 测试引用统一

- **WHEN** searcher 测试文件使用 mock HTTP
- **THEN** 经 `use crate::common::mock_http_once;` 引用

### Requirement: 被测私有项提 pub(crate)

从生产文件拆出的单测所引用的私有函数/类型 SHALL 提升为 `pub(crate)`（不暴露为 `pub` 外部 API），保持可见性最小化。

#### Scenario: 可见性最小化

- **WHEN** 审查被提升可见性的生产项
- **THEN** 均为 `pub(crate)`（非 `pub`），仅因 `tests/` 独立 crate 需跨 crate 访问

### Requirement: 零行为变更

本变更 SHALL 是纯重构：业务逻辑、Tauri command 字符串契约、serde 序列化形状、前端均不变。

#### Scenario: 回归全绿

- **WHEN** 重构完成
- **THEN** `cargo test`、`cargo clippy` 全绿，`npm run test`、`npm run build` 不受影响

### Requirement: 规范入定稿文档

`docs/design/design.md §10.4` 测试放置约定 SHALL 从「Rust 纯逻辑单测内联」升级为「一律外置 `src-tauri/tests/`」，并同步结构守卫 `design-layering.test.ts`。

#### Scenario: §10.4 与落地一致

- **WHEN** 后续 Architect 读取 design.md §10.4
- **THEN** 能看到「Rust 所有测试外置 tests/、src/ 零 #[cfg(test)]、共用工具收 tests/common/」约定

#### Scenario: 守卫同步

- **WHEN** 运行 `npm run test`
- **THEN** `design-layering.test.ts` 断言与 §10.4 新文案一致（不因旧「内联」字样失败）
