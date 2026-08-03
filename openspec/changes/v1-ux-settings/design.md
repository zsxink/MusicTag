# v1-ux-settings 技术设计

## Context

编辑闭环（读/存/封面/歌词/改名）已就绪。本变更补两个贯穿性 UX：**切歌/换目录未保存三选一弹窗**（FR-6、FR-1-5a）与**双主题**（FR-7：深色默认、浅色跟随、手动切换、重启记忆），并整体打磨（空态、120ms 过渡、无障碍）。

现有代码事实（本变更的落位基础）：

- `store/song.ts` 已有 `dirty` getter（`current`/`original` 逐字段对比，reactive 内 getter，不可挪出）、`save()`（**完整保存编排**：saveState 四态 `idle/saving/saved/save_failed`、exportLrc 同步写 `.lrc`、rename 联动、封面全量覆盖）、`selectSong` / `activateFolder`（loader 注入编排）。
- `SongRow.vue select()` 直连 `selectSong(path, openSong)`；`SongList.vue openFolder()` 直连 `activateFolder(picked, listSongs)`——**均无 dirty 拦截**（本变更切入点）。
- `styles/theme.css` 已实现「深色缺省（`:root`）+ 浅色跟随系统（`@media (prefers-color-scheme: light)`）」，并有结构守卫 `src/styles/theme.test.ts` 锁两个不变量（`:root` 顶层 = 深色 token、浅色 token 在 media 块内）；`AppBar.vue` 主题按钮是**占位**（☀️，无切换逻辑）。
- `design.md` §10.1 组件树已预留 `SwitchDialog.vue` 挂在 App 层；§10.0 分层与结构守卫（`components/layering.test.ts` 组件零 invoke 直呼）约束本变更所有落位。

复用不动：`store.save` 整个通道（弹窗「保存」直接复用）、`activateFolder`/`selectSong`、`theme.css` 既有 token、`lib/path.ts` 的 `fileName`（弹窗消息取文件名）。**零新增 Tauri command、零 Rust 改动。**

## Goals / Non-Goals

**Goals:**
- 切歌/换目录未保存三选一弹窗（统一抽象复用）。
- 双主题：深色默认 + 浅色跟随系统 + 手动切换持久记忆。
- 打磨：空态/过渡/reduced-motion/无障碍。

**Non-Goals:**
- 不引入 `tauri-plugin-store`（localStorage 足够）。
- 不做主题之外的其他设置项。
- 不改后端：不新增 command、不动 `save_song` 写盘逻辑、不引新 Rust 依赖。

## 变更域判定

**frontend（纯前端）**。

- 零 Rust 改动：弹窗「保存」复用既有 `save_song` 通道（`store.save` → `api/songs.ts` → invoke），换目录复用 `activateFolder`，无新 IPC 契约。
- 主题仅 localStorage + CSS + matchMedia，全部前端。
- **不存在 Rust→Vue 依赖序**：无需等任何后端契约定型，仅前端实现；单 worktree 内串行（未显式创建 worktree 时禁止并行，`music-tag-branch-switch` 记忆）。
- 前置依赖（均已归档/合入 main）：`v1-song-save`（save 通道/saveState）、`v1-folder-list`（activateFolder/listSongs/pickFolder）、`v1-refactor-layering`（§10 分层与守卫）、`v1-rename-sync`（save 内 rename 联动）、`v1-cover-embed`（save 已含封面全量覆盖）。

## 技术方案

### 1. 切歌/换目录三选一弹窗（前端）

**数据流**：单一 pending 状态机编排放 store，切歌与换目录两个入口共享：

```
SongRow.select / SongList.openFolder
  → store.requestSwitch(path, loadSong?) / requestFolder(dir, loadSongs?)
      ├─ 无 dirty → 直接执行（selectSong / activateFolder，行为不变，spec「无修改直接切」）
      └─ dirty   → pendingAction = { kind: 'switch'|'folder', path|dir, loader 闭包 }
                      → App.vue 渲染 <SwitchDialog/>（v-if 由 pendingAction !== null 驱动）
                          ├─「保存」  → resolvePending('save')
                          │     ├─ await save(raw.exportLrc)（完整复用：saveState 四态 + exportLrc + rename 联动）
                          │     ├─ 失败（saveState='save_failed'）→ 弹窗保持打开、不切换、顶栏「✕ 保存失败」
                          │     └─ 成功 → 执行 pending 动作 → 清 pending
                          ├─「不保存」→ resolvePending('discard')：直接执行 pending 动作（切换即弃置编辑）→ 清 pending
                          └─「取消」/ Esc → cancelPending()：清 pending，留在当前
```

**store 新增（`store/song.ts` 扩展，编排与 `selectSong`/`activateFolder` 同层）**：

```ts
type PendingAction =
  | { kind: 'switch'; path: string; loadSong: (p: string) => Promise<Song> }
  | { kind: 'folder'; dir: string; loadSongs: (d: string) => Promise<SongSummary[]> }
// reactive 状态 + 动作：
// requestSwitch(path, loadSong?)   dirty 拦截门（干净 → selectSong）
// requestFolder(dir, loadSongs?)   dirty 拦截门（干净 → activateFolder）
// resolvePending('save'|'discard') 保存失败不切换（keep pending）；成功/丢弃 → 执行动作 + 清 pending
// cancelPending()                  取消留在当前
```

- loader 闭包存 reactive 合法（仿 `saveFn`/`renameFn` 注入先例），测试可注入桩不依赖 Tauri。
- 「保存」= **完整复用 `store.save`**：saveState 状态机（顶栏「✕ 保存失败」展示）、exportLrc、rename 联动一次带齐，与顶栏保存按钮语义完全一致。
- **边界**：坏标签只读 / 无选中时 `current`/`original` 为 null → `dirty` 恒 false → 不弹窗（spec「无修改直接切」自然满足）；保存中（`saving`）禁用弹窗「保存」按钮（防连点并发写同一文件，`save()` 自身亦有 readonly/current 守卫）。

**`SwitchDialog.vue`（§10.1 App 级组件）**：

- 通用三选一模态：`role="dialog" aria-modal aria-labelledby`（标题指向消息文案）、Esc 取消、初始焦点落「取消」（安全默认，防误触保存/丢弃）。
- 消息「保存对 `<文件名>` 的修改吗？」：文件名用 `lib/path.ts` 的 `fileName(songStore.current.path)`（mono 展示数据感）。
- 三按钮：保存（primary 琥珀）/ 不保存（danger）/ 取消（ghost），直接调 `resolvePending`/`cancelPending`（组件→store 方向合法，守 §10.0）。
- 阴影 `0 18px 48px`、12px 圆角、`role="dialog"` 遮罩覆盖全窗口（spec FR-6.3「模态，覆盖全窗口」）。

### 2. 双主题（前端）

**机制（CSS 三层覆盖 + 状态层）**：

```
CSS（styles/theme.css，顺序即优先级）：
  1. :root { 深色 token }                                  ← 默认（防启动闪白）
  2. @media (prefers-color-scheme: light) { :root { 浅色 token } }  ← 跟随系统
  3. html[data-theme="light"] { 浅色 token }               ← 手动浅色（覆盖 2）
     html[data-theme="dark"]  { 深色 token }               ← 手动深色（覆盖 2，系统浅色时仍深）
```

- 属性选择器（0,1,0）与 `:root`（0,1,0）同特异度，靠**源码顺序后胜**实现「手动优先于系统」；`manualChoice === null`（跟随系统）时**移除 `data-theme` 属性**，回落到 2。
- `theme.css` 既有结构（`:root` 深色、media 浅色）与 `theme.test.ts` 结构守卫保留，**追加** `[data-theme]` 覆盖块置于 media 之后；守卫测试同步新增「`[data-theme="dark"]` 块位于 media 之后」不变量（锁手动覆盖不回归）。

**状态层（`store/theme.ts` + `lib/theme.ts`）**：

- `lib/theme.ts`（纯逻辑，无 Vue/Tauri/DOM 依赖，守 §10.0 lib 层）：`parseTheme(raw)`（校验 localStorage 值 → `'dark'|'light'|null`）、`resolveTheme(manual, systemPrefersLight)`（→ 当前生效 `'dark'|'light'`）。
- `store/theme.ts`（reactive 单例，仿 song.ts 模式）：持 `manualChoice`/`effective` 状态 + `initTheme()` + `setTheme(choice)`。localStorage 读写、`matchMedia` 访问、`document.documentElement.dataset.theme` 应用都在此层（store 允许触碰 DOM/Web API，lib 不允许）。
- **持久记忆**：localStorage key `music-tag-theme`，值 `'dark'`/`'light'`；手动选择 `null` = 删除 key（跟随系统）。PRD §7 主题记忆「localStorage 或 tauri-plugin-store」二选一——**取 localStorage**（V1 单机单窗口、无跨端共享/迁移需求，避免引入 store 插件依赖）。
- **`initTheme()` 时序**：`main.ts` 在 `app.mount()` **之前**同步调用（localStorage 同步读 + 同步设 `data-theme`）——浅色手动选择的用户**启动不闪深**（防闪白是深色默认的对称保证）；同时注册 `matchMedia('(prefers-color-scheme: light)')` 的 `change` 监听。
- **`setTheme(choice)`**：写/删 localStorage + 更新 `effective` + 应用 `data-theme`。
- **`matchMedia` 监听条件化（D7）**：`change` 处理器首行判 `manualChoice === null`，非空即 no-op——手动选择后系统偏好不再漂移主题（spec「未手动选择时继续跟随系统」的反向保证）。

**`AppBar.vue`**：占位按钮接 store——`effective === 'dark'` 显示 ☀️、`'light'` 显示 🌙（**图标 = 目标主题**：深色时点☀️去浅色、浅色时点🌙去深色，与现有占位 ☀️ 语义一致），点击 `setTheme(effective === 'dark' ? 'light' : 'dark')`。

### 3. 打磨与无障碍（前端）

过渡统一 120ms；按钮按压位移 1px；`prefers-reduced-motion` 减弱过渡与动画；弹窗阴影 `0 18px 48px`、12px 圆角；空态图标（40px 35% 透明）/ 标题 / 副说明统一；状态文字 + 颜色双重表达；焦点琥珀描边（design.md §4/§6/§7/§8 全部已有定义，本变更落位到 CSS 与组件）。

## 关键决策

### D1 拦截编排放 store，不放组件

`requestSwitch`/`requestFolder`/`resolvePending`/`cancelPending` + `pendingAction` 编排在 `store/song.ts`，而非在 `SongRow`/`SongList` 内各自判断。**为什么**：切歌与换目录两个入口共享同一 dirty 拦截与 pending 状态机（spec 要求「换目录复用同一弹窗」），放 store 天然共享且行为一致；loader 闭包注入保持可测（仿 `selectSong`/`activateFolder`/`saveFn` 先例，`song.test.ts` 可注入桩不依赖 Tauri）；组件退化为「点 → 调 store 函数」薄层，守 §10.0 单向依赖。

### D2 SwitchDialog 由 store 驱动、App 级挂载

`pendingAction !== null` 即显示；三按钮直接调 store 动作，不引入独立弹窗状态/事件总线。**为什么**：§10.1 组件树已预留该节点（挂在 App 层、与 Editor 平级，天然在左栏/右栏之上做全窗口遮罩）；模态的「开/关 + 三选一结果」就是 pending 状态机的收尾，无需再复制一份弹窗状态；组件零 IPC 直呼守卫不受影响。

### D3 「保存」= 完整复用 store.save；保存失败不切换

`resolvePending('save')` 调 `save(raw.exportLrc)`（saveState 四态、exportLrc 同步写 `.lrc`、rename 联动、封面全量覆盖一次带齐），成功才执行 pending 动作；失败（`saveState='save_failed'`）→ **弹窗保持打开**（用户可重试「保存」或改选「不保存」「取消」）、不切换、顶栏同步「✕ 保存失败」，`dirty` 保持 true。**为什么**：spec「保存先写再切」/「取消留在当前」+ FR-5.4a「保存失败表单保留可重试、绝不假报已保存」——切走即丢内容，失败时绝不切换；保持弹窗打开让用户在弹窗语境里做后续决策（三个出口），比关弹窗只剩顶栏提示更明确。

### D4 主题状态独立 `store/theme.ts`

主题与歌曲编辑**完全正交**（无任何依赖），塞进 `song.ts` 会让单一 store 承担两类无关职责，违背 `v1-refactor-layering` 的高内聚/低耦合目标。**「单 store 不用 Pinia」指不使用 Pinia 状态管理库**，非物理单文件——`store/theme.ts` 沿用同一 reactive 单例模式（`export const themeStore = raw`），与 `song.ts` 并列，守 §10.0（`store → lib` 单向依赖）。

### D5 CSS 三层覆盖：`:root` 深色 + media 浅色 + `[data-theme]` 手动

属性选择器与 `:root` 同特异度，靠**源码顺序（置于 media 之后）后胜**实现「手动优先于系统」；`manualChoice === null` 移除属性回落跟随系统。**为什么选 `data-theme` 而非 class/`color-scheme` 属性**：与 design.md §2 token 体系直接对应（`--bg` 等按主题整体覆盖），`data-theme="light"` 块可复用现成浅色 token；`theme.test.ts` 结构守卫保留 `:root`/media 两不变量，追加覆盖块不变量，改动最小且可回归。

### D6 持久记忆用 localStorage，不引 tauri-plugin-store

PRD §7 二选一取 localStorage。**为什么**：V1 单机单窗口、无跨端共享/数据迁移需求；localStorage 在 Tauri WebView 原生持久（重启保持）、跨平台（macOS/Win/Linux WebView）行为一致；避免引入 store 插件与其初始化/注册成本（proposal Impact 已定）。

### D7 matchMedia 监听条件化

仅 `manualChoice === null` 时系统偏好切换生效。**为什么**：spec「未手动选择时继续跟随系统」的反向保证——用户一旦手动选择，主题应**钉住**（重启记忆语义），系统偏好不再漂移；否则「手动浅色 + 系统切深色」会意外改主题，违背记忆意图。

### D8 主题按钮图标 = 目标主题

`effective==='dark'` 显示 ☀️、`'light'` 显示 🌙（点击后要切换到的主题）。**为什么**：与现有占位 ☀️（深色默认态显示 ☀️）一致，design.md §5 布局 `[☀️主题]` 同源；「图标指向下一步动作」比「图标表示当前状态」更直觉（深色界面配🌙易误解为当前已浅色）。

## 测试策略（design.md §10.4）

- `src/lib/theme.test.ts`：`parseTheme`（非法值 → null）、`resolveTheme`（四组合）纯逻辑。
- `src/store/theme.test.ts`：`initTheme`/`setTheme` 注入 localStorage + matchMedia 桩（仿 `song.test.ts` 注入模式）——持久化读写、`data-theme` 应用、手动优先于系统、系统监听仅 null 时生效。
- `src/store/song.test.ts` 扩展：`requestSwitch`/`requestFolder` dirty 门（干净直接执行/脏入 pending）、`resolvePending` 三态（保存成功→执行、保存失败→keep pending 不切换、丢弃→执行）、`cancelPending`、readonly/无选中不弹窗。
- `src/components/switch-dialog.test.ts`：三按钮行为、Esc 取消、`role="dialog" aria-modal`、消息文案（文件名）。
- `src/components/appbar.test.ts`（或并入现有组件测试）：主题按钮图标随 `effective`、点击调 `setTheme`。
- `src/styles/theme.test.ts` 更新：新增「`html[data-theme="light"]`/`html[data-theme="dark"]` 覆盖块位于 media 之后」结构不变量（锁手动覆盖）。
- Rust 侧无改动，无新增 Rust 测试。

## 任务拆分建议

纯前端（frontend），单 worktree 串行；主题（组 1，独立自足）→ 弹窗（组 2，复用 save 通道）→ 打磨（组 3）→ 验证（组 4）。

1. **主题（D4–D8）**：`theme.css` 追加 `[data-theme]` 覆盖块 + `theme.test.ts` 新增不变量 → `lib/theme.ts` 纯逻辑 + 单测 → `store/theme.ts` 状态与动作 + 单测 → `AppBar.vue` 按钮接 store + `main.ts` 挂 `initTheme` + 组件测试。
2. **弹窗（D1–D3）**：`store/song.ts` 加 `pendingAction`/`requestSwitch`/`requestFolder`/`resolvePending`/`cancelPending` + 状态机单测 → `SwitchDialog.vue` 组件 + 单测 → `SongRow.vue`/`SongList.vue` 改走拦截 → `App.vue` 挂载。
3. **打磨（§3）**：过渡/reduced-motion/按压位移/弹窗阴影圆角/空态统一/焦点描边落位。
4. **验证**：`npm run test` + `npm run build`；`npm run tauri dev` 人工确认（切歌/换目录三选一各按钮行为、保存失败不切换、主题切换+重启记忆、浅色跟随系统、手动选择后系统偏好不漂移）。

## Risks / Trade-offs

- localStorage 在 Tauri WebView 可用（原生持久化），跨平台行为一致；不引入 store 插件避免依赖。
- 「保存再切」若保存失败：不切换、留在当前并展示保存失败提示（同 `v1-song-save` 语义），避免切走丢内容。
- `[data-theme]` 覆盖块与 media 块 token 存在重复维护成本，靠 `theme.test.ts` 结构不变量锁一致性；深色 token 在 `:root` 与 `[data-theme="dark"]` 两处重复，属 CSS 覆盖语义的合理代价。
- 弹窗保持打开 = 用户可能「困」在弹窗；以顶栏失败提示 + 三个出口（重试/不保存/取消）+ 初始焦点落取消缓解。
