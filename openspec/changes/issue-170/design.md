# Issue #170 实施设计

## 1. 范围与域

本变更是 `both` 域：Tauri/Rust 原生菜单、配置边界和事件发射，以及 Vue API/store/components 的菜单分发与更新提示。Rust 必须先于 Vue：先确定菜单 action、状态同步接口和配置持久化契约，再接入前端；前端不得绕过 `src/api/client.ts` 直接使用 Tauri API。范围仅限 `app-menu` 与 `update-check` 已批准场景，不新增批量编辑、更新下载/安装或新的更新服务。

## 2. 已批准行为的实现边界

### 2.1 原生菜单与事件

- 在 `src-tauri/src/lib.rs` 的 desktop 菜单构造 File/Edit/View/Help；macOS 保留应用菜单中的 About/Services/Hide/Quit，About 使用稳定 `show-about` action 以经过 EULA 门禁，Windows/Linux 不要求该首项。
- 菜单项使用稳定 action ID，经单一 `app-menu-action` Tauri event 发给前端。`update-menu-action` 仅作为迁移前的既有契约，不再新增调用点；是否保留兼容监听由实现测试证明，不改变批准行为。
- 菜单只调用既有能力：打开文件夹、当前编辑保存/撤销/重做、当前目录重扫、主题切换、更新/关于、reload、关闭/退出和开发者工具。动作到达前端后仍须再次检查状态，不能依赖过期的原生 enabled 快照。
- EULA 未同意时 About 禁用；无可编辑当前歌曲时 Save 禁用；开发者工具仅 dev 构建可见。标准编辑项优先使用 Tauri 原生 menu role，不在前端重实现系统编辑语义。

### 2.2 更新检查节流与提示

- 最近成功检查时间使用现有 Rust `service/config.rs` 的 config.json 原子读写边界，存 UTC 时间戳；无效、缺失或未来时间按“需要自动检查”处理。无更新和有更新都算成功，网络/HTTP/解析错误不写入时间。
- 自动启动检查仅在首次成功检查不存在或已满 7×24 小时时执行；手动菜单检查不受节流。检查不得阻塞工作区。
- 更新结果状态与 toast 可见性分离：有更新 toast 15 秒关闭、无更新 toast 5 秒关闭、错误不自动关闭；关闭后仍保留可用版本及顶栏无障碍标记，点击标记可恢复提示。“稍后”继续写入既有版本记忆，不清除结果/标记；详情仍只经既有安全 URL command 打开。
- 提示计时器由 `UpdateToast.vue` 管理并在重新展示、结果切换和卸载时清理；store 是恢复入口的数据源，避免旧 timer 覆盖新结果。

## 3. 数据流与顺序

1. Rust 启动构造原生菜单，注册 `on_menu_event`，发射 `app-menu-action`；配置 service 提供成功时间的读写能力。
2. 前端 `api/client.ts` 增加/复用类型化事件与配置 facade；`store/updates.ts` 初始化读取时间，判断自动检查资格；手动 action 始终调用检查。
3. 检查成功后由约定的 Rust/config 边界写入时间，再由 store 发布结果；失败只发布错误，不更新时间。
4. `App.vue` 集中监听并分发菜单 action；`AppBar.vue` 展示恢复入口；`UpdateToast.vue` 负责按结果计时和手动操作；现有 About/EULA、song、theme store 能力保持单向依赖。
5. 菜单状态同步由 App/相关 store 的响应式状态驱动；所有菜单 action 分发都做 stale-state guard。

## 4. 文件所有权与落位

### Rust（Rust agent）

- `src-tauri/src/lib.rs`：菜单树、平台差异、事件发射、菜单状态同步接线。
- `src-tauri/src/service/config.rs`：config.json schema 扩展、UTC 时间戳原子读写；不得把配置文件 IO 放入 command 以外的前端。
- 经主会话确认，允许在既有配置边界内增加最小 `get_last_update_check_at()` / `save_last_update_check_at(value)` command；不得另建第二套存储。字段名为 `last_update_check_at`，值为 UTC RFC3339 字符串。
- `src-tauri/tests/*`：菜单/配置/事件映射的 Rust 测试；纯逻辑仍外置集成测试，禁止生产 `#[cfg(test)]`。

### Vue（Vue agent，依赖 Rust 契约完成后）

- `src/api/client.ts`、`src/api/updates.ts`：事件和更新/配置 IPC 类型封装。
- `src/store/updates.ts`：自动检查资格、最近成功时间结果、请求竞态和恢复状态；不直接做文件 IO。
- `src/App.vue`：唯一菜单事件订阅与 action 分发；`src/components/AppBar.vue`：顶栏标记；`src/components/UpdateToast.vue`：toast 生命周期；必要时 `AboutDialog.vue` 只接现有结果展示。
- 同目录 `*.test.ts`：api/store/components 测试；不得修改不相关标签、搜索和目录监听逻辑。

## 5. 验证计划

- Rust：配置缺失/损坏/未来时间、成功写入、失败不写入、7 天边界（小于 7 天不查、恰好 7 天查）、手动绕过；菜单 action ID、macOS/非 macOS 菜单差异和 enabled/visible 状态。使用注入配置路径和 fake client，不访问真实 GitHub/浏览器。
- 前端：启动跳过/触发、手动覆盖、成功/失败状态、`app-menu-action` 分发、EULA/保存门禁、toast 5/15 秒计时、timer 清理、红点恢复与 Later 记忆。保持 Tauri API mock 只位于 `api/client.ts` import 边界。
- 集成质量门：`cargo check --manifest-path src-tauri/Cargo.toml`、`cargo test --manifest-path src-tauri/Cargo.toml`、`npm run test`、`npm run build`、`npx --yes @fission-ai/openspec@1.5.0 validate issue-170 --strict --no-interactive`。按适用范围运行结构守卫；失败不得以人工标记替代。

## 6. 决策记录

- 主会话确认采用配置 facade 方案：允许新增最小配置读写 command `get_last_update_check_at()` / `save_last_update_check_at(value)`，字段 `last_update_check_at` 使用 UTC RFC3339 字符串；Vue 不直接读写 config.json。macOS About 使用自定义稳定 action `show-about`，由 Rust guard 发射 `app-menu-action`，避免系统 About 绕过 EULA。
- Windows/Linux“关闭窗口”调用当前窗口 close，“退出”调用 AppHandle exit；macOS 保留系统应用菜单 About/Services/Hide/Quit。
