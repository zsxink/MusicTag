# 任务（变更域 both；依赖序 Rust→Vue 串行，未建 worktree 禁止并写）

## G1 Rust 配置模块（后端）

- [ ] 1.1 `src-tauri/Cargo.toml`：`[dependencies]` 追加 `dirs = "6"`
- [ ] 1.2 失败测试：`src-tauri/tests/config_tests.rs` 写 4 个用例（读写往返/缺失 None/损坏 None/覆盖更新）；跑 `cargo test --manifest-path src-tauri/Cargo.toml --test config_tests` 确认 FAIL（app_lib::service::config 不存在）
- [ ] 1.3 实现 `src-tauri/src/service/config.rs`（`default_config_path`/`load_last_dir`/`save_last_dir`，原子写）；`service/mod.rs` 加 `pub mod config;`
- [ ] 1.4 `cargo test --manifest-path src-tauri/Cargo.toml --test config_tests` 保绿

## G2 Rust command（后端）

- [ ] 2.1 `commands/folder.rs`：`pick_folder` 加起始目录（`set_directory`）；新增 `get_last_dir` / `save_last_dir`（委托 config）
- [ ] 2.2 `lib.rs` `generate_handler![...]` 追加两个 command
- [ ] 2.3 `cargo check && cargo test --manifest-path src-tauri/Cargo.toml` 全绿

## G3 前端 API + store（前端）

- [ ] 3.1 `src/api/songs.ts`：`getLastDir()` / `saveLastDir(dir)` 封装
- [ ] 3.2 失败测试：`src/store/song.test.ts` 新增目录记忆 describe（initLastDir 加载/ null 空态/ rememberLastDir 调 saveDir）；确认 FAIL
- [ ] 3.3 `store/song.ts`：`initLastDir` / `rememberLastDir` 动作；`activateFolder` 末尾 `void rememberLastDir(dir, saveLastDir)`（import 补 saveLastDir）
- [ ] 3.4 `npx vitest run src/store/song.test.ts` 保绿（既有 activateFolder 测试补 mock save_last_dir 分支）

## G4 启动自动加载（前端）

- [ ] 4.1 `src/components/SongList.vue`：onMounted 调 `getLastDir()` → 非空 → `initLastDir(dir, (d) => listSongs(d))`（保留既有 keydown 监听）
- [ ] 4.2 `npx vitest run src/components/songlist.test.ts` 保绿（mock get_last_dir 返回 null）

## G5 文档 + 全量验证 + 提交

- [ ] 5.1 `docs/design/design.md`：§10.3 加 `get_last_dir`/`save_last_dir` 行 + pick_folder 起始目录；§10.0 service 行加 config.rs
- [ ] 5.2 `docs/V1-PRD.md` FR-1 补「记住上次目录」；§10.4 不重复编辑（rust-tests-separation 已先行）
- [ ] 5.3 全量：`cargo test && cargo clippy && npm run test && npm run build` 全绿
- [ ] 5.4 人工验证：打开目录→重启→自动加载；选择器默认定位；首次运行空态
- [ ] 5.5 提交：`feat(91): 记住上次打开的文件目录——Rust config.json + command + 前端启动自动加载`（分支 dir-memory，PR Closes #91）
