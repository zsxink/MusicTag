## 1. 设计与契约决策（主会话先确认）

- [x] 1.1 已确认：`last_update_check_at` 使用 UTC RFC3339 字符串，通过既有 Rust/config facade 的最小读写 command 暴露；缺失、损坏、未来值按需检查，禁止 Vue 直接读写文件
- [x] 1.2 已确认：Windows/Linux 关闭窗口调用当前窗口 close，退出调用 AppHandle exit；macOS 保留系统应用菜单 About/Services/Hide/Quit
- [x] 1.3 固化 `app-menu-action` action ID 清单、迁移旧 `update-menu-action` 的兼容策略及菜单 enabled/visible 快照契约

## 2. Rust 后端（先于 Vue）

- [x] 2.1 在 `src-tauri/src/service/config.rs` 扩展现有 config.json 原子读写边界，支持最近成功检查 UTC 时间；覆盖缺失、损坏、未来值和写入失败，不改变 `last_dir` 行为
- [x] 2.2 在 `src-tauri/src/lib.rs` 构造 File/Edit/View/Help 菜单，保留 macOS 应用菜单；使用 Tauri 原生标准编辑角色，并按平台/构建条件控制应用菜单与开发者工具
- [x] 2.3 在 `src-tauri/src/lib.rs` 发射稳定 `app-menu-action`，接入前端状态同步所需的最小菜单状态更新；动作不得直接复制业务逻辑
- [x] 2.4 为保存、About/EULA、开发者工具等状态建立原生 enabled/visible 更新路径，并保证动作执行前的 stale-state guard
- [ ] 2.5 在 `src-tauri/tests/` 增加配置时间、菜单 action 映射、平台差异和状态门禁测试；使用注入配置/fake 依赖，不访问真实 GitHub 或浏览器

## 3. Vue 前端（Rust 契约完成后）

- [x] 3.1 在 `src/api/client.ts` 与 `src/api/updates.ts` 封装统一 `app-menu-action` 监听及已批准的配置/检查调用，保持 Tauri API 只从 client 边界进入
- [x] 3.2 在 `src/store/updates.ts` 实现启动检查资格：首次或已满 7×24 小时才自动检查；手动检查始终执行；成功写时间，失败不写；保留请求序号竞态保护
- [x] 3.3 在 `src/App.vue` 集中订阅和分发菜单动作，复用既有 folder/song/theme/update/About 能力，并在分发处再次检查 EULA、歌曲和 dirty 状态
- [x] 3.4 在 `src/components/UpdateToast.vue` 实现有更新 15 秒、无更新 5 秒自动关闭，错误手动关闭；清理旧 timer，并保留 Later、详情和重开所需状态
- [x] 3.5 在 `src/components/AppBar.vue` 增加具备无障碍名称的可用更新标记，点击从 store 当前结果重新打开提示；不改变 AppBar 主题/路径职责
- [ ] 3.6 为 api/store/App/UpdateToast/AppBar 增加 co-located 测试，覆盖节流边界、手动覆盖、失败、事件分发、timer cleanup、红点恢复、Later 与 EULA/保存门禁

## 4. 验证

- [x] 4.1 运行 `cargo check --manifest-path src-tauri/Cargo.toml`
- [x] 4.2 运行 `cargo test --manifest-path src-tauri/Cargo.toml`
- [x] 4.3 运行 `npm run test`
- [x] 4.4 运行 `npm run build`
- [x] 4.5 运行 `npx --yes @fission-ai/openspec@1.5.0 validate issue-170 --strict --no-interactive`
- [ ] 4.6 对照 app-menu/update-check 全部 WHEN/THEN 场景和 Issue #170 验收项，确认未新增业务范围或绕过分层守卫
