# Design: issue-190 保存保留原文件权限

## 1. 范围与域判定

- **域：`backend`**。改动只在 Rust service 层（`service/fs_atomic.rs`、`service/lyrics.rs`）与 Rust 集成测试；不涉及 Vue 组件、store、`api/`、Tauri command 签名或前端契约。文档同步（PRD/design）是附属产物，验证包含 OpenSpec 校验，但不涉及 CI、构建脚本或工具链基础设施，故不标 `infra`；Windows 只是 no-op 分支，不构成 `both`。
- **范围内**：音频标签原子写回保留原文件权限位；覆盖已存在 `.lrc` 时保留其权限位；Unix 权限断言集成测试；PRD FR-5 与 `docs/design/design.md` §9.1 的保存语义说明。
- **范围外**：不新增依赖（`Cargo.toml` 不动）、不改前端、不改 command 契约、不改变原子写回的其他语义（同卷 rename、写失败原文件零触碰、无备份/无撤销）、不处理所有权/时间戳/ACL/xattr、不改变 Windows 行为。

## 2. 现状与根因

`fs_atomic::write_atomic_with`（`src-tauri/src/service/fs_atomic.rs:29`）先在同一目录用 `tempfile::Builder::new().suffix(".tmp").tempfile_in(dir)` 创建临时文件，把原文件字节完整拷贝进去，再由 lofty 在临时文件上重写标签，最后 `temp.persist(path)` 以 rename 原子替换原路径。`tempfile` 新建文件默认权限为 `0600`，rename 后原路径的 inode 被临时文件取代，于是原文件权限位丢失（Linux 实测 `0644` → `0600`）。

`lyrics::export_lrc`（`src-tauri/src/service/lyrics.rs:31`）对已存在的同名 `.lrc` 使用同样的「临时文件 + rename」模式，存在同一缺陷。两条路径都未捕获或复制原文件权限。

`save_song` 依次执行内嵌标签写回（`write_atomic_with`）与可选的 `.lrc` 写回（`export_lrc`），任一失败即以中文 Err 上抛（`src-tauri/src/service/writer.rs:70-88`），本变更不改变该编排顺序。

## 3. 设计决策

| 编号 | 决策 | 理由 |
|---|---|---|
| D1 | 权限捕获/应用 helper 放在 `service/fs_atomic.rs`，`lyrics.rs` 复用 | 权限逻辑只有一份实现，避免两条写回路径漂移；不新建模块，`service/mod.rs` 不动 |
| D2 | 在**创建临时文件之前**读取原文件 `fs::metadata(path)?.permissions()` | 读到的必然是原文件权限；metadata 失败时提前中止，尚未产生任何临时文件，原文件零触碰（fail-fast） |
| D3 | 在**写完标签并 `sync_all` 之后、`persist` 之前**，对已打开的临时文件调用 `File::set_permissions` | 用文件句柄 fchmod，不依赖临时文件路径，避免路径竞态；权限在文件以最终名字出现前就已就位；失败则 Drop 清理临时文件、原文件未动 |
| D4 | 读取权限失败（非 `NotFound`）→ 整个写回返回 Err；`NotFound` → 视为「没有可保留的权限」（音频随后 `File::open` 会以既有方式失败，`.lrc` 按新建处理）；应用权限失败 → 返回 Err、不 persist | 绝不静默接受 0600；spec 要求写失败时原文件内容与权限都不变，报错比降级更安全 |
| D5 | 仅 Unix/macOS 生效：`existing_permissions` 在非 Unix 返回 `Ok(None)`，`apply_permissions` 在非 Unix 为 no-op（`#[cfg]` 在 helper 内部，调用点无分支） | Windows 的 `Permissions` 只表达只读标志，不表达 ACL；复制它会改变只读目标文件的保存失败模式。规格不要求 Windows 权限语义，保持现状 |
| D6 | `.lrc` 只在捕获时**已存在**才复制权限；不存在时保持 tempfile 默认的新建行为，不继承音频文件权限 | 与 `lyrics-lrc` spec「新建 .lrc 行为不变」一致 |
| D7 | 复制整个 `fs::Permissions`（内核只应用 `07777`，含 setuid/setgid/sticky 位）；不复制 ACL、xattr、owner、时间戳 | spec 只要求权限位；其余属于 rename 替换的既有语义，超出本 Issue |

helper 契约（签名由 Rust agent 落地，可调整命名但语义不变）：

```rust
/// 读取路径当前权限位；不存在或非 Unix 平台返回 Ok(None)。
pub fn existing_permissions(path: &Path) -> std::io::Result<Option<fs::Permissions>>;

/// 在 rename 前把捕获的权限位应用到临时文件；None 或非 Unix 平台为 no-op。
pub fn apply_permissions(file: &fs::File, perms: Option<fs::Permissions>) -> std::io::Result<()>;
```

## 4. 实现边界与数据流

### 4.1 音频标签写回（`write_atomic_with`）

1. 解析 `dir = path.parent()`（不变）。
2. **新增**：`let original_perms = existing_permissions(path)?;`——在任何临时文件创建之前。非 `NotFound` 的 metadata 错误在此中止，`save_song` 映射为「写回文件失败: …」，原文件内容与权限均未变。
3. 创建同目录临时文件（`tempfile`，默认 `0600`），拷贝原文件字节（不变）。
4. 在临时文件上写标签、`flush`、`sync_all`（不变）。
5. **新增**：`apply_permissions(temp.as_file(), original_perms)?;`。
6. `temp.persist(path)?`（不变）。成功后原路径权限位 = 保存前原文件权限位。

`write_atomic`（`TaggedFile` 便捷包装）经 `write_atomic_with` 自动获得同样行为，无需另改。

### 4.2 `.lrc` 覆盖（`export_lrc`）

1. 空歌词 no-op（不变）。
2. 计算 `lrc_path` 与 `dir`（不变）。
3. **新增**：`let original_perms = existing_permissions(&lrc_path).map_err(|e| format!("读取权限失败: {e}"))?;`——此时尚未创建临时文件。目标不存在 → `None`；非 `NotFound` 错误 → 以 Err 返回（`writer::save_song` 统一加「写 .lrc 失败: 」前缀，不双重加）。
4. 创建临时文件、写 UTF-8 文本、`flush`、`sync_all`（不变）。
5. **新增**：`apply_permissions(temp.as_file(), original_perms).map_err(|e| format!("设置权限失败: {e}"))?;`。
6. `temp.persist(&lrc_path)`（不变）。已存在 `.lrc` 的权限位保留；新建 `.lrc` 走原 tempfile 默认行为。

写 `.lrc` 失败（含第 3、5 步）时，原 `.lrc` 内容与权限位均不变；内嵌标签已在第 4.1 步落盘，这是既有写顺序（内嵌先、`.lrc` 后），不变。

### 4.3 错误面

- 音频路径不新增对外错误文案，沿用 `writer::save_song` 的「写回文件失败: {e}」。
- `.lrc` 路径新增的权限错误被既有「写 .lrc 失败: {e}」包裹，仍如实返回、不吞错。
- 任何新增步骤失败都发生在 `persist` 之前，因此原文件（音频或 `.lrc`）内容不可能被改动。

## 5. 跨平台策略

- Unix（Linux/macOS）：`fs::metadata` 读取完整 `st_mode` 权限位，`File::set_permissions` 以 fchmod 应用；umask 不参与（chmod 显式设位）。
- Windows：helper 恒为 no-op，`save_song`/`export_lrc` 行为与当前完全一致；不复制只读标志、不触碰 ACL。测试以 `#[cfg(unix)]` 限定，Windows 仅要求编译通过（no-op 分支）。
- `#[cfg]` 收敛在 `fs_atomic.rs` 的 helper 内部，`lyrics.rs` 与 `write_atomic_with` 的调用点保持平台无关。

## 6. 风险与不在范围

| 风险 | 处理 |
|---|---|
| 符号链接 | `fs::metadata` 跟随链接读取目标权限，而 rename 替换的是链接节点本身——这是本变更前就存在的语义；不新增、不修复，明确不在范围 |
| 只读文件（如 `0444`） | Unix 下临时文件由当前用户创建，写内容与 fchmod 均可完成；rename 只要求目录可写。保存后文件仍为 `0444` |
| 只读目录 | 临时文件创建失败 → Err，原文件内容与权限不变（沿用既有失败路径，新增测试断言权限） |
| 竞态 | 权限在创建临时文件前捕获，到 persist 之间若有其他进程 chmod/chown，会写入过期权限；V1 无文件锁，与并发编辑同一文件属同类风险，接受并记录 |
| setuid/setgid/sticky | 随权限字一起复制；内核可能在调用者缺少对应权限时静默清除 setgid，sticky 对普通文件无意义。先写内容后设位，不引入提权面 |
| ACL / xattr | 不复制，属 rename 替换的既有行为，不在范围 |
| 所有权 / 时间戳 | 不保留（临时文件归当前用户、inode/mtime 变化），既有行为，不在范围 |
| chmod 失败 | 返回 Err、不 persist，原文件不变；宁可保存失败也不静默改变权限 |
| 权限测试依赖非 root | 只读目录类测试在 root 下不会失败；与现有 `save_song_atomic_write_failure_keeps_original_untouched` 同一前提，CI 以非 root 运行 |

## 7. 文件所有权与落位

| 角色 | 可写路径 | 说明 |
|---|---|---|
| Dev | `src-tauri/src/service/fs_atomic.rs`、`src-tauri/src/service/lyrics.rs`、`src-tauri/tests/save_song.rs`、`src-tauri/tests/lyrics_lrc.rs` | 本节权限实现部分仅这四个文件；不改 `service/mod.rs`、`writer.rs`。v0.2.2 版本升级的额外可写路径见 §11.2 |
| Tester | 默认只读；经主会话明确授权后可修改上述两个测试文件 | 补测必须限定在授权路径，不得改生产代码 |
| 主会话 | `docs/V1-PRD.md`、`docs/design/design.md`、`tasks.md`、`.agents/runs/issue-190/progress.md` | 文档同步、任务勾选与进度由主会话负责 |
| CR / Verify | 只读 | 不改任何文件 |

## 8. 测试与验证计划

### 8.1 spec scenario → 测试映射

| spec | scenario / 要求 | 测试（`#[cfg(unix)]`） | 断言 |
|---|---|---|---|
| `song-save` | 保存后权限不变（`0644`） | `save_song.rs::save_song_preserves_0644_permissions` | 保存成功后 `metadata(path).permissions().mode() & 0o777 == 0o644`，且标签内容读回正确 |
| `song-save` | 非默认权限保持不变（`0640`/`0664`） | `save_song.rs::save_song_preserves_non_default_permissions` | 分别设 `0o640`、`0o664`，每次保存后权限位保持原值 |
| `song-save` | 保存失败不动原文件（内容 + 权限） | `save_song.rs::save_song_failed_write_preserves_content_and_permissions` | 原文件设 `0o640`、父目录设 `0o555` → `save_song` 返回 Err；原文件 bytes 与权限位均不变；测试末尾恢复目录 `0o755` 以便清理 |
| `lyrics-lrc` | 覆盖已有 `.lrc` 保留权限（`0640`） | `lyrics_lrc.rs::export_lrc_overwrite_preserves_existing_permissions` | 预置 `.lrc` 内容 + `0o640`，`save_song(..., true)` 后 `.lrc` 内容 = 当前歌词、权限仍为 `0o640` |
| `lyrics-lrc` | 新建 `.lrc` 行为不变 | `lyrics_lrc.rs::export_lrc_new_file_with_audio_nondefault_permissions`（并保留既有 `export_lrc_checked_nonempty_writes_flac_sidecar_and_embedded`） | 音频设 `0o640`、`.lrc` 不存在 → 勾选保存后 `.lrc` 正常生成且内容正确；不要求（也不断言）继承音频权限 |
| `lyrics-lrc` | 写 `.lrc` 失败时原内容与权限不变 | `lyrics_lrc.rs::export_lrc_failed_write_preserves_existing_content_and_permissions` | 预置 `.lrc` 内容 + `0o640`、父目录设 `0o555`，直接调 `export_lrc` 返回 Err；`.lrc` 内容与权限不变；末尾恢复目录权限 |

回归要求：既有 `save_song_atomic_write_failure_keeps_original_untouched`、`export_lrc_write_failure_returns_err_with_reason`、`export_lrc_failed_write_leaves_no_temp_residue`、`save_song_preserves_audio_frames` 必须继续通过；失败路径不得残留 `.tmp`。

### 8.2 命令清单（按项目规定顺序）

```sh
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
npm run test
npm run build
npx --yes @fission-ai/openspec@1.5.0 validate issue-190 --strict --no-interactive
```

Rust 全量测试会经 `tests/common` 调用 `ffmpeg` 生成 WAV/M4A fixture，环境需具备 `ffmpeg`（既有前提）。测试记录命令、退出码与精确 HEAD。

## 9. 文档同步（主会话执行）

- `docs/V1-PRD.md` FR-5：新增一条保存语义——原子写回成功后原文件权限位与保存前一致；写失败时原文件内容与权限均不变（Unix/macOS）；`.lrc` 覆盖保留权限、新建行为不变。
- `docs/design/design.md` §9.1 保存流程段（约第 225 行）：在同目录临时副本 + 原子替换描述后补充「replace 前把原文件权限位复制到临时文件；`.lrc` 覆盖同样保留权限；Windows 行为不变」。
- 不改动 FR-5 其他条目与其他产品行为。

## 10. 完成判据

- 两条 modified capability 的全部 5 个 scenario 都有对应的 `#[cfg(unix)]` 断言，且既有回归测试全绿。
- 生产改动仅限 `fs_atomic.rs` 与 `lyrics.rs`，无新增依赖、无前端/command 契约变化、Windows 路径为 no-op。
- `cargo check`、`cargo test`、`npm run test`、`npm run build`、`openspec validate issue-190 --strict` 全部通过，证据绑定最终 Verify HEAD。
- PRD 与 design 的保存语义已同步；CR 无 blocker/major。

## 11. 追加范围：发布 v0.2.2

用户在本变更进入集成前追加授权：随 issue-190 发布 `v0.2.2`。本节只覆盖追加部分；D1–D7、权限实现方案与既有测试计划不变。

### 11.1 域判定与边界

- **域：`backend`（原范围不变）+ `docs`/`infra`（追加部分）**。追加内容为应用自身版本元数据、README 版本徽章与发布说明、合并后 tag 触发的公开发布与 Homebrew 同步验证；不涉及 Rust/Vue 业务代码，故不构成 `both`。
- **范围内**：`package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json` 中应用自身版本 `0.2.1` → `0.2.2`；`README.md` 徽章与新增 v0.2.2 发布说明；合并后 `v0.2.2` tag 的 Release 与 Homebrew Tap 远端验证。
- **范围外**：不改 `.github/workflows/release.yml`、`.github/workflows/homebrew.yml`、tag 触发、四平台 matrix、发布顺序、权限或 tap 同步机制。现有 `release.yml` 的 `publish-release` 已在 job-level `env` 提供 `GH_REPO: ${{ github.repository }}`（`release.yml:112`），满足 delta spec 的「Publish job resolves repository without checkout」场景，无需改动。不改产品行为、command 契约、依赖或 `THIRD-PARTY-NOTICES.md`。
- **规格依据**：`openspec/changes/issue-190/specs/release/spec.md` 的三条 MODIFIED requirement。

### 11.2 版本来源清单

当前六处应用自身版本均为 `0.2.1`，目标均为 `0.2.2`：

| 声明 | 精确位置 | 约束 |
|---|---|---|
| npm package | `package.json` 根 `version`（第 4 行） | 只改根版本 |
| npm lock | `package-lock.json` 根 `version`（第 3 行）与 `packages[""].version`（第 9 行） | 只改这两处；其余 `packages` 条目不动 |
| Cargo package | `src-tauri/Cargo.toml` `[package].version`（第 3 行） | 只改 package 版本 |
| Cargo lock | `src-tauri/Cargo.lock` 中 `name = "music-tag"` 自身条目（第 2696–2697 行） | 只改该条目；`as-slice`（第 104 行）、`openssl-probe`（第 3142 行）、`version-compare`（第 5564 行）以及 `windows-future`/`windows-link` 依赖同样出现的 `0.2.1` 均属第三方，必须保持不变 |
| Tauri | `src-tauri/tauri.conf.json` 顶层 `version`（第 4 行） | 只改顶层 version |
| README | `README.md` 版本徽章（第 8 行 `版本-v0.2.1-blue.svg`） | 改为 `v0.2.2`；历史版本小节保留 |

- 运行时版本由 Tauri `getVersion()` 与 Rust `CARGO_PKG_VERSION` 派生；上述字段一致即应用版本一致。
- 只做精确字段编辑。不得运行 `cargo update`、`npm update` 或其他会重写/重排锁文件的命令，不得全局替换 `0.2.1`。

### 11.3 README 发布说明

在 `## v0.2.1 更新` 之前新增 `## v0.2.2 更新`，内容限于本次实际发布的行为：

- 保存音频文件或覆盖已有 `.lrc` 时，保留原文件权限位（Linux/macOS）。
- 新建 `.lrc` 与 Windows 下的行为不变。

不得声称保留所有权、ACL、xattr 或时间戳，不得声称 Windows 权限语义变化；不得把测试补强、CI 或 workflow 变化写成用户功能；保留 v0.2.1 及更早小节原文。

### 11.4 发布顺序与门禁

1. 版本与 README 变更和权限实现同属一个 change/PR；Verify 必须在包含 `0.2.2` 元数据的最终 HEAD 通过后才可集成。
2. 主会话按任务 11 的序列集成：`archive → commit → sync-main → push → get-or-create-pr（Closes #190）→ wait-required-ci → merge → verify-remote → cleanup-local`。required CI 未成功不得合并。
3. 合并后核对远端 main 已包含版本提交；检查 `v0.2.2` tag 是否已存在。已存在则核实其指向的 commit SHA，不覆盖、不强推、不移动；不存在才在合并提交创建并推送 `v0.2.2`。
4. 等待该 tag 对应 `.github/workflows/release.yml`：`test` job 成功；`publish-tauri` 的 Windows、macOS arm64、macOS x64、Linux 四个条目全部成功并上传资产；随后 `publish-release` 将 draft 转正并派发 `homebrew.yml`。任一 job 失败或被跳过则保留未完成。
5. 核对公开 Release：`draft=false`、`prerelease=false`，tag/标题为 `v0.2.2`，含四平台资产；记录 Release URL、资产名称与大小。
6. 等待并核实该 tag 对应 `.github/workflows/homebrew.yml` run 成功，记录 run URL、输入 tag 与 tap 同步结果。自动派发失败时，按 README 既有维护说明手动 dispatch 同一 tag 重试并核对最终成功 run。
7. 需要时由主会话把公开 Release 正文核对/补齐为与 README 一致的简短 v0.2.2 摘要；不改动已上传资产。

不得手动提前 publish draft；不得以 workflow queued/构建中、本地构建成功、draft 已存在或派发命令成功声称发布完成。

### 11.5 风险与控制

| 风险 | 控制 |
|---|---|
| 漏改版本源（尤其 `package-lock.json` 两处与 `Cargo.lock` 自身条目） | Dev 按 §11.2 逐项编辑；Tester 结构化读取六处；CR 复核 diff 行级范围 |
| 误改第三方版本（`Cargo.lock` 中 `as-slice`/`openssl-probe`/`windows-*` 的 `0.2.1`、`THIRD-PARTY-NOTICES.md`） | 只允许 §11.2 列出的行变化；用 `git diff` 证明锁文件其余内容不变 |
| README 描述超范围或与实现不一致 | 文案限定权限位保留（Linux/macOS）并明确新建 `.lrc`/Windows 不变；CR 对照 `fs_atomic.rs`、`lyrics.rs` 与两个 spec |
| tag 指向错误 commit 或覆盖旧 tag | 只在合并后的 main 提交创建 tag；先检查存在性并核对 SHA；禁止 force push/move tag |
| 把 draft、构建中或派发成功误报为已发布 | 发布验收以公开 Release `draft=false`/`prerelease=false`、四平台资产与 Homebrew run 成功为证据；缺一即保留未完成 |
| 版本/README 变更使既有 Verify 失效 | 在新 HEAD 重跑完整适用 CI 矩阵与 strict validate；新增差异经 round 2 独立只读 CR |
| 验证命令重写锁文件引入无关变化 | 仅做精确字段编辑；版本一致性用只读结构化检查，不用会更新锁文件的命令 |

### 11.6 验证补充

- **版本结构化核对**：解析 `package.json`、`package-lock.json`（根与 `packages[""]`）、`src-tauri/tauri.conf.json`；定点读取 `src-tauri/Cargo.toml` `[package].version` 与 `src-tauri/Cargo.lock` 的 `music-tag` 条目；六处均为 `0.2.2`。
- **锁文件与范围审计**：`git diff` 中 `package-lock.json` 仅两处版本行、`src-tauri/Cargo.lock` 仅 `music-tag` 条目一行变化；第三方包版本与 `THIRD-PARTY-NOTICES.md` 零变化；`.github/workflows/` 无 diff。
- **README 审计**：徽章为 `v0.2.2`；新增小节措辞与 §11.3 一致，且与已实现行为相符。
- **Verify 重跑**：源码在既有 Verify 后发生变化，旧结果失效。在含版本变更的最终 HEAD 重新运行 `cargo check --manifest-path src-tauri/Cargo.toml`、`cargo test --manifest-path src-tauri/Cargo.toml`、`npm run test`、`npm run build`、`npx --yes @fission-ai/openspec@1.5.0 validate --all --strict --no-interactive` 与 `validate issue-190 --strict --no-interactive`，记录 HEAD、命令、退出码、源码与规格指纹。
- **独立 CR**：新增差异需在 round 2 只读复审，覆盖 §11.2/§11.3/§11.4 与「既有权限实现和 D1–D7 未被改变」；无 blocker/major 才继续集成。

### 11.7 完成判据补充

- 六个应用版本源均为 `0.2.2`，锁文件仅应用自身条目变化，第三方版本与 `THIRD-PARTY-NOTICES.md` 未变。
- README 徽章为 `v0.2.2`，发布说明与已发布实现一致且不夸大。
- 版本变更与权限实现同处最终 Verify 快照，完整 CI/严格校验通过，round 2 CR 无 blocker/major。
- PR 合并且 required CI 成功，`v0.2.2` tag 指向合并提交。
- Release workflow 四平台全部成功，公开 Release 为 `draft=false`、`prerelease=false` 且含四平台资产；Homebrew Tap workflow 同步成功。
- 任一远端事实缺失或失败时保留未完成并如实报告，不得将发布标记为完成。
