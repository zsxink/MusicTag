# design — pre-release-check（发布前检测）

> V1 发布前统一收口：首次授权弹窗（新功能）+ README/LICENSE 协议声明（文案已备）+ 两个 bug 修复（已完成）。域 = both（授权弹窗跨 Rust config 持久化 + 前端弹窗组件）。

## 现状

- **README/LICENSE**：内容已在工作树完成（README 协议声明 + 图标、LICENSE 基于 BUSL 1.1 + 禁转卖/AI 转写）。未入规格、未提交。
- **bug1 滚动**：`src/App.vue` `.editor-slot` 补 `display:flex` 已改，测试已补（ui-editor-layout.test.ts 断言 flex 容器）。未提交。
- **bug2 折叠**：`LyricPanel`/`CoverPanel` 加 `watch(current.path)` 重置折叠已改，测试与 spec 已同步。未提交。
- **授权弹窗**：未实现，本变更唯一新增开发。

## 技术方案

### D1. 授权弹窗（eula-gate）

**目标**：首次启动弹授权确认窗口，同意才进入主界面；拒绝退出；同意状态本地持久化。

**实现路径**：

- **同意状态持久化**：**前端 localStorage**（零 Tauri command，零 IPC 契约变更，command-contract 守卫 13 不变）。用独立 key（如 `musictag.eula_accepted`）存布尔值。同意 → `localStorage.setItem('musictag.eula_accepted', '1')`；启动 → `localStorage.getItem(...)` 判断。
  - **决策依据**（用户拍板）：授权状态是纯展示/会话门禁，无需跨设备同步，localStorage 足够；避免新增 command 牵动 command-contract 守卫与三处契约表同步，最小化改动面。
  - 局限：重装应用/清浏览器存储会重置同意（二次弹窗），对个人学习软件可接受。
- **前端弹窗**：`App.vue` 挂载一个授权确认组件（`EulaDialog.vue`），在 `eula_accepted` 未确认时全窗口模态展示协议要点 + 「同意并继续 / 拒绝」。同意 → localStorage 持久化 + 进入主界面；拒绝 → 关闭应用（Tauri `getCurrentWindow().close()`）。
- **启动时序**：应用启动先查 `localStorage.musictag.eula_accepted`；未同意 → 渲染 EulaDialog 遮罩主界面；已同意 → 直接主界面。

### D2. README/LICENSE（文案，已备）

内容已在工作树，随 pipe 提交。无需额外开发，CR 对照 spec 复核文案齐全即可。

### D3. bug1 滚动修复

`.editor-slot` 加 `display:flex`（已改）。根因：缺 flex 容器导致 `.editor` 的 `flex:1 1 auto` 失效、`.editor-body` 的 `overflow-y:auto` 永不触发，歌词框被裁剪。测试已补。

### D4. bug2 折叠调整

`LyricPanel`/`CoverPanel` 加 `watch(() => songStore.current?.path, () => candidatesCollapsed.value = false)`（已改）。产品决策：切歌后默认展开（原跨切歌保持实测不好用）。测试与 spec 已同步。

## 变更域判定

**域 = frontend**：
- 授权弹窗是**纯前端**（EulaDialog 组件 + localStorage 持久化 + App.vue 启动时序）。
- README/LICENSE 是文档、bug1 是前端 CSS、bug2 是前端组件。
- **零 Rust 改动、零 Tauri command 变更**（command-contract 守卫 13 不变）。

单 Vue-Dev 串行完成即可，无需 Rust-Dev、无需 worktree。

## 关键技术决策

1. **授权状态放前端 localStorage**（零 command）：`musictag.eula_accepted` key。授权是纯展示门禁，无需跨设备同步；避免新增 command 牵动 command-contract 守卫与契约表。局限（重装/清存储重置）对个人学习软件可接受。
2. **EulaDialog 全窗口模态遮罩**：同意前主界面不可交互，符合「同意才能使用」。
3. **拒绝即关闭应用**：Tauri `getCurrentWindow().close()`，简单明确。
4. **零 Rust 改动**：本变更不触碰 src-tauri，command-contract 守卫与契约表不变（13 个保持）。

## 任务拆分建议

### T1 授权弹窗（新开发，纯前端）
- [ ] 1.1 前端：`src/components/EulaDialog.vue` 组件（协议要点 + 「同意并继续 / 拒绝」按钮）
- [ ] 1.2 `App.vue` 挂载 + 启动时序：启动查 `localStorage.musictag.eula_accepted`，未同意 → EulaDialog 全窗口遮罩，同意才进主界面；同意 → 写 localStorage；拒绝 → `getCurrentWindow().close()`
- [ ] 1.3 测试：EulaDialog 组件测试（同意→持久化+进主界面、拒绝→关闭应用、已同意→不弹、localStorage mock）

### T2 README/LICENSE（文案，已备）
- [ ] 2.1 CR 对照 spec 复核 README/LICENSE 齐全（个人学习/禁商用/禁转卖/禁 AI 转写/外部 API 免责/图标）

### T3 bug1 滚动 + bug2 折叠（已完成）
- [ ] 3.1 确认 `App.vue` `.editor-slot` flex + 测试绿（已改，verify 复核）
- [ ] 3.2 确认折叠 watch 重置 + 测试绿 + spec 已同步（已改，verify 复核）

### T4 提交与收尾
- [ ] 4.1 归档 /opsx:archive → 提交 PR（Closes #107）→ CI → merge
