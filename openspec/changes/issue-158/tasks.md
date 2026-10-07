# Tasks: 基于 GitHub Releases 检查应用更新

## 文档

- [x] 1. 同步产品需求与技术契约：在 `docs/V1-PRD.md` 补充更新检查、系统原生帮助菜单入口、手动/启动触发、稍后抑制、状态反馈及明确非自动安装行为；在 `docs/design/design.md` 补充 Rust command、响应类型、菜单事件桥、前端 API/store/UI 落位与测试约定。

## Rust 后端

- [x] 2. 实现 GitHub Releases 查询 service：分页获取仓库稳定 Releases、过滤 draft/prerelease、按 semver 选最高版本并与 `CARGO_PKG_VERSION` 比较；设置超时和 User-Agent，错误返回可理解信息。仅使用 mock 响应测试版本解析、分页、过滤和网络/HTTP/无效数据失败；提交必要的 `Cargo.lock` 依赖锁定更新。
- [x] 3. 注册更新检查与 Release 外链 command：在 `commands/` 建薄壳并注册到 `lib.rs`，更新共享响应类型/依赖，并同步 `openspec/config.yaml` 的 Tauri command 契约清单和 `src/styles/command-contract.test.ts` 的 command 集合/源码覆盖。详情地址限于固定仓库 Release 的 HTTPS URL；仅 Rust 调用系统 opener，不向 WebView 授予 opener IPC 权限；不得增加下载或安装路径。
- [x] 4. 添加 Rust service/command 集成覆盖：在 `src-tauri/tests/update_tests.rs` 覆盖更新、最新、草稿/预发布忽略、错误映射及外链地址校验；使用桩响应，不访问真实网络。

## 原生菜单与 Vue 前端（Rust 完成后开始）

- [x] 5. 构建 Tauri 原生帮助菜单：`src-tauri/src/lib.rs` 增加“检查更新…”与“关于”菜单项；通过 `update-menu-action` 应用事件通知 Vue，并按桌面各平台 API 编译。
- [x] 6. 增加更新 API 与状态 store：统一封装检查/打开 Release 详情调用；实现检查状态、最近结果、并发请求序号及同版本稍后提示记忆。
- [x] 7. 接入应用启动与原生菜单事件：`App.vue` 异步启动检查并订阅/释放 `update-menu-action`；检查动作触发 store，关于动作打开关于视图；菜单检查期间及完成后反馈明确状态。
- [x] 8. 增加非阻塞更新提示与关于界面：提示版本并提供“查看详情/稍后”，不抢焦点；关于视图显示当前版本与最近检查结果。保持既有编辑流程可交互。
- [x] 9. 添加前端 co-located 测试：覆盖启动检查、原生菜单事件、检查中状态、最新/失败结果、详情打开、稍后同版本去重与更高版本再次提示、关于状态展示及提示不阻断交互。

## CR 有界修复（第 1 轮）

- [ ] 10. 修复 CR 发现：为当前版本读取补充最小 `core:app:allow-version` ACL 并同步契约；手动检查即使 Release 已稍后也必须显示结果；EULA 未完成时阻止“关于”视图抢焦点，并添加回归覆盖。

## 验证

- [ ] 11. 按 `.github/workflows/ci.yml` 当前条件与运行环境运行所有适用 CI 命令（Node 24、`npm ci`、`npm run build`、`npm run test`；Rust stable、workflow 所需系统依赖、`cargo check --all-targets`、`cargo test --all-targets`，以 workflow 实际定义为准），并运行 `npx --yes @fission-ai/openspec@1.5.0 validate issue-158 --strict --no-interactive`。
- [ ] 12. Verify 阶段执行 `npx --yes @fission-ai/openspec@1.5.0 validate --all --strict --no-interactive`，并按 pipe Verify 流程对当前源码快照复跑适用 CI 命令、记录退出码与源码指纹。
