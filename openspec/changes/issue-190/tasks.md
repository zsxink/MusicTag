# Tasks: issue-190 保存保留原文件权限

## 规格门

- [x] 1. **Main**：核对 Issue #190、`issue-190` 分支、起始 HEAD `4874c6f` 与干净工作区；记录 `proposal.md`、两个 spec、`fs_atomic.rs`、`lyrics.rs`、`save_song.rs`、`lyrics_lrc.rs` 的基线；确认无新增依赖、无前端/command 契约改动。基线不符即停。
- [x] 2. **Main**：审阅本 change 的 `design.md` 决策 D1–D7（helper 落位、捕获/应用时机、错误语义、Unix-only、`.lrc` 存在性语义、权限粒度），确认后派 Dev；随后运行 `npx --yes @fission-ai/openspec@1.5.0 validate issue-190 --strict --no-interactive`，通过后才进入开发。

## Rust 实现（Dev，仅四个授权文件）

- [ ] 3. **Dev** / `src-tauri/src/service/fs_atomic.rs`：新增 `existing_permissions(path) -> io::Result<Option<fs::Permissions>>`（Unix 读 `fs::metadata` 权限；不存在返回 `None`；非 Unix 返回 `None`）与 `apply_permissions(file, perms)`（Unix 用已打开临时文件 `set_permissions`；`None`/非 Unix 为 no-op）。在 `write_atomic_with` 中按序落地：创建临时文件**前**捕获原权限 → 拷贝字节/写标签/`sync_all`（不变）→ `persist` **前**应用权限 → `persist`。metadata 非 `NotFound` 错误或应用权限失败均返回 Err 且不 persist；不新建模块、不改 `service/mod.rs`。
- [ ] 4. **Dev** / `src-tauri/src/service/lyrics.rs`：`export_lrc` 在创建临时文件前调用 `existing_permissions(&lrc_path)`（非 `NotFound` 错误映射为中文 Err），`persist` 前应用权限。仅目标 `.lrc` 已存在时保留权限；不存在时保持现有 tempfile 新建行为、不继承音频权限。错误文案由 `writer::save_song` 统一加「写 .lrc 失败: 」前缀，避免双重前缀。

## 测试

- [ ] 5. **Dev** / `src-tauri/tests/save_song.rs`：新增 `#[cfg(unix)]` 集成测试并覆盖 `song-save` 全部 scenario：
  - `save_song_preserves_0644_permissions`：`0644` 保存后仍为 `0644`（且字段读回正确）；
  - `save_song_preserves_non_default_permissions`：`0640`、`0664` 保存后保持原值；
  - `save_song_failed_write_preserves_content_and_permissions`：原文件 `0640` + 父目录 `0555`，保存返回 Err，原文件 bytes 与权限均不变；末尾恢复目录 `0755` 以便清理。
- [ ] 6. **Dev** / `src-tauri/tests/lyrics_lrc.rs`：新增 `#[cfg(unix)]` 集成测试并覆盖 `lyrics-lrc` 全部 scenario：
  - `export_lrc_overwrite_preserves_existing_permissions`：已有 `.lrc`（`0640`）经 `save_song(..., true)` 后内容更新、权限仍 `0640`；
  - `export_lrc_new_file_with_audio_nondefault_permissions`：音频 `0640`、`.lrc` 不存在 → 勾选保存正常新建且内容正确，不断言继承音频权限；
  - `export_lrc_failed_write_preserves_existing_content_and_permissions`：已有 `.lrc`（`0640`）+ 父目录 `0555`，直接 `export_lrc` 返回 Err，原内容与权限不变；末尾恢复目录权限。
- [ ] 7. **Main + Tester**：Main 审计 Dev diff 仅落在四个授权文件并记录 Dev checkpoint；Tester 运行 `cargo test --manifest-path src-tauri/Cargo.toml` 的聚焦用例与全量套件，逐条核对两个 spec 的 5 个 scenario 均有断言、失败路径无 `.tmp` 残留。Tester 默认只读，补测须由 Main 单独授权 `save_song.rs` / `lyrics_lrc.rs`。

## 文档同步（Main）

- [ ] 8. **Main** / `docs/V1-PRD.md` FR-5 与 `docs/design/design.md` §9.1：写明原子写回成功后被编辑文件权限位不变、写失败时原文件内容与权限均不变、覆盖已有 `.lrc` 保留权限而新建行为不变、Windows 行为不变。不改其他产品行为，不与既有 FR 条目冲突。

## 独立 CR 与 Verify

- [ ] 9. **CR（只读）**：对照 `openspec/changes/issue-190/specs/song-save/spec.md` 与 `lyrics-lrc/spec.md` 的全部 requirement/scenario 审查最终 diff；确认权限捕获在临时文件创建前、应用在 persist 前、失败不 persist、`.lrc` 仅存在时复制、Windows no-op、无新增依赖、无前端/command 契约改动；记录快照、文件、证据与 blocker/major 结论。
- [ ] 10. **Verify（只读）**：按顺序运行 `cargo check --manifest-path src-tauri/Cargo.toml`、`cargo test --manifest-path src-tauri/Cargo.toml`、`npm run test`、`npm run build`、`npx --yes @fission-ai/openspec@1.5.0 validate issue-190 --strict --no-interactive`；记录命令、退出码、环境（ffmpeg 可用）与精确 HEAD，失败即停。

## 集成（Main）

- [ ] 11. **Main**：按 archive → commit → push/PR（`Closes #190`）→ required CI → merge → 远端校验 → 清理的顺序集成；子 Agent 不执行 `git add/commit/push`、PR 或 merge。

## 完成证据

- 两个 modified capability 的 5 个 scenario 均有 `#[cfg(unix)]` 断言且全绿；既有原子写回、`.lrc` 失败、无临时文件残留等回归测试不退化。
- 生产改动仅 `src-tauri/src/service/fs_atomic.rs` 与 `src-tauri/src/service/lyrics.rs`；测试仅两个授权测试文件；`Cargo.toml`/`Cargo.lock` 未变。
- 保存后原文件权限位与保存前一致；写失败时原文件内容与权限均不变；覆盖已有 `.lrc` 保留权限、新建行为不变；Windows 行为不变。
- PRD FR-5 与 design §9.1 已同步；独立 CR 无 blocker/major；Verify 的完整命令链与严格校验证据绑定最终 HEAD。
