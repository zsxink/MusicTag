# Design: 基于 GitHub Releases 检查应用更新

## Domain

`both`：更新状态与提示属于 Vue 前端；获取 GitHub Release、比较版本和打开外部链接属于 Rust/Tauri 后端。实现顺序为先同步 PRD/技术设计，再完成 Rust 后端，再接 Vue 前端。

## 边界与数据流

- 后端在 `src-tauri/src/service/update.rs` 实现只读 GitHub Releases 查询：请求 `https://api.github.com/repos/zsxink/MusicTag/releases`，从响应中过滤 `draft == false` 且 `prerelease == false` 的条目，选择最高稳定语义版本；不依赖 API 返回顺序。无有效稳定版本时视为查询失败，返回可理解的错误。
- 当前版本取 `env!("CARGO_PKG_VERSION")`，与 `src-tauri/Cargo.toml` 版本同源。版本解析使用 Rust `semver`，release tag 接受可选的 `v` 前缀；非语义版本 tag 不作为可比较版本。比较必须使用版本语义，而不是字符串或 GitHub `published_at`。
- 新增 Tauri command `check_for_update`，以薄壳委托 service，返回当前版本、最新稳定版本、是否有更新及 HTML Release URL；网络/HTTP/JSON/版本错误以 `Result<_, String>` 传回。复用现有 `reqwest` 与 Tauri async runtime，不添加 updater 插件或下载能力。
- Vue 的 `api/updates.ts` 封装 command；`store/updates.ts` 管理 `idle/checking/up-to-date/update-available/error`、最近结果和本次检查请求序号。手动检查与启动检查共用同一动作；重复触发检查时仅最新请求更新状态，启动请求不等待、不阻塞主界面。
- 在 `App.vue` 启动后触发一次检查；Tauri 系统原生菜单栏提供“帮助”→“检查更新…”和“关于”入口，通过应用事件把菜单动作转交 Vue；`AboutDialog.vue` 显示当前版本和最近检查状态。所有 UI 文案中文。检查中及结果在应用内可见。
- 新版本在应用内显示非模态、不抢焦点的提示，包含版本号、“查看详情”与“稍后”。查看详情经 `api/updates.ts` 调用后端外链 command；Rust 校验 Release URL 的 HTTPS scheme 与固定仓库 host/path 后使用 Tauri opener 的 Rust API 打开，不向 WebView 授予 opener IPC 权限。稍后将该版本记入 `localStorage`，同版后续启动/手动检查不再展示提示，更高版本仍展示。该记忆只抑制提示，不抑制手动检查结果或关于页状态。不得自动打开链接、下载或安装。

## 关键决策与风险

1. 用 Releases REST API 的全量列表而非 `/releases/latest`，确保能显式忽略 draft/prerelease 并从稳定版本中取语义最高版本。API 分页风险以 `per_page=100` 请求；项目发布规模超过一页时需继续分页直至无条目，避免漏掉最高版本。
2. 保持网络访问在 Rust service，减少前端跨域/CSP问题并沿用后端 IPC 分层。为 GitHub 请求设置有限超时并提供 User-Agent；失败只更新状态，不影响窗口和编辑操作。
3. 外链仅允许打开从固定仓库 API 得到的 Release URL；验证 URL scheme 为 `https` 后再交给系统浏览器，避免把任意 URL 传给 opener。
4. 不使用 Tauri updater 插件：本需求只检查并呈现 Release 页面，不下载或安装。更新能力没有文件写入、迁移或启动阻塞路径。
5. 现有项目没有设置页或应用菜单。使用 Tauri 原生应用菜单中的“帮助”入口及应用内“关于”视图；菜单通过事件桥触发 Vue store action。提示用非模态 UI，不调用聚焦窗口/弹窗 API。

## 场景到验证映射

| 规格场景 | 验证 |
|---|---|
| 存在正式版更新 | Rust service 测试包含高版本稳定版并断言版本、更新标记和详情 URL；前端测试断言显示非模态更新提示 |
| 没有更新 | Rust service 测试当前版本等于/高于最新稳定版；前端断言明确“已是最新版本”状态 |
| 检查失败 | Rust 测试覆盖网络/非成功 HTTP/无有效版本响应；前端断言显示可理解失败状态，既有主界面仍可交互 |
| 用户手动检查 | 菜单事件桥测试覆盖“检查更新”动作；前端测试从菜单事件触发检查、显示检查中并展示结果 |
| 应用启动 | App 测试确认挂载后发起一次异步检查，不等待其完成后才渲染工作区 |
| 查看 Release 详情 | 前端测试操作调用外链 API；Rust command/service 校验只开放 HTTPS Release 地址 |
| 稍后处理 | 前端测试同版本只提示一次，版本升级后仍提示；提示无模态遮罩且不抢焦点 |
| 查看更新状态 | 关于视图展示编译版本与最近检查的 latest/error/up-to-date 结果 |

所有 HTTP 测试使用注入的响应/客户端桩，不访问真实 GitHub，不需要外部生成 fixture。前端测试继续 co-located；Rust service 逻辑测试放 `src-tauri/tests/update_tests.rs`，Tauri command/HTTP 边界如需文件 I/O 不适用。

## 文件与任务所有权

- 文档同步：`docs/V1-PRD.md`、`docs/design/design.md`。
- Rust：新增 `src-tauri/src/service/update.rs`、`src-tauri/src/commands/update.rs`；修改 `src-tauri/src/service/mod.rs`、`src-tauri/src/commands/mod.rs`、`src-tauri/src/lib.rs`、`src-tauri/Cargo.toml`、`src-tauri/tests/update_tests.rs`。
- 原生菜单：修改 `src-tauri/src/lib.rs` 构建 Tauri“帮助”菜单及“检查更新…”/“关于”菜单项，通过 `update-menu-action` 事件发送动作；不需要增加业务 command 或 WebView 权限。
- 前端：新增 `src/api/updates.ts`、`src/store/updates.ts`、`src/components/AboutDialog.vue` 及其 co-located tests；修改 `src/App.vue` 监听原生菜单事件并触发检查/关于视图，`src/api/types.ts`（若 command 返回类型需要共享声明），并按需更新 `src/components/app.test.ts`。`AppBar.vue` 保持原有品牌、路径和主题控件，不加入窗口内帮助菜单。
- 外链能力：修改 `src-tauri/Cargo.toml` 与 `src-tauri/src/lib.rs` 注册 Tauri opener 插件，关闭 JS 自动链接打开；前端只调用校验过的自有 command，不授予 opener IPC 权限。
- OpenSpec 当前变更文件仅由 Architect 维护 `design.md` / `tasks.md`；主 Agent负责任务勾选。

## 验证门禁

- 按仓库 `.github/workflows/ci.yml` 当前启用条件，在 Rust stable/Ubuntu Tauri 系统依赖与 Node 24 环境执行 CI job 对应全部命令（预期包括 `npm ci`、`npm run build`、`npm run test`、`cargo check --all-targets`、`cargo test --all-targets`；以 workflow 实际内容为准）。
- 执行 `npx --yes @fission-ai/openspec@1.5.0 validate issue-158 --strict --no-interactive`，最终 Verify 另执行全量 `validate --all --strict --no-interactive`。
- 新增行为的 Rust/前端定向测试须覆盖上表场景；更新检查测试禁止依赖网络。无需媒体标签 fixture。
