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
| Dev | `src-tauri/src/service/fs_atomic.rs`、`src-tauri/src/service/lyrics.rs`、`src-tauri/tests/save_song.rs`、`src-tauri/tests/lyrics_lrc.rs` | 仅这四个文件；不改 `Cargo.toml`/`Cargo.lock`、`service/mod.rs`、`writer.rs` |
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
