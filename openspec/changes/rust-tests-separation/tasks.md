# 任务（变更域 backend，纯重构零行为变更；分组依赖序 G0→G7，串行实施）

> 通用拆分手法（每模块）：grep 定位测试引用的私有项 → 提 `pub`（**实施修正**：原 `pub(crate)` 经实测 E0603 不可行——集成测试 crate 仅能访问 `pub` 项，见 design.md D2「实施修正」）→ 新建 `src-tauri/tests/<name>_tests.rs`（顶部 `mod common;` + `use app_lib::<module>::<item>;` 替换 `use super::*`，测试私有 helper 复制进文件）→ 删除生产文件 `#[cfg(test)]` 块 → `cargo test --manifest-path src-tauri/Cargo.toml` 保绿 → 提交。
> 详细可见性契约 / 提权清单 / 迁移形态见 design.md「技术方案」。

## G0 测试工具迁移（无前置）

- [x] 0.1 `src-tauri/tests/common/mod.rs`：追加 `pub fn mock_http_once(response: Vec<u8>) -> String`（从 `searcher/mod.rs` test_util 搬，纯 std TcpListener 实现原样复制；模块顶部已有 `#![allow(dead_code)]`，无需额外标注）
- [x] 0.2 `cargo check --manifest-path src-tauri/Cargo.toml --tests` 保绿（common 尚未被引用）
- [x] 0.3 提交：`refactor(90): tests/common 增加 mock_http_once 共享测试工具`

## G1 commands/cover（依赖 G0）

- [x] 1.1 读 `src-tauri/src/commands/cover.rs`：`read_cover_path`/`pick_cover_file` 已是 `pub fn`，经 `app_lib::commands::cover::*` 直接可用；仅定位并复制测试私有 helper（如 `tiny_png_bytes` 若在测试块内定义）
- [x] 1.2 新建 `src-tauri/tests/commands_cover_tests.rs`（`use app_lib::commands::cover::*`）
- [x] 1.3 删除生产文件内嵌 `#[cfg(test)]` → `cargo test` 保绿 → 提交

## G2 model（依赖 G0）

- [x] 2.1 `src-tauri/src/model.rs`：类型全 `pub`，无提权；仅确认测试无私有项引用
- [x] 2.2 新建 `src-tauri/tests/model_tests.rs`（`use app_lib::model::{...}`，serde 序列化契约断言原样搬）
- [x] 2.3 删除内嵌测试 → `cargo test` 保绿 → 提交

## G3 service/cover（依赖 G0）

- [x] 3.1 `src-tauri/src/service/cover.rs`：`encode_cover`/`decode_cover`/`compress_cover` 等已 `pub`；测试私有 helper（`png_of_size`/`jpeg_of_size`/`webp_of_size`/`dds_of_size`/`tiny_png_bytes`）复制进测试文件
- [x] 3.2 新建 `src-tauri/tests/service_cover_tests.rs`
- [x] 3.3 删除内嵌测试 → 保绿 → 提交

## G4 service/{lyrics,meta,rename}（依赖 G0）

- [x] 4.1 `lyrics.rs`/`meta.rs` 函数已 `pub`，无提权；`rename.rs` 测试直接引用 `is_illegal_name` → 提 `pub`（完成）
- [x] 4.2 新建 `tests/service_lyrics_tests.rs` / `service_meta_tests.rs` / `service_rename_tests.rs`
- [x] 4.3 删除三文件内嵌测试 → 保绿 → 提交

## G5 searcher 各源 {crypto,itunes,kugou,lrclib,netease,qqmusic}（依赖 G0）

- [x] 5.1 六源文件私有项提 `pub`（见 design.md 清单：`crypto.rs` 的 `aes_ecb_encrypt`（`aes_cbc_encrypt` 测试仅经 `weapi` 间接调用，保持私有）；各源 `parse_search_response`/`parse_lyric_response`/`is_error_response`/`signature`/`search_params` 等）；测试内 `use crate::service::searcher::test_util::mock_http_once;` 改为 `mod common;` + `use common::mock_http_once;`
- [x] 5.2 新建 `tests/searcher_{crypto,itunes,kugou,lrclib,netease,qqmusic}_tests.rs`
- [x] 5.3 删除六文件内嵌测试 → `cargo test` 保绿 → 提交

## G6 searcher/mod（依赖 G5，最大 994 行 + test_util 删除收尾）

- [x] 6.1 列全被测私有项（`search_song_with_sources`、`search_source_with`、`download_cover_with_timeout`、`to_halfwidth`、`title_match`、`artist_match`、`source_rank`）→ 提 `pub`（另 `TOP_N`；`aggregate`/`norm` 已 `pub`）；`pub` 项 rustc 不报 dead_code，实测 clippy 零警告，无需 allow
- [x] 6.2 新建 `tests/searcher_mod_tests.rs`：`use super::*` 展开为具体 `use app_lib::service::searcher::{...}`；`MusicSource` trait 用 `use app_lib::service::searcher::MusicSource;`（已是 `pub trait`）；fake 源/cand helper 复制进文件；`mod common;` + `use common::mock_http_once;`
- [x] 6.3 删除生产文件 `test_util`（含 `json_string` 已是 `pub(crate)`，保留不动）+ 整个 `#[cfg(test)] mod tests` → `cargo test` 保绿 → 提交

## G7 全量确认 + 规范入文档 + 守卫同步（依赖 G1-G6）

- [x] 7.1 `grep -rn "#\[cfg(test)\]" src-tauri/src/` 无命中；`grep -rn "test_util\|mock_http_once" src-tauri/src/` 无命中
- [x] 7.2 全量：`cargo test --manifest-path src-tauri/Cargo.toml && cargo clippy --manifest-path src-tauri/Cargo.toml && npm run test && npm run build` 全绿
- [x] 7.3 `docs/design/design.md` §10.4 升级为「一律外置 tests/，src/ 零 #[cfg(test)]，共用工具收 tests/common/」
- [x] 7.4 `src/styles/design-layering.test.ts` 守卫同步：第 33–37 行断言 `/inline|内联/` 在 §10.4 改写后**必然失败**——把测试标题「文件 I/O 集成测试外置 + 纯逻辑单测 inline」改为「Rust 测试一律外置 tests/」，断言 `/inline|内联/` 改为新文案（如 `/外置/`）；`npx vitest run src/styles/design-layering.test.ts` 保绿
- [x] 7.5 提交：`refactor(90): Rust 生产/测试彻底分离——13 文件内嵌单测拆到 tests/ + §10.4 升级 + 守卫同步`（分支 rust-tests-separation，PR Closes #90）
