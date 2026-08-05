# 任务（变更域 backend，纯重构零行为变更；分组依赖序 G0→G7，串行实施）

> 通用拆分手法（每模块）：记下内嵌测试引用的私有项 → 提 `pub(crate)` → 新建 `src-tauri/tests/<name>_tests.rs`（`use super::*` 换 `use app_lib::<module>::<item>;`，测试私有 helper 复制进文件）→ 删除生产文件 `#[cfg(test)]` 块 → `cargo test` 保绿 → 提交。

## G0 测试工具迁移（无前置）

- [ ] 0.1 `src-tauri/tests/common/mod.rs`：追加 `pub fn mock_http_once(response: Vec<u8>) -> String`（从 `searcher/mod.rs` test_util 搬，纯工具）
- [ ] 0.2 `cargo check --manifest-path src-tauri/Cargo.toml --tests` 保绿（common 尚未被引用）
- [ ] 0.3 提交：`refactor(90): tests/common 增加 mock_http_once 共享测试工具`

## G1 commands/cover（依赖 G0）

- [ ] 1.1 读 `src-tauri/src/commands/cover.rs`，定位测试引用私有项 → 提 `pub(crate)`
- [ ] 1.2 新建 `src-tauri/tests/commands_cover_tests.rs`，搬测试（`use app_lib::commands::cover::<被测项>`）
- [ ] 1.3 删除生产文件内嵌 `#[cfg(test)]` → `cargo test` 保绿 → 提交

## G2 model（依赖 G0）

- [ ] 2.1 读 `src-tauri/src/model.rs` → 私有项提 `pub(crate)`
- [ ] 2.2 新建 `src-tauri/tests/model_tests.rs`
- [ ] 2.3 删除内嵌测试 → `cargo test` 保绿 → 提交

## G3 service/cover（依赖 G0）

- [ ] 3.1 读 `src-tauri/src/service/cover.rs` → 私有项提 `pub(crate)`
- [ ] 3.2 新建 `src-tauri/tests/service_cover_tests.rs`
- [ ] 3.3 删除内嵌测试 → 保绿 → 提交

## G4 service/{lyrics,meta,rename}（依赖 G0）

- [ ] 4.1 三文件私有项提 `pub(crate)`
- [ ] 4.2 新建 `tests/service_lyrics_tests.rs` / `service_meta_tests.rs` / `service_rename_tests.rs`
- [ ] 4.3 删除三文件内嵌测试 → 保绿 → 提交

## G5 searcher 各源 {crypto,itunes,kugou,lrclib,netease,qqmusic}（依赖 G0）

- [ ] 5.1 六源文件私有项提 `pub(crate)`；测试内 `mock_http_once` 引用改 `use crate::common::mock_http_once;`
- [ ] 5.2 新建 `tests/searcher_{crypto,itunes,kugou,lrclib,netease,qqmusic}_tests.rs`
- [ ] 5.3 删除六文件内嵌测试 → `cargo test` 保绿 → 提交

## G6 searcher/mod（依赖 G5，最大 614 行 + test_util 删除收尾）

- [ ] 6.1 列全被测私有项（`search_song_with_sources`、`search_source_with`、`download_cover_with_timeout`、`to_halfwidth`、`title_match`、`artist_match`、`aggregate`、`source_rank`）→ 提 `pub(crate)`（仅测试用的加 `#[allow(dead_code)]`）
- [ ] 6.2 新建 `tests/searcher_mod_tests.rs`：`use super::*` 展开为具体 `use app_lib::service::searcher::{...}`；`MusicSource` trait 用 `use app_lib::service::searcher::MusicSource;`；fake 源/cand helper 复制进文件；`use crate::common::mock_http_once;`
- [ ] 6.3 删除生产文件 `test_util` + 整个 `#[cfg(test)] mod tests` → `cargo test` 保绿 → 提交

## G7 全量确认 + 规范入文档（依赖 G1-G6）

- [ ] 7.1 `grep -rn "#\[cfg(test)\]" src-tauri/src/` 无命中；`grep -rn "test_util\|mock_http_once" src-tauri/src/` 无命中
- [ ] 7.2 全量：`cargo test && cargo clippy && npm run test && npm run build` 全绿
- [ ] 7.3 `docs/design/design.md` §10.4 升级为「一律外置 tests/，src/ 零 #[cfg(test)]，共用工具收 tests/common/」
- [ ] 7.4 `npx vitest run src/styles/design-layering.test.ts`：若守卫断言旧「内联」文案 → 更新守卫；保绿
- [ ] 7.5 提交：`refactor(90): Rust 生产/测试彻底分离——13 文件内嵌单测拆到 tests/ + §10.4 升级`（分支 rust-tests-separation，PR Closes #90）
