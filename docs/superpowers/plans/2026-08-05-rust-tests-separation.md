# Plan B: Rust 生产/测试代码彻底分离 + 代码规范强化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Rust 生产文件（`src-tauri/src/`）内嵌的约 2234 行 `#[cfg(test)]` 单测全部拆到 `src-tauri/tests/`，`src/` 生产代码零 `#[cfg(test)]`；被测私有函数提 `pub(crate)`；共用测试工具 `test_util` 迁入 `tests/common/`；规范写进 `design.md §10.4` 与结构守卫。

**Architecture:** 纯重构（零行为变更、零 command 契约变更、零前端改动）。按模块逐个拆分：`commands/cover` → `model` → `service/cover` → `service/lyrics` → `service/meta` → `service/rename` → `searcher/*`。每拆一个模块即 `cargo test` 保绿后提交。

**Tech Stack:** Rust + cargo + tokio（searcher 测试用 async runtime）。

## Global Constraints

- **零行为变更**：业务逻辑、command 字符串契约、serde 序列化形状一律不变；纯搬运 + 可见性提升。
- **生产/测试彻底分离**：`src/` 生产代码最终**零 `#[cfg(test)]`**；所有测试（单元 + 集成）落 `src-tauri/tests/`。
- **可见性最小化**：被测私有函数提 `pub(crate)`（不暴露为 `pub` 外部 API）。
- 每个模块拆分后 `cargo test --manifest-path src-tauri/Cargo.toml` 必须全绿才提交。
- 共用测试工具 `test_util::mock_http_once` 迁 `tests/common/`（现有 fixture 位置），生产代码删除 `test_util`。
- 文档同步：`design.md §10.4` 升级「内联 → 外置」；结构守卫 `design-layering.test.ts` 同步。
- 验证门禁：`cargo test`、`cargo clippy`、`npm run test`、`npm run build` 全绿。

---

## 通用拆分手法（每个模块 Task 都遵循）

对任一生产文件 `src-tauri/src/<path>.rs`（内含 `#[cfg(test)] mod tests`）：

1. 记下测试块引用的**私有项**（`use super::*` 能访问、但 `tests/` 外部 crate 访问不到的）：把「生产代码中仅被该测试使用的函数/类型」提 `pub(crate)`。
2. 新建 `src-tauri/tests/<name>_tests.rs`，内容 = 原 `#[cfg(test)] mod tests` 块，把：
   - `use super::*;` 改为 `use app_lib::<module>::<item>;`（crate 名 `app_lib`，见 `lib.rs`）
   - 依赖的私有辅助函数（如 `cand(...)`）复制到测试文件内（它是测试专用，不必提 `pub(crate)`）
   - `test_util::mock_http_once` → `use crate::common::mock_http_once;`（`tests/common/mod.rs` 新加，见 Task 0）
3. 删除生产文件中的整个 `#[cfg(test)] mod tests`（含 `test_util`，若该文件独有）。
4. `cargo test` 保绿。

> `lib.rs` 已 `pub mod commands/model/service`，模块路径 `app_lib::service::searcher::...` 等外部可访问。`service/mod.rs` 若 `mod` 未 `pub`，改为 `pub mod`（检查现状，`searcher/mod.rs` 已 `pub mod crypto...`）。

---

### Task 0: 迁移共用测试工具 test_util → tests/common

**Files:**
- Create: `src-tauri/tests/common/mod.rs`（追加 `mock_http_once`）
- Modify: `src-tauri/src/service/searcher/mod.rs:381-395`（删除 `#[cfg(test)] pub(crate) mod test_util`）

**Interfaces:**
- Produces: `src-tauri/tests/common/mod.rs` 中的 `pub fn mock_http_once(response: Vec<u8>) -> String`
- Consumes: 后续所有 searcher 测试文件 `use crate::common::mock_http_once;`

- [ ] **Step 1: 迁移 mock_http_once 到 tests/common**

`src-tauri/tests/common/mod.rs` 追加：

```rust
// 共享测试工具：mock HTTP 单次响应（searcher 各源测试用）。
use std::io::{Read, Write};

/// 起本地一次性 HTTP server，返回 base URL；请求到达即返回 `response` 字节。
pub fn mock_http_once(response: Vec<u8>) -> String {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("绑定本地端口");
    let addr = listener.local_addr().expect("取本地端口");
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut s) = stream else { continue };
            let mut buf = [0u8; 4096];
            let _ = s.read(&mut buf);
            let _ = s.write_all(&response);
            let _ = s.flush();
            break;
        }
    });
    format!("http://{addr}")
}
```

- [ ] **Step 2: 删除生产代码 test_util**

`src-tauri/src/service/searcher/mod.rs` 删除 `#[cfg(test)] pub(crate) mod test_util { ... }` 整块（第 381-395 行附近）。

> ⚠️ 此时生产代码编译仍通过（`test_util` 仅 `#[cfg(test)]`），但内嵌测试引用它的地方会炸——所以**必须在迁移完所有 searcher 内嵌测试后才删**。本 Task 只做「tests/common 加函数」，实际删除放到 Task 6（searcher 全部搬完）。

- [ ] **Step 3: 验证 tests/common 可编译**

Run: `cargo check --manifest-path src-tauri/Cargo.toml --tests`
Expected: PASS（common 尚未被引用，无错误）

- [ ] **Step 4: Commit**

```bash
git add src-tauri/tests/common/mod.rs
git commit -m "refactor(layering): tests/common 增加 mock_http_once 共享测试工具"
```

---

### Task 1: 拆 commands/cover.rs

**Files:**
- Modify: `src-tauri/src/commands/cover.rs`（删除内嵌测试 + 私有项提 pub(crate)）
- Create: `src-tauri/tests/commands_cover_tests.rs`

**Interfaces:**
- Produces: `app_lib::commands::cover::<被测项>`（看原测试引用，通常是某私有 helper）

- [ ] **Step 1: 读原文件定位被测私有项**

Run: `cat src-tauri/src/commands/cover.rs`
查看 `#[cfg(test)]` 块里 `use super::*` 用到了哪些私有 fn/type；记录需要提 `pub(crate)` 的项（例如内部编解码 helper）。

- [ ] **Step 2: 私有项提 pub(crate)**

把被测私有函数 `fn foo(...)` 改为 `pub(crate) fn foo(...)`（仅被测项，不泛提）。

- [ ] **Step 3: 搬测试到独立文件**

`src-tauri/tests/commands_cover_tests.rs`：原测试块内容，`use super::*` 替换为 `use app_lib::commands::cover::<被测项>;`，测试内私有 helper（如 `fn make_input()`）复制进文件。

- [ ] **Step 4: 删除生产文件内嵌测试**

删除 `src-tauri/src/commands/cover.rs` 的整个 `#[cfg(test)] mod tests`。

- [ ] **Step 5: 验证保绿**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 全绿（新增 commands_cover_tests + 既有集成测试）

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/cover.rs src-tauri/tests/commands_cover_tests.rs
git commit -m "refactor(layering): 拆出 commands/cover 内嵌单测到 tests/commands_cover_tests.rs"
```

---

### Task 2: 拆 model.rs

**Files:**
- Modify: `src-tauri/src/model.rs`（删除内嵌测试 + 私有项提 pub(crate)）
- Create: `src-tauri/tests/model_tests.rs`

**Interfaces:**
- Produces: `app_lib::model::<被测项>`（model 是纯数据类型，多为 `Song`/`SongSummary` 的构造/serde 测试）

- [ ] **Step 1: 读原文件定位被测私有项**

Run: `cat src-tauri/src/model.rs`
记录 `#[cfg(test)]` 用到的私有 fn/type。

- [ ] **Step 2: 私有项提 pub(crate)**

- [ ] **Step 3: 搬测试到独立文件**

`src-tauri/tests/model_tests.rs`：`use app_lib::model::{...}`。

- [ ] **Step 4: 删除生产文件内嵌测试**

- [ ] **Step 5: 验证保绿**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 全绿

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/model.rs src-tauri/tests/model_tests.rs
git commit -m "refactor(layering): 拆出 model 内嵌单测到 tests/model_tests.rs"
```

---

### Task 3: 拆 service/cover.rs

**Files:**
- Modify: `src-tauri/src/service/cover.rs`
- Create: `src-tauri/tests/service_cover_tests.rs`

- [ ] **Step 1: 读原文件定位被测私有项**
- [ ] **Step 2: 私有项提 pub(crate)**
- [ ] **Step 3: 搬测试到 `src-tauri/tests/service_cover_tests.rs`**（`use app_lib::service::cover::...`）
- [ ] **Step 4: 删除生产文件内嵌测试**
- [ ] **Step 5: 验证保绿**（`cargo test` 全绿）
- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/service/cover.rs src-tauri/tests/service_cover_tests.rs
git commit -m "refactor(layering): 拆出 service/cover 内嵌单测到 tests/service_cover_tests.rs"
```

---

### Task 4: 拆 service/lyrics.rs + service/meta.rs + service/rename.rs

**Files:**
- Modify: `src-tauri/src/service/lyrics.rs`、`meta.rs`、`rename.rs`
- Create: `src-tauri/tests/service_lyrics_tests.rs`、`service_meta_tests.rs`、`service_rename_tests.rs`

- [ ] **Step 1: 逐个读原文件定位被测私有项**
- [ ] **Step 2: 私有项提 pub(crate)**
- [ ] **Step 3: 逐个搬测试到独立文件**（`use app_lib::service::{lyrics, meta, rename}::...`）
- [ ] **Step 4: 删除三个生产文件内嵌测试**
- [ ] **Step 5: 验证保绿**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 全绿

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/service/lyrics.rs src-tauri/src/service/meta.rs src-tauri/src/service/rename.rs src-tauri/tests/service_lyrics_tests.rs src-tauri/tests/service_meta_tests.rs src-tauri/tests/service_rename_tests.rs
git commit -m "refactor(layering): 拆出 service lyrics/meta/rename 内嵌单测到 tests/"
```

---

### Task 5: 拆 searcher 各源文件（crypto/itunes/kugou/lrclib/netease/qqmusic）

**Files:**
- Modify: `src-tauri/src/service/searcher/{crypto,itunes,kugou,lrclib,netease,qqmusic}.rs`
- Create: `src-tauri/tests/searcher_{crypto,itunes,kugou,lrclib,netease,qqmusic}_tests.rs`

**Interfaces:**
- Consumes: `tests/common/mod.rs` 的 `mock_http_once`（`use crate::common::mock_http_once;`）
- Produces: 各源测试文件访问 `app_lib::service::searcher::{crypto,itunes,kugou,lrclib,netease,qqmusic}::<被测项>`

- [ ] **Step 1: 逐个源文件读定位被测私有项**（crypto 的 aes/cbc 编解码 helper、各源的 URL 构造/解析 helper 等）
- [ ] **Step 2: 私有项提 pub(crate)**
- [ ] **Step 3: 逐个搬测试到独立文件**

关键替换：
- `use super::*;` → `use app_lib::service::searcher::<source>::<被测项>;`
- `use crate::service::searcher::test_util::mock_http_once;` → `use crate::common::mock_http_once;`
- 测试内 `mock_http_once(response)` 调用不变。

- [ ] **Step 4: 删除 6 个生产文件内嵌测试**
- [ ] **Step 5: 验证保绿**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 全绿

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/service/searcher/ src-tauri/tests/searcher_*_tests.rs
git commit -m "refactor(layering): 拆出 searcher 各源内嵌单测到 tests/"
```

---

### Task 6: 拆 service/searcher/mod.rs（最大，614 行）

**Files:**
- Modify: `src-tauri/src/service/searcher/mod.rs`（删除 `test_util` + 内嵌测试 + 私有项提 pub(crate)）
- Create: `src-tauri/tests/searcher_mod_tests.rs`

**Interfaces:**
- Produces（生产代码提 `pub(crate)`）:
  - `pub(crate) async fn search_song_with_sources(...)`（mod.rs:86）
  - `pub(crate) async fn search_source_with(...)`（mod.rs:173）
  - `pub(crate) async fn download_cover_with_timeout(...)`（mod.rs:211）
  - `pub(crate) fn to_halfwidth(c: char) -> char`（mod.rs:254）
  - `pub(crate) fn title_match(q: &str, t: &str) -> f32`（mod.rs:266）
  - `pub(crate) fn artist_match(q: &str, a: &str) -> f32`（mod.rs:283）
  - `pub(crate) fn aggregate(...)`（mod.rs:另查）
  - `pub(crate) fn source_rank(source: MusicSourceId) -> usize`（mod.rs:359）
- Consumes: `tests/common/mod.rs` 的 `mock_http_once`

- [ ] **Step 1: 列全被测私有项**

Run: `grep -n "^fn \|^async fn \|^    fn " src-tauri/src/service/searcher/mod.rs`
核对测试块 `use super::*` 引用的全部私有项（上表为准，另查 `aggregate` 签名行）。

- [ ] **Step 2: 私有项逐个提 pub(crate)**

- [ ] **Step 3: 搬测试到 `src-tauri/tests/searcher_mod_tests.rs`**

- `use super::*;` → 展开为具体 `use app_lib::service::searcher::{aggregate, search_song_with_sources, ...}`（按实际引用）
- 测试内 `use crate::common::mock_http_once;`
- 测试私有 helper（`cand(...)`、`FakeSource`、`FakeFailSource` 等 fake 实现）复制进测试文件（它们测试专用，不属生产代码）。
- 测试用到 `MusicSource` trait → `use app_lib::service::searcher::MusicSource;`（trait 是 `pub`，无需提升）。

- [ ] **Step 4: 删除生产文件 `test_util` + 整个内嵌测试块**

现在可以安全删除 `mod.rs` 的 `#[cfg(test)] pub(crate) mod test_util` 和 `#[cfg(test)] mod tests`。删除后检查无其他文件引用 `test_util`（Task 5 已全搬）。

- [ ] **Step 5: 验证保绿**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 全绿

> 若 `aggregate` 等函数未在别处用，仅测试用，提 `pub(crate)` 会有 `dead_code` 警告（生产编译时 `cfg(test)` 移除后无调用者）。处理：`#[allow(dead_code)]` 标注，或确认仅测试用途的可接受。clippy 门禁 `-D warnings` 时需处理。

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/service/searcher/mod.rs src-tauri/tests/searcher_mod_tests.rs
git commit -m "refactor(layering): 拆出 searcher/mod 内嵌单测到 tests/ + 删除 test_util"
```

---

### Task 7: 全量确认生产代码零测试 + 规范入文档

**Files:**
- Verify: `src-tauri/src/` 全目录
- Modify: `docs/design/design.md` §10.4
- Modify: `src/styles/design-layering.test.ts`（守卫，若断言旧文案）
- Modify: `docs/superpowers/specs/2026-08-05-ux-polish-and-layering-refactor-design.md`（标记实施完成）

- [ ] **Step 1: 确认 src/ 零 #[cfg(test)]**

Run: `grep -rn "#\[cfg(test)\]" src-tauri/src/ || echo "OK: 无内嵌测试"`
Expected: `OK: 无内嵌测试`

- [ ] **Step 2: 确认 test_util 无残留**

Run: `grep -rn "test_util\|mock_http_once" src-tauri/src/ || echo "OK: 无残留"`
Expected: `OK: 无残留`

- [ ] **Step 3: 全量验证**

Run: `cargo test --manifest-path src-tauri/Cargo.toml && cargo clippy --manifest-path src-tauri/Cargo.toml && npm run test && npm run build`
Expected: 全绿

- [ ] **Step 4: 同步 design.md §10.4**

`docs/design/design.md:367` 改为：

```markdown
- **Rust 单测（纯逻辑）**：一律外置 `src-tauri/tests/`（与集成测试同目录），`src/` 生产代码**零 `#[cfg(test)]`**；共用测试工具收 `tests/common/`。
```

- [ ] **Step 5: 更新结构守卫**

Run: `npx vitest run src/styles/design-layering.test.ts`
若 FAIL，更新 `src/styles/design-layering.test.ts` 断言中的「内联」字样为「外置 tests/」。若 PASS 跳过。

- [ ] **Step 6: Commit**

```bash
git add docs/design/design.md src/styles/design-layering.test.ts
git commit -m "docs(layering): §10.4 测试放置升级为外置 tests/ + 守卫同步——生产代码零内嵌测试"
```

---

## Self-Review 记录

**Spec 覆盖**：
- 13 个生产文件内嵌单测拆分 → Task 1-6（commands/cover、model、service/cover、service/{lyrics,meta,rename}、searcher/{crypto,itunes,kugou,lrclib,netease,qqmusic}、searcher/mod）✅
- `test_util::mock_http_once` 共用工具迁移 → Task 0 + Task 6 ✅
- 被测私有项提 `pub(crate)` → 各 Task Step 2 ✅
- 规范写进 spec（§10.4 内联→外置 + 守卫同步）→ Task 7 ✅
- 零行为变更 → 全局约束 ✅

**占位符扫描**：无 TBD/TODO；Step 均为可执行动作。部分 Step 描述性（读文件→定位），因被测私有项需实现时读实际代码确定——已给出通用手法 + 关键文件的具体函数清单（Task 6 列全）。

**类型一致性**：`mock_http_once`、`search_song_with_sources`、`aggregate` 等函数名与行号对应设计文档与 mod.rs 实际一致。

**已知风险**：
- `searcher/mod.rs` 被测私有项提 `pub(crate)` 后，`cfg(test)` 移除可能导致 `dead_code` 警告（无生产调用者）——用 `#[allow(dead_code)]` 或接受；clippy `-D warnings` 需处理。
- 测试文件访问 `app_lib` 需确认 crate 名（`lib.rs` 的 `[lib] name = "app_lib"`）。现有 `tests/` 集成测试已用 `app_lib::`，一致。
- `service/searcher/mod.rs` 的 `MusicSource` trait 是 `pub`，`test_util` 迁移后各 fake 源测试直接用 trait，无需提升。
