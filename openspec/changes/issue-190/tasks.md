# Tasks: issue-190 保存保留原文件权限

## 规格门

- [x] 1. **Main**：核对 Issue #190、`issue-190` 分支、起始 HEAD `4874c6f` 与干净工作区；记录 `proposal.md`、两个 spec、`fs_atomic.rs`、`lyrics.rs`、`save_song.rs`、`lyrics_lrc.rs` 的基线；确认无新增依赖、无前端/command 契约改动。基线不符即停。
- [x] 2. **Main**：审阅本 change 的 `design.md` 决策 D1–D7（helper 落位、捕获/应用时机、错误语义、Unix-only、`.lrc` 存在性语义、权限粒度），确认后派 Dev；随后运行 `npx --yes @fission-ai/openspec@1.5.0 validate issue-190 --strict --no-interactive`，通过后才进入开发。

## Rust 实现（Dev，仅四个授权文件）

- [x] 3. **Dev** / `src-tauri/src/service/fs_atomic.rs`：新增 `existing_permissions(path) -> io::Result<Option<fs::Permissions>>`（Unix 读 `fs::metadata` 权限；不存在返回 `None`；非 Unix 返回 `None`）与 `apply_permissions(file, perms)`（Unix 用已打开临时文件 `set_permissions`；`None`/非 Unix 为 no-op）。在 `write_atomic_with` 中按序落地：创建临时文件**前**捕获原权限 → 拷贝字节/写标签/`sync_all`（不变）→ `persist` **前**应用权限 → `persist`。metadata 非 `NotFound` 错误或应用权限失败均返回 Err 且不 persist；不新建模块、不改 `service/mod.rs`。
- [x] 4. **Dev** / `src-tauri/src/service/lyrics.rs`：`export_lrc` 在创建临时文件前调用 `existing_permissions(&lrc_path)`（非 `NotFound` 错误映射为中文 Err），`persist` 前应用权限。仅目标 `.lrc` 已存在时保留权限；不存在时保持现有 tempfile 新建行为、不继承音频权限。错误文案由 `writer::save_song` 统一加「写 .lrc 失败: 」前缀，避免双重前缀。

## 测试

- [x] 5. **Dev** / `src-tauri/tests/save_song.rs`：新增 `#[cfg(unix)]` 集成测试并覆盖 `song-save` 全部 scenario：
  - `save_song_preserves_0644_permissions`：`0644` 保存后仍为 `0644`（且字段读回正确）；
  - `save_song_preserves_non_default_permissions`：`0640`、`0664` 保存后保持原值；
  - `save_song_failed_write_preserves_content_and_permissions`：原文件 `0640` + 父目录 `0555`，保存返回 Err，原文件 bytes 与权限均不变；末尾恢复目录 `0755` 以便清理。
- [x] 6. **Dev** / `src-tauri/tests/lyrics_lrc.rs`：新增 `#[cfg(unix)]` 集成测试并覆盖 `lyrics-lrc` 全部 scenario：
  - `export_lrc_overwrite_preserves_existing_permissions`：已有 `.lrc`（`0640`）经 `save_song(..., true)` 后内容更新、权限仍 `0640`；
  - `export_lrc_new_file_with_audio_nondefault_permissions`：音频 `0640`、`.lrc` 不存在 → 勾选保存正常新建且内容正确，不断言继承音频权限；
  - `export_lrc_failed_write_preserves_existing_content_and_permissions`：已有 `.lrc`（`0640`）+ 父目录 `0555`，直接 `export_lrc` 返回 Err，原内容与权限不变；末尾恢复目录权限。
- [x] 7. **Main + Tester**：Main 审计 Dev diff 仅落在四个授权文件并记录 Dev checkpoint；Tester 运行 `cargo test --manifest-path src-tauri/Cargo.toml` 的聚焦用例与全量套件，逐条核对两个 spec 的 5 个 scenario 均有断言、失败路径无 `.tmp` 残留。Tester 默认只读，补测须由 Main 单独授权 `save_song.rs` / `lyrics_lrc.rs`。

## 文档同步（Main）

- [x] 8. **Main** / `docs/V1-PRD.md` FR-5 与 `docs/design/design.md` §9.1：写明原子写回成功后被编辑文件权限位不变、写失败时原文件内容与权限均不变、覆盖已有 `.lrc` 保留权限而新建行为不变、Windows 行为不变。不改其他产品行为，不与既有 FR 条目冲突。

## 独立 CR 与 Verify

- [x] 9. **CR（只读）**：对照 `openspec/changes/issue-190/specs/song-save/spec.md` 与 `lyrics-lrc/spec.md` 的全部 requirement/scenario 审查最终 diff；确认权限捕获在临时文件创建前、应用在 persist 前、失败不 persist、`.lrc` 仅存在时复制、Windows no-op、无新增依赖、无前端/command 契约改动；记录快照、文件、证据与 blocker/major 结论。
- [ ] 10. **Verify（只读）**：按顺序运行 `cargo check --manifest-path src-tauri/Cargo.toml`、`cargo test --manifest-path src-tauri/Cargo.toml`、`npm run test`、`npm run build`、`npx --yes @fission-ai/openspec@1.5.0 validate issue-190 --strict --no-interactive`；记录命令、退出码、环境（ffmpeg 可用）与精确 HEAD，失败即停。

## 集成（Main）

- [ ] 11. **Main**：按 archive → commit → push/PR（`Closes #190`）→ required CI → merge → 远端校验 → 清理的顺序集成；子 Agent 不执行 `git add/commit/push`、PR 或 merge。

## v0.2.2 发布追加（用户追加授权）

- [ ] 12. **Dev / Main**：按 design §11.2 把应用自身版本 `0.2.1` → `0.2.2`：
  - `package.json` 根 `version`；
  - `package-lock.json` 根 `version` 与 `packages[""].version`，其余依赖条目不动；
  - `src-tauri/Cargo.toml` `[package].version`；
  - `src-tauri/Cargo.lock` 中 `name = "music-tag"` 自身条目，其余第三方 `0.2.1` 条目（`as-slice`、`openssl-probe`、`windows-future`、`windows-link` 等）不动；
  - `src-tauri/tauri.conf.json` 顶层 `version`；
  - `README.md` 徽章改为 `v0.2.2`，并在 `## v0.2.1 更新` 前新增 `## v0.2.2 更新`，仅说明「保存音频或覆盖已有 `.lrc` 时保留原文件权限位（Linux/macOS）；新建 `.lrc` 与 Windows 行为不变」。

  不得改 `THIRD-PARTY-NOTICES.md`、历史版本小节或 workflow；不得运行会重写锁文件的 `cargo update`/`npm update`，不得全局替换 `0.2.1`。对应 release spec 的 Inspect release version 与 Read v0.2.2 release notes。
- [ ] 13. **Main + Tester**：Main 审计 Dev diff 仅落在六个授权文件的指定行；Tester 只读运行针对性检查——结构化读取六处版本均为 `0.2.2`；`git diff` 证明 `package-lock.json` 仅根与 `packages[""]` 两行、`Cargo.lock` 仅 `music-tag` 一行变化，第三方版本与 `THIRD-PARTY-NOTICES.md` 未变；README 徽章与新增小节对照 `song-save`/`lyrics-lrc` spec 及实现，确认措辞准确不夸大；`.github/workflows/` 无 diff；运行 `npx --yes @fission-ai/openspec@1.5.0 validate issue-190 --strict --no-interactive` 与版本一致性检查。Tester 默认只读，补测须由 Main 单独授权。
- [ ] 14. **CR（只读，round 2）**：独立复审 v0.2.2 发布差异——六处版本与 README 文案满足 `specs/release/spec.md` 三条 requirement；锁文件仅应用自身条目变化、第三方版本未动；workflow 未改且 tag 触发、四平台 matrix、`publish-release` 依赖/权限/`GH_REPO` 保持原样；既有权限实现（`fs_atomic.rs`、`lyrics.rs` 及相关测试）与 design D1–D7 未被本次追加改变。记录快照、文件、diff 范围与明确无 blocker/major 结论。
- [ ] 15. **Verify（只读）**：在包含版本变更的最终 HEAD 重跑完整适用矩阵：`cargo check --manifest-path src-tauri/Cargo.toml`、`cargo test --manifest-path src-tauri/Cargo.toml`、`npm run test`、`npm run build`、`npx --yes @fission-ai/openspec@1.5.0 validate --all --strict --no-interactive` 与 `validate issue-190 --strict --no-interactive`；核对版本字段与 README，记录 HEAD、命令、退出码、源码与规格指纹。版本变更前的旧 Verify 结果失效，不得复用。
- [ ] 16. **Main**：执行含 v0.2.2 版本/README 的最终集成，沿用任务 11 的 `archive → commit → sync-main → push → get-or-create-pr（Closes #190）→ wait-required-ci → merge → verify-remote → cleanup-local` 序列，一次执行、不重复；版本变更必须与权限实现同处同一 Verify 快照与同一 PR，required CI 未成功不得合并。
- [ ] 17. **Main**：合并后核对远端 main 含版本提交；检查 `v0.2.2` tag，已存在则核实其 commit SHA 且不覆盖/不强推/不移动，不存在才在合并提交创建并推送；等待并核实 Release workflow 的 `test` 与 Windows/macOS arm64/macOS x64/Linux 四平台全部成功、`publish-release` 自动转正并派发 Homebrew Tap；核对公开 Release `draft=false`、`prerelease=false`、四平台资产与 Homebrew workflow run 成功，记录 run URL、tag SHA、Release URL、资产名称与大小。任一失败保留未完成并如实报告，不得声称发布完成。对应 release spec 的 Publish job resolves repository without checkout 与 Verify tag-triggered release。

## 完成证据

- 两个 modified capability 的 5 个 scenario 均有 `#[cfg(unix)]` 断言且全绿；既有原子写回、`.lrc` 失败、无临时文件残留等回归测试不退化。
- 生产代码改动仅 `src-tauri/src/service/fs_atomic.rs` 与 `src-tauri/src/service/lyrics.rs`；测试仅两个授权测试文件；`Cargo.toml`/`Cargo.lock` 的变化仅限应用自身版本字段（v0.2.2 发布追加），第三方依赖条目不变。
- 保存后原文件权限位与保存前一致；写失败时原文件内容与权限均不变；覆盖已有 `.lrc` 保留权限、新建行为不变；Windows 行为不变。
- PRD FR-5 与 design §9.1 已同步；独立 CR 无 blocker/major；Verify 的完整命令链与严格校验证据绑定最终 HEAD。
- v0.2.2：六个应用版本源均为 `0.2.2`，锁文件仅应用自身条目变化，第三方版本与 `THIRD-PARTY-NOTICES.md` 未变；README 徽章与发布说明一致且不夸大。
- v0.2.2：版本变更与权限实现同处最终 Verify 快照，完整 CI 适用矩阵与 `validate --all --strict` 通过，round 2 独立只读 CR 无 blocker/major。
- v0.2.2：PR 合并且 required CI 成功，`v0.2.2` tag 指向合并提交；Release workflow 四平台成功，公开 Release 为 `draft=false`、`prerelease=false` 且含四平台资产，Homebrew Tap workflow 同步成功。缺少任一远端实证时不标记发布完成。
