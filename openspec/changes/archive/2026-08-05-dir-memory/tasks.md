# 任务（变更域 both；依赖序 Rust→Vue 串行，未建 worktree 禁止并写）

## G1 Rust 配置模块（后端）

- [ ] 1.1 `src-tauri/Cargo.toml`：`[dependencies]` 追加 `dirs = "6"`
- [ ] 1.2 失败测试：`src-tauri/tests/config_tests.rs` 写 9 个用例（读写往返/缺失 None/损坏 None/字段缺失 None/目录已删 None/覆盖更新/保存失败 Err/空串 None/仅目录字段——覆盖 spec 全部场景含「不保存编辑状态·仅目录」与写失败路径）；跑 `cargo test --manifest-path src-tauri/Cargo.toml --test config_tests` 确认 FAIL（app_lib::service::config 不存在）
- [ ] 1.3 实现 `src-tauri/src/service/config.rs`（`default_config_path`/`load_last_dir`/`save_last_dir`）：
  - `save_last_dir`：先 `fs::create_dir_all(parent)`，临时文件写同目录 → rename 原子替换（复用 tempfile+persist 模式），失败返回 `Err`
  - `load_last_dir`：`serde_json::from_str` 失败 → None；`last_dir` 非空且 `Path::new(&last_dir).is_dir()` 才返回 Some（目录已删 → None）
  - `service/mod.rs` 加 `pub mod config;`
- [ ] 1.4 `cargo test --manifest-path src-tauri/Cargo.toml --test config_tests` 保绿

## G2 Rust command（后端）

- [ ] 2.1 `commands/folder.rs`：`pick_folder` 有上次目录时 `set_directory(last_dir)`；新增 `get_last_dir` / `save_last_dir`（委托 config；`save_last_dir` 返回 `()`，fire-and-forget）
- [ ] 2.2 `lib.rs` `generate_handler![...]` 追加两个 command
- [ ] 2.3 `cargo check && cargo test --manifest-path src-tauri/Cargo.toml` 全绿

## G3 前端 API + store（前端）

- [ ] 3.1 `src/api/songs.ts`：`getLastDir(): Promise<string | null>` / `saveLastDir(dir): Promise<void>` 封装
- [ ] 3.2 失败测试：`src/store/song.test.ts` 新增目录记忆 describe（覆盖 spec「换目录即持久化」「启动自动加载」「不保存编辑状态」）：
  - `initLastDir` 非空 dir → 走 activateFolder 语义（folderPath/songs 更新、resetSearchState）
  - `initLastDir` 空 / null / undefined dir → no-op（保持未打开空态）
  - `rememberLastDir` 注入 spy saveDir → 被调用一次并传目录；saveDir reject → 静默不抛出
  - `activateFolder` 触发 rememberLastDir（持久化点收敛）；取消（null/空）→ 不持久化
  - 手动路径（requestFolder → resolvePending discard）→ 持久化新目录；保存失败 → 不切换不持久化
  - 并发切换目录竞态守卫：慢的旧目录响应后到 → 不覆盖新目录 songs / last_dir
  - `initLastDir` loadSongs reject → 不触发持久化（成功切换才持久化）、不 panic 不污染启动
  确认 FAIL
- [ ] 3.3 `store/song.ts`：`import { saveLastDir } from '../api/songs'`；新增 `initLastDir` / `rememberLastDir(dir, saveDir = saveLastDir)`；`activateFolder` 末尾 `void rememberLastDir(dir)`（fire-and-forget）；`await loadSongs(dir)` 后、写 `songs` 前加竞态守卫（`raw.folderPath !== dir` → stale 作废，不覆盖列表、不持久化）
- [ ] 3.4 `npx vitest run src/store/song.test.ts` 保绿：**新增** `vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined) }))`（现文件只 mock ../api/search），既有 activateFolder 用例不再走真实 invoke

## G4 启动自动加载（前端）

- [ ] 4.1 `src/components/SongList.vue`：onMounted 调 `getLastDir()` → 非空 → `initLastDir(dir, (d) => listSongs(d))`（保留既有 keydown 监听）；失败路径兜底——`getLastDir` IPC 异常 → `.catch` no-op；`initLastDir`（list_songs IPC）失败 → `.catch` 复位 `folderPath=null`/`songs=[]`（防半打开态误显「文件夹中没有音乐」）
- [ ] 4.2 `npx vitest run src/components/songlist.test.ts` 保绿（4 用例：get_last_dir null → 空态；有效目录 → 自动加载列表；get_last_dir IPC 异常 → 静默空态；list_songs IPC 失败 → 复位空态不 unhandled）

## G5 文档 + 全量验证 + 提交

- [ ] 5.1 `docs/design/design.md`：§10.3 command 契约表加 `get_last_dir`/`save_last_dir` 两行 + `pick_folder` 起始目录描述；§10.0 service 行加 `config.rs`
- [ ] 5.2 `docs/V1-PRD.md` FR-1 补「记住上次目录」；§10.4 不重复编辑（rust-tests-separation 已先行）
- [ ] 5.3 全量：`cargo test && cargo clippy && npm run test && npm run build` 全绿
- [ ] 5.4 人工验证：打开目录→重启→自动加载；选择器默认定位；首次运行空态；删掉记忆目录后启动保持空态
- [ ] 5.5 提交：`feat(91): 记住上次打开的文件目录——Rust config.json + command + 前端启动自动加载`（分支 dir-memory，PR Closes #91）
