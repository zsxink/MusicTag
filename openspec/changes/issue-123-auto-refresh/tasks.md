# Issue #123 Tasks

Domain: `both`。必须 Rust → Vue；同一文件只由一个写入角色持有。只有 Leader 勾选任务、写 progress、提交与集成。

## 1. 规格与文档（Leader，Dev 前置）

- [ ] 1.1 核对 Issue 手动右键刷新范围，更新 `specs/folder-list/spec.md` 的 Manual refresh scenario 与编辑状态保护；按 design 文档同步点更新 `docs/V1-PRD.md`、`docs/design/design.md`、`openspec/config.yaml`，明确 watch command/event、list-only 刷新、dirty 保留、查漏复扫与失败行为。Owner: Leader；五个 scenario 的权威契约。
- [ ] 1.2 执行 spec-gate preflight 与 `npx openspec validate issue-123-auto-refresh --strict --no-interactive`，审计 Architect 仅写 design/tasks 并提交已批准输入。Owner: Leader；Dev 依赖 1.1/1.2。

## 2. Rust 监听（complex_worker，先于前端）

- [ ] 2.1 实现无 Tauri 的递归目录监听 service：RecommendedWatcher、注册失败 PollWatcher 后备、通知分类、单一目标、monotonic watch_id、切换/停止释放、失败作废旧目标与错误通知。Owner: Rust Dev；文件 `src-tauri/src/service/folder_watch.rs`、`src-tauri/src/service/mod.rs`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`；依赖 1.2；映射当前目录新增/后代变更/打开目录切换。
- [ ] 2.2 添加 camelCase event model 与 `watch_folder(dir, watch_id)` 薄 command、managed state、事件 emitter、command 注册及进程资源清理，保持 list_songs 契约。Owner: 同一 Rust Dev；文件 `src-tauri/src/model.rs`、`src-tauri/src/commands/folder.rs`、`src-tauri/src/lib.rs`；依赖 2.1；映射 watcher 生命周期/错误与目录切换。
- [ ] 2.3 添加真实 TempDir watcher 测试和纯事件分类/代际测试，先校验 fixture，再测试新增、深层目录、删除、改名、整目录移动、切换、停止与有界等待。Owner: Rust Dev；文件 `src-tauri/tests/folder_watch.rs`、必要时 `src-tauri/tests/folder_watch_tests.rs`；复用只读 `tests/common/mod.rs`；依赖 2.2；运行 `cargo check --manifest-path src-tauri/Cargo.toml --all-targets` 与相关 Rust 测试。Leader 审计授权路径并提交 checkpoint。

## 3. Vue API 与刷新（complex_worker，Rust 完成后）

- [ ] 3.1 在统一 client 加事件订阅透传，定义事件类型和 watch/listen API；更新 command-contract 数量断言为 17，测试 command camelCase 参数和 unlisten 透传。Owner: Vue Dev；文件 `src/api/client.ts`、`src/api/types.ts`、`src/api/songs.ts`、`src/api/client.test.ts`、`src/api/songs.test.ts`、`src/styles/command-contract.test.ts`；依赖 2.3；映射全部 scenario 的 API 契约。
- [ ] 3.2 实现 store 监听生命周期、folderEpoch/requestSeq/watch_id 守卫、串行读取、250 ms 合并/1 秒最长等待、在途 pending reread、手动即时刷新和重试；首次 watcher 建立后补读，修复启动恢复及同路径 ABA 竞态。独立刷新保留 editor/dirty/搜索与候选，查漏启用时重新扫描并作废旧结果。Owner: 同一 Vue Dev；文件 `src/store/song.ts`、`src/store/song.test.ts`；依赖 3.1；映射五个 scenario 及所有兼容/竞态边界。
- [ ] 3.3 SongList 挂载/卸载消费 store 生命周期；补齐右键「刷新」及可键盘使用的菜单、关闭/禁用行为和非阻断中文错误提示；启动失败复位采用 epoch 守卫。Owner: 同一 Vue Dev；文件 `src/components/SongList.vue`、`src/components/songlist.test.ts`、必要时 `src/components/app.test.ts`；依赖 3.2；映射 Manual refresh / Open folder changes / failure lifecycle。运行相关前端测试与 `npm run build`，Leader 审计并提交 checkpoint。

## 4. Tester 与独立审查

- [ ] 4.1 Tester 对照 design 验证矩阵补足行为断言：真实 watcher → 真实 list_songs、事件合并、在途补读、A → B → A、取消 dirty 换目录、监听失败与卸载迟到、手动刷新、选中音频被移走的草稿保留、查漏复扫及保存/改名事件兼容。Owner: Tester；写入仅 `src-tauri/tests/folder_watch.rs`、`src-tauri/tests/folder_watch_tests.rs`、`src/api/client.test.ts`、`src/api/songs.test.ts`、`src/store/song.test.ts`、`src/components/songlist.test.ts`、`src/components/app.test.ts`；依赖 3.3。报告场景、fixture 早检、命令退出码和平台未实测范围；Leader 审计并提交 checkpoint。
- [ ] 4.2 CR 只读核对全部 diff、规格、事件/读取代际、资源释放、单目录所有权、dirty 与候选保持、查漏及保存串扰、四处 command 契约一致性；无 blocker/major 才进入 Verify。Owner: 独立 reviewer；写 none；依赖 4.1。

## 5. Verify 与 Integrate（Leader）

- [ ] 5.1 按 `.github/workflows/ci.yml` 确认 Node 24、Rust stable、Tauri 系统包及 ffmpeg 准备，执行 `npm ci`、`npm run build`、`npm run test`、`npx --yes @fission-ai/openspec@1.5.0 validate --all --strict --no-interactive`、`cargo check --manifest-path src-tauri/Cargo.toml --all-targets`、`cargo test --manifest-path src-tauri/Cargo.toml --all-targets`；记录相同 HEAD/源码与规格指纹、逐条退出码。Owner: Verify 只读或 Leader；依赖 4.2。
- [ ] 5.2 按 pipe 归档 → 提交 → 同步 main → 推送 → 创建/复用 `Closes #123` PR → 核对 required CI → 合并 → 核对远端 Issue/PR/merge SHA → 清理；写 progress 和完整 typed checkpoint 证据。Owner: Leader；依赖 5.1。
