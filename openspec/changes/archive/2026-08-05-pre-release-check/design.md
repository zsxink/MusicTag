# design — pre-release-check（发布前检测）

> V1 发布前统一收口：首次授权弹窗（新功能）+ README/LICENSE 协议声明（文案已备）+ 两个 bug 修复（已完成）。
> **域 = frontend**（授权弹窗 = 纯前端组件 + localStorage 持久化；README/LICENSE 为文档；bug1/bug2 为前端 CSS/组件）。
> 零 Rust 改动、零 Tauri command 变更（command-contract 守卫 13 个不变）。

## 现状

- **README/LICENSE**：内容已在本分支提交（`feat(107)` `79243ba`）——README 个人学习定位/不提供音频/外部 API 免责/禁 AI 转写/软件协议章节/顶部图标，LICENSE 基于 BUSL 1.1 + Change Date 2099-12-31 + 附加禁转卖/AI 转写条款。已随规格受控，CR 对照 spec 复核即可。
- **bug1 滚动**：`src/App.vue` `.editor-slot` 补 `display:flex` 已提交，`ui-editor-layout.test.ts` 断言 flex 容器已同步。
- **bug2 折叠**：`LyricPanel`/`CoverPanel` 加 `watch(current.path)` 重置折叠已提交，`lyric-panel.test.ts`/`cover-panel.test.ts` 已补切歌重置用例，candidate-collapse spec / V1-PRD FR-15 / design.md 已同步。
- **授权弹窗**：**未实现，本变更唯一剩余开发**，且是纯前端新逻辑。

## 技术方案

### D1. 授权弹窗（eula-gate）

**目标**：首次启动弹授权确认窗口，同意才进主界面、拒绝退出；同意状态本地持久化，二次启动不弹。

**分层落位（服从 design.md §10.0）**：

- **持久化逻辑放 `store/eula.ts`**（仿 `store/theme.ts` env 注入模式）。§10.0 规定 localStorage 属 Web API，**只允许在 store/ 层触碰、lib/ 禁止**（theme.ts 注释明示）——故授权状态读写不落 lib/，放 store/。职责：
  - `EULA_STORAGE_KEY = 'music-tag-eula-accepted'`（对齐既有 key 前缀 `music-tag-`，参照 `THEME_STORAGE_KEY='music-tag-theme'`）；存储值仅 `'1'`（已同意）/ 缺失（未同意），不存在「拒绝后记忆」——拒绝即退出，二次启动仍弹。
  - `EulaEnv` 接口 `{ readAccepted(): string | null; writeAccepted(): void; closeWindow(): void }`，默认实现走 `window.localStorage`（try/catch 静默降级，仿 theme：隐私模式等存储不可用时本轮不弹、重启后重弹，可接受）+ Tauri `getCurrentWindow().close()`。
  - 三个纯函数：`isEulaAccepted(env?)`（同步读，true 当且仅当值为 `'1'`）、`acceptEula(env?)`（写 `'1'`）、`rejectEula(env?)`（`closeWindow()`）。均带可选 env 参数（默认 `defaultEnv()`），测试注入桩（同 theme.test.ts `makeEnv` 模式）。
- **弹窗组件 `src/components/EulaDialog.vue`**（新增，组件树挂在 App.vue 顶层，与 SwitchDialog 平级）：
  - **自门禁**：`setup` 同步执行 `showDialog = ref(!isEulaAccepted())`——已同意则组件直接 `v-if` 不渲染（「二次启动不弹」）；未同意则渲染**全窗口模态遮罩**（复用 SwitchDialog `.overlay` 的 `position:fixed; inset:0` + `role="dialog" aria-modal` 模式），主界面被遮罩不可交互（spec「主界面不可交互」）。
  - **同意** → `acceptEula()` + `showDialog=false`（进入主界面）；**拒绝** → `rejectEula()`（`getCurrentWindow().close()` 关窗）。
  - 分层合规：组件只依赖 `store/eula`（组件→store 方向合法，守 §10.0）；**不 import `@tauri-apps/api/core`**（layering 守卫禁 invoke 直呼）；`@tauri-apps/api/window` 经 store env 注入而非组件直引，单测零 mock Tauri 模块（CoverPanel 直引 window 是既有先例，本变更采用更可测的注入）。
  - 文案：协议要点（个人学习用途 / 禁止商用 / 禁止私自销售转卖 / 禁止 AI 转写 / 外部 API 免责声明）按 README「使用声明与免责条款」同源表述，不放全文、放要点 + 说明详见 README/LICENSE。
- **App.vue 挂载与启动时序**：`App.vue` 顶层**无条件挂载** `<EulaDialog />`（同 `<SwitchDialog v-if>` 的挂载点，一行引入）。门禁判定在 EulaDialog `setup` 内**同步完成**（localStorage 同步读）——与 App 其余部分同一次 Vue commit 渲染，未同意时遮罩与主界面同帧出现，**无「主界面先闪现再盖遮罩」**的启动闪烁。
- **测试放置（§10.4 co-located）**：
  - `src/store/eula.test.ts`：注入 env 桩，覆盖 `isEulaAccepted`（未同意/已同意 `'1'`/存储不可用静默降级）、`acceptEula` 写 `'1'`、`rejectEula` 调 `closeWindow`。
  - `src/components/eula-dialog.test.ts`：`vi.mock('../store/eula')` 或注入桩，覆盖「未同意 → 渲染遮罩 + 同意按钮 → 写持久化 + 关遮罩」「拒绝 → 调 closeWindow」「已同意 → 不渲染」。
  - `src/components/app.test.ts`：既有 App 挂载测试会真实渲染 EulaDialog——补一条断言（默认未同意 → EulaDialog 遮罩存在），并保证未涉及 EULA 的旧断言不被遮罩干扰（断言查询均为 data-testid 定位，遮罩为独立 overlay 不遮蔽文本断言）。

### D2. README/LICENSE（文案，已备）

已在分支提交，随 pipe 归档 PR 一并合入。无需开发，CR 对照 spec 复核文案齐全（个人学习/禁商用/禁转卖/禁 AI 转写/外部 API 免责/图标 `icon/musictag.png`）。

### D3. bug1 滚动修复

`.editor-slot` 加 `display:flex`（已提交）。根因：缺 flex 容器 → `.editor` 的 `flex:1 1 auto` 失效、按内容撑高，`.editor-body` 的 `overflow-y:auto` 永不触发，歌词框被窗口高度裁剪。测试已补，verify 复核。

### D4. bug2 折叠调整

`LyricPanel`/`CoverPanel` 加 `watch(() => songStore.current?.path, () => candidatesCollapsed.value = false)`（已提交）。产品决策：切歌后默认展开（原「跨切歌保持」实测不好用已废）。测试与 candidate-collapse spec / V1-PRD FR-15 / design.md 已同步，verify 复核。

## 变更域判定

**域 = frontend**：
- 授权弹窗是**纯前端**：EulaDialog 组件 + `store/eula.ts`（localStorage 持久化 + window 关闭），**零 Rust、零 Tauri command**。
- README/LICENSE 是文档、bug1 是前端 CSS、bug2 是前端组件。
- **command-contract 守卫 13 个不变**（`lib.rs` `generate_handler!` 13 个与 design.md §10.3 / V1-PRD §7 / config.yaml 三源一致，本变更不触碰）；layering 守卫（组件零 invoke 直呼）对 EulaDialog 无碍——不引 `@tauri-apps/api/core`。

**依赖顺序**：单 Vue-Dev 串行完成即可（EulaDialog → store/eula → App 挂载 → 测试），无需 Rust-Dev、无需 worktree。

## 关键技术决策

1. **授权状态放前端 localStorage（零 command）**：key `music-tag-eula-accepted`。授权是纯展示/会话门禁，无需跨设备同步；避免新增 command 牵动 command-contract 守卫与三处契约表同步，最小化改动面。局限（重装/清 WebView 存储重置同意）对个人学习软件可接受。Tauri 2 WebView 的 localStorage 落盘持久，跨重启有效，「二次启动不弹」成立。
2. **落位 `store/eula.ts` 仿 theme.ts env 注入**：localStorage 读写 + window 关闭经 `EulaEnv` 注入，单测传桩零依赖真实 DOM/Tauri 模块（同 theme.test.ts 模式）；同时满足 §10.0「Web API 只允许 store/ 层、lib/ 禁止」。
3. **EulaDialog 自门禁 + App 无条件挂载**：`showDialog = ref(!isEulaAccepted())` 在 setup 同步算，遮罩与主界面同帧渲染，无启动闪烁；已同意则组件自渲染空，App 侧零分支。
4. **拒绝即关闭应用**：Tauri `getCurrentWindow().close()`（经 store env 注入），简单明确，与 spec「拒绝则退出应用」一致。
5. **零 Rust 改动**：本变更不触碰 src-tauri，command-contract 守卫与契约表不变（13 个保持）。

## 任务拆分建议

### T1 授权弹窗（唯一剩余开发，纯前端）
- [ ] 1.1 `src/store/eula.ts`：`EULA_STORAGE_KEY` + `EulaEnv`（readAccepted/writeAccepted/closeWindow）+ `defaultEnv()`（localStorage try/catch 静默降级 + `getCurrentWindow().close()`）+ `isEulaAccepted`/`acceptEula`/`rejectEula`
- [ ] 1.2 `src/components/EulaDialog.vue`：协议要点（个人学习/禁商用/禁转卖/禁 AI 转写/外部 API 免责）+ 「同意并继续 / 拒绝」；自门禁 `showDialog`；全窗口模态遮罩（复用 SwitchDialog overlay 模式，`role="dialog" aria-modal`）
- [ ] 1.3 `App.vue` 顶层挂载 `<EulaDialog />`（一行，同 SwitchDialog 挂载点）
- [ ] 1.4 测试：`src/store/eula.test.ts`（env 桩：未同意/已同意/存储不可用降级/accept 写 `'1'`/reject 调 closeWindow）+ `src/components/eula-dialog.test.ts`（未同意渲染+同意关遮罩+拒绝关窗+已同意不渲染）+ 更新 `src/components/app.test.ts`（默认未同意 → 遮罩存在）
- [ ] 1.5 验证：`npm run test` + `npm run build`（layering/command-contract/design-layering 守卫全绿）

### T2 README/LICENSE（文案，已提交）
- [ ] 2.1 CR 对照 spec 复核 README/LICENSE 齐全（个人学习/禁商用/禁转卖/禁 AI 转写/外部 API 免责/图标 `icon/musictag.png`；LICENSE BUSL 1.1 + Change Date 2099-12-31 + 附加限制）

### T3 bug1 滚动 + bug2 折叠（已提交）
- [ ] 3.1 复核 `src/App.vue` `.editor-slot` 含 `display:flex` + `ui-editor-layout.test.ts` 绿（verify 复核）
- [ ] 3.2 复核 `LyricPanel`/`CoverPanel` `watch(current.path)` 重置折叠 + `lyric-panel.test.ts`/`cover-panel.test.ts` 绿 + spec 已同步（candidate-collapse spec / V1-PRD FR-15 / design.md）

### T4 提交与收尾
- [ ] 4.1 全量验证：`npm run test` + `npm run build` + `cargo test` + `openspec validate --strict`
- [ ] 4.2 归档 `/opsx:archive pre-release-check` → 提交 PR（`Closes #107`）→ 等 CI → merge
