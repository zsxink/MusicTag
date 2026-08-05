# rust-tests-separation — 技术设计

## Context

Rust 生产/测试混搅：13 个生产文件内嵌约 2234 行 `#[cfg(test)]` 单测。既有 `v1-refactor-layering`（已归档）定稿了目录分层（command 薄壳/service/model），但当时约定「Rust 纯逻辑单测内联」——本次升级为「一律外置」，生产代码零 `#[cfg(test)]`。

已核实现状（与 proposal 一致）：
- 13 文件带 `#[cfg(test)]`：`commands/cover.rs`、`model.rs`、`service/{cover,lyrics,meta,rename}.rs`、`service/searcher/{crypto,itunes,kugou,lrclib,mod,netease,qqmusic}.rs`（`searcher/mod.rs` 有 2 处：`test_util` 模块 + 单测模块）。
- `src-tauri/tests/` 已有 5 个文件 I/O 集成测试（list_songs/open_song/save_song/rename_song/lyrics_lrc）+ `common/mod.rs` fixture（`tiny_png_bytes`/`add_tags`/`write_tagged_flac`/`write_tagged_mp3`/`full_song`）。

## Goals / Non-Goals

**Goals:**
- `src/` 生产代码零 `#[cfg(test)]`，单测全部外置 `src-tauri/tests/`。
- 共用测试工具 `mock_http_once` 迁 `tests/common/`。
- 被测私有项提 `pub(crate)`（可见性最小化，不泄漏公开 API）。
- 零行为变更，`cargo test` 全绿。
- §10.4 规范升级 + 结构守卫同步。

**Non-Goals:**
- 不改业务逻辑、不改 command 契约、不改前端（唯一触碰前端目录的是守卫测试文案断言同步，非业务代码）。
- 不做功能新增/重构（纯搬运）。
- 不引入新测试框架/断言库。

## 技术方案

### 模块边界与可见性契约

- `src-tauri/src/` 生产 crate（lib 名 `app_lib`，见 Cargo.toml `[lib]`），`lib.rs` 已 `pub mod commands/model/service`（design.md §10.0）。这是测试能访问生产代码的唯一入口。
- `src-tauri/tests/` 下**每个 `*_tests.rs` 是独立测试 crate**，只能经 `app_lib::<module>::<item>` 访问 `pub` 项。
- **实施修正（实测 E0603）**：本稿原拟「被测试引用的私有项提 `pub(crate)`」。实测 rustc 1.96 下**集成测试 crate 无法访问 `pub(crate)` 项**（`error[E0603]: constant/field is private`）——`pub(crate)` 仅对 `app_lib` crate 内部可见，`tests/` 是独立 crate 走 `app_lib::` 路径，必须 `pub`。故实际全部提 `pub`（`crypto.rs::aes_cbc_encrypt` 因测试仅经 `weapi` 间接调用而保持私有；各源结构体测试注入字段也一并提 `pub`）。`pub` 使测试依赖项进入公开 API 面——本变更是既有 `service`/`searcher` 模块整体测试外置，未触 command 契约，泄露面可控；未来若需收紧再拆内部模块，不在本变更范围。
- 每个测试文件顶部按需 `mod common;` 引入共享工具——与既有 5 个集成测试文件（open_song.rs 等）完全一致的惯例。

### 依赖方向 / 数据流

```
tests/*_tests.rs ──use app_lib──▶ commands/*（薄壳，pub fn，直接可用）
                                  service/*（大多已 pub，直接可用）
                                  model.rs（全 pub 类型）
                                  searcher/*（私有 parse/签名 helper 提 pub(crate) 后可用）
                                  tests/common::mock_http_once（共享工具）
```

- **已 `pub` 无需动**：`service/{cover,lyrics,meta}.rs` 全部函数、`model.rs` 全部类型（Song/SongSummary/LyricsSource/MusicSourceId/SongCandidate/SearchResult/CoverInput）、`commands/cover.rs` 的 command fn、`searcher/mod.rs::json_string`（已是 `pub(crate)`）。
- **测试专用 helper 不属生产代码**：`cand()`、fake `MusicSource` 实现、`png_of_size`/`jpeg_of_size`/`webp_of_size` 等一律复制进测试文件，不进 `src/`。

### 私有权提升清单（已核实，逐文件；实施均提 `pub`，见上「实施修正」）

| 文件 | 提 `pub` 项 | 另提 `pub`（测试注入字段/常量） |
|---|---|---|
| `service/cover.rs` | — | `MAX_DIM`（测试断言压缩边界） |
| `service/rename.rs` | `is_illegal_name`（测试直接引用） | — |
| `service/searcher/crypto.rs` | `aes_ecb_encrypt` | —（`aes_cbc_encrypt` 测试仅经 `weapi` 间接调用，保持私有） |
| `service/searcher/mod.rs` | `search_song_with_sources`、`search_source_with`、`download_cover_with_timeout`、`to_halfwidth`、`title_match`、`artist_match`、`source_rank` | `TOP_N` |
| `service/searcher/netease.rs` | `search_payload`、`lyric_payload`、`is_error_response`、`parse_search_response`、`parse_lyric_response` | `CLOUDSEARCH_URL`、`forward_url` |
| `service/searcher/qqmusic.rs` | `is_error_response`、`parse_search_response`、`parse_lyric_response` | `search_url`、`lyric_url_base` |
| `service/searcher/kugou.rs` | `now_millis`、`random_md5_hex`、`signature`、`search_params`、`is_error_response`、`parse_search_response`、`parse_lyric_search`、`parse_lyric_download` | `search_url`、`lyric_search_url`、`lyric_download_url` |
| `service/searcher/itunes.rs` | `parse_search_response` | `search_url` |
| `service/searcher/lrclib.rs` | `parse_search_response`、`parse_lyric_response` | `search_url`、`lyric_url_base` |

> 不做全量提权：仅「被测试直接引用」的私有项提升，其余保持私有。`commands/cover.rs`/`model.rs`/`service/{lyrics,meta}.rs` 函数与类型本就全 `pub`，无提权。

### mock_http_once 落位

- 把 `searcher/mod.rs` 的 `#[cfg(test)] pub(crate) mod test_util { pub fn mock_http_once }`（TcpListener 起本地 HTTP、处理一次请求后关闭，返回 mock URL）整体迁入 `tests/common/mod.rs`，变为 `pub fn mock_http_once(response: Vec<u8>) -> String`。
- `tests/common/mod.rs` 顶部已有 `#![allow(dead_code)]`（第 10 行）——迁移后即便某测试文件未引用也不产生 dead_code 警告，无需额外标注。
- 引用方式与既有 fixture 惯例一致：`mod common;` + `use common::mock_http_once;`（不用 `use crate::common::...`——两者等价，但既有 5 个测试文件统一用前者，保持全库一致）。
- `mock_http_once` 无 `app_lib` 依赖（纯 std TcpListener），迁移不改实现，`#[tokio::test]` 场景下行为不变。

### dead_code 处理（scoped）

- 移除 `#[cfg(test)]` 后，若某提权项在**生产编译下无调用者**（原调用者仅在测试块内）→ rustc `dead_code` 警告。
- 实施修正：因 E0603 改为提 `pub`，`pub` 项是 crate 公开 API，rustc 不再报 dead_code——实测全部 `cargo clippy --tests` 零警告（G7.2 门禁过）。`tests/common/mod.rs` 的 module-level `#![allow(dead_code)]` 已覆盖工具函数。
- G7.2 `cargo clippy` 全绿为门禁；CI 若以 `-D warnings` 跑 clippy 亦全绿。

## 关键技术决策（为什么选它）

### D1. 外置 `tests/` 而非保留内联 + 条件编译
「生产代码零 `#[cfg(test)]`」是已批准需求（用户明确要求分离）。`tests/` 独立 crate 是 Rust 官方的集成测试形态，无需任何配置（Cargo 自动编译），且与既有文件 I/O 集成测试天然同目录，工具/约定合一。代价是跨 crate 可见性（提 `pub` + helper 复制）——这是分离的固有成本。

### D2. `pub(crate)` 而非 `pub`（实施修正：实测不可行，改为 `pub`）
原方案想用 `pub(crate)` 保持最小 API 面。**实测 rustc 1.96 E0603**：集成测试 crate（`tests/`）经 `app_lib::` 路径**无法访问 `pub(crate)` 项**——`pub(crate)` 仅对 `app_lib` crate 内部模块可见，外部测试 crate 不在其内。故「被测试引用」的私有项一律提 `pub`（见上提权清单）。权衡：本变更是既有模块整体测试外置，提 `pub` 的均为 service/searcher 内部实现 helper，不属 command 契约，泄露面可控；未来若需彻底隐藏可再拆内部模块，不在本变更范围。

### D3. 迁移顺序「小到大，searcher/mod 殿后」
`searcher/mod.rs` 最大（994 行，其中测试约 614 行）且带 `test_util`，是唯一同时触碰「提权 + 工具迁移 + fake 源复制」的文件。放最后（G6）先建立 `tests/common`（G0）与各源测试文件（G5）后，它的 `use common::mock_http_once` 已有依赖底座，一次收敛。每步 `cargo test` 保绿，避免 2234 行一次性大炸。

### D4. 守卫同步与 §10.4 同 PR
`design-layering.test.ts` 断言 `/inline|内联/`（§10.4 旧约定），§10.4 改写后该断言必然失败。守卫与文档是「文档-断言」绑定关系，必须同 PR 提交，否则 CI 红。归入 G7 与 Rust 代码一并进 PR。

## 变更域判断

- **纯后端（backend）**：全部改动在 `src-tauri/src/`、`src-tauri/tests/`、`docs/design/design.md`；唯一触碰前端目录的是 `src/styles/design-layering.test.ts` 的结构守卫文案断言同步——这是验证/文档守卫（vitest 结构测试，非 Vue 业务），不属前端开发任务。
- **依赖顺序**：Rust 内部串行（G0→G7）；无外层显式 worktree → 禁止并行。前端**无开发任务**，不存在 Rust→Vue 顺序问题；守卫更新随 G7 与 Rust 代码同 PR 提交。

## Decisions（既有，逐条补「为什么」）

### 1. 拆分形态：tests/ 独立 crate

`tests/` 目录是独立 crate，只能访问 `app_lib::` 下 `pub` 项。拆出的测试文件：

```rust
// src-tauri/tests/searcher_kugou_tests.rs
mod common;
use app_lib::service::searcher::kugou::{Kugou, /* 提 pub(crate) 的 parse_* */};
use common::mock_http_once;
```

原内嵌测试的 `use super::*;` 替换为具体 `use app_lib::<module>::<item>;`；测试专用私有 helper（`cand()`、fake 源、`png_of_size` 等）复制进测试文件。
**为什么**：见 D1——零配置、与既有集成测试同目录、约定合一。

### 2. 私有项提 pub(crate)

仅「被测试引用」的私有函数/类型提 `pub(crate)`，见上文清单。不做全量提权。
**为什么**：见 D2——`pub(crate)` 平衡「测试可达」与「API 不泄漏」。

> 注意：`cfg(test)` 移除后，仅测试使用的函数在生产编译下可能无调用者 → `dead_code`。处理：`#[allow(dead_code)]`（勿提 `pub`）。

### 3. test_util 迁移

`searcher/mod.rs` 的 `#[cfg(test)] pub(crate) mod test_util { pub fn mock_http_once }` 迁到 `tests/common/mod.rs`（`pub fn mock_http_once`），生产代码删除该模块。各源测试 `mod common;` + `use common::mock_http_once;`。
**为什么**：共享工具收 `tests/common/` 与既有 fixture 同处，`#![allow(dead_code)]` 天然覆盖；跨 5 源 + mod 共用只维护一份。

### 4. 拆分顺序（每模块独立保绿提交）

`commands/cover` → `model` → `service/cover` → `service/{lyrics,meta,rename}` → `searcher/{crypto,itunes,kugou,lrclib,netease,qqmusic}` → `searcher/mod`（最大 994 行 + test_util 迁移收尾）。每拆一个 `cargo test` 保绿。
**为什么**：见 D3——最小到最大，工具底座先行，searcher/mod 殿后收敛。

### 5. §10.4 规范升级

`docs/design/design.md` §10.4（当前约 367–369 行）「Rust 纯逻辑单测内联」改为：

```markdown
- **Rust 单测（纯逻辑）**：一律外置 `src-tauri/tests/`（与集成测试同目录），`src/` 生产代码**零 `#[cfg(test)]`**；共用测试工具收 `tests/common/`。
```

**为什么**：测试放置约定是 V1 全量架构约束（§10 开头注明，由守卫校验），改行为必须同步定稿文档，否则「文档与落地不一致」回归。

### 6. 结构守卫同步（design-layering.test.ts）

`src/styles/design-layering.test.ts` 第 33–37 行断言 `expect(design).toMatch(/inline|内联/)`——§10.4 从「内联」改为「一律外置」后该断言**必然失败**。G7 必须同步：
- 测试标题「文件 I/O 集成测试外置 + 纯逻辑单测 inline」→「Rust 测试一律外置 tests/」；
- 断言 `/inline|内联/` → 新文案（如 `/外置/`）或 `/零 `#[cfg(test)]`/`。

`src/components/layering.test.ts` 只扫描 components 零 invoke 直呼，不受本变更影响。**为什么**：见 D4——守卫与 §10.4 是绑定关系，同 PR 提交防 CI 红。

## Risks

- **`pub(crate)` 方案不可行（实测 E0603，已修正为 `pub`）**——集成测试 crate 无法访问 `pub(crate)` 项；实际提 `pub` 后 rustc 不再报 dead_code（`pub` 项视为公开 API），clippy 全绿（G7.2 已验证）。见 D2「实施修正」。
- 拆分量大（2234 行），按模块分步、每步 `cargo test` 保绿，避免一次性大炸（已按 G0→G7 完成，全程保绿）。
- `searcher/mod.rs` 测试大量用 `MusicSource` trait（`pub trait`，可直接 `use app_lib::service::searcher::MusicSource;`）与 fake 源——fake 实现复制进测试文件，trait 与 8 个提权项经 `app_lib::` 访问。
- 漏提权导致编译失败：某测试引用的私有项未提 → `tests/` 编译报「私有项不可访问」。对策：每个文件拆前先 grep 测试引用集（tasks 已列），提权完整后再删内嵌块。
- 守卫 `/inline|内联/` 断言漏更新 → `npm run test` 红。对策：G7 显式改断言，与 §10.4 同 PR。
