# v1-ux-settings 任务（纯前端 frontend）

> 前置依赖：v1-song-save / v1-folder-list / v1-refactor-layering / v1-rename-sync / v1-cover-embed（均已合入 main）。
> 变更域：**frontend**，零 Rust 改动（弹窗「保存」复用 `store.save` → 既有 `save_song`；主题仅 localStorage + CSS + matchMedia）。
> 串行顺序：组 1（主题）→ 组 2（弹窗）→ 组 3（打磨）→ 组 4（验证）。单 worktree，不并行。
> 测试放置：co-located（§10.4）——`src/lib/*.test.ts`、`src/store/*.test.ts`、`src/components/*.test.ts`、`src/styles/*.test.ts`。

## 1. 前端：双主题（独立自足，先行；design.md D4–D8）

- [ ] 1.1 `styles/theme.css`：保留 `:root` 深色缺省 + `@media (prefers-color-scheme: light)` 浅色跟随，**追加** `html[data-theme="light"]`（浅色 token）/ `html[data-theme="dark"]`（深色 token）覆盖块（置于 media 之后，同特异度后胜实现「手动优先于系统」）；`styles/theme.test.ts` 同步新增「`[data-theme]` 覆盖块位于 media 之后」结构不变量
- [ ] 1.2 `lib/theme.ts`（纯逻辑，无 Vue/Tauri/DOM）：`parseTheme(raw)` 校验 → `'dark'|'light'|null`；`resolveTheme(manual, systemPrefersLight)` → `'dark'|'light'`；配 `lib/theme.test.ts`
- [ ] 1.3 `store/theme.ts`（reactive 单例，仿 song.ts）：`manualChoice`/`effective` 状态 + `initTheme()`（main.ts 在 `app.mount()` 前同步调用——localStorage 同步读 + 同步设 `data-theme`，浅色用户启动不闪深；注册 `matchMedia('(prefers-color-scheme: light)')` change 监听，处理器 `manualChoice === null` 才生效）+ `setTheme(choice)`（localStorage key `music-tag-theme` 写/删 + 应用 `data-theme`）；配 `store/theme.test.ts`（注入 localStorage/matchMedia 桩）
- [ ] 1.4 `AppBar.vue`：主题按钮接 store——`effective==='dark'` 显示 ☀️、`'light'` 显示 🌙（图标=目标主题），点击 `setTheme(effective === 'dark' ? 'light' : 'dark')`；配组件测试

## 2. 前端：切歌/换目录三选一弹窗（复用 save 通道；design.md D1–D3）

- [ ] 2.1 `store/song.ts`：新增 `pendingAction`（`{kind:'switch',path,loadSong} | {kind:'folder',dir,loadSongs}`）+ `requestSwitch`/`requestFolder`（dirty 拦截门，干净直接执行 `selectSong`/`activateFolder`）+ `resolvePending('save'|'discard')`（保存=完整复用 `save(raw.exportLrc)`，失败 → keep pending 不切换、顶栏「✕ 保存失败」）+ `cancelPending()`；配 `store/song.test.ts` 状态机用例（保存成功/保存失败不切换/丢弃/取消/readonly 无选中不弹窗）
- [ ] 2.2 `components/SwitchDialog.vue`：模态三选一（保存 primary / 不保存 danger / 取消 ghost），`role="dialog" aria-modal aria-labelledby`、Esc 取消、初始焦点落「取消」、保存中禁用「保存」按钮；消息「保存对 `<文件名>` 的修改吗？」用 `lib/path.ts` 的 `fileName`；阴影 `0 18px 48px`、12px 圆角、遮罩覆盖全窗口；配 `components/switch-dialog.test.ts`
- [ ] 2.3 `SongRow.vue` / `SongList.vue`：`select()`/`openFolder()` 改走 `requestSwitch`/`requestFolder`（不再直连 selectSong/activateFolder）
- [ ] 2.4 `App.vue`：挂载 `<SwitchDialog />`（§10.1 组件树，Editor 平级）

## 3. 打磨与无障碍

- [ ] 3.1 过渡统一 120ms；按钮按压位移 1px；`prefers-reduced-motion` 减弱过渡与动画
- [ ] 3.2 弹窗阴影 `0 18px 48px`、12px 圆角；空态图标（40px 35% 透明）/ 标题 / 副说明统一
- [ ] 3.3 无障碍：状态文字 + 颜色双重表达；焦点琥珀描边

## 4. 验证

- [ ] 4.1 `npm run test` + `npm run build` 通过（含主题结构守卫、store 状态机、组件测试）
- [ ] 4.2 `npm run tauri dev` 人工确认：切歌/换目录三选一各按钮行为（含保存失败不切换）、主题切换 + 重启记忆、浅色跟随系统、手动选择后系统偏好不漂移
