# 任务（发布前检测：授权弹窗 + 协议声明 + bug 修复）

> 域 = frontend。唯一新增开发是授权弹窗（纯前端：`store/eula.ts` + `EulaDialog.vue`，localStorage 持久化，零 Rust/零 command 变更）；
> README/LICENSE 与 bug1/bug2 已在本分支提交（`feat(107)`），verify/CR 复核即可。

## T1 授权弹窗（唯一剩余开发，纯前端）

- [ ] 1.1 `src/store/eula.ts`：`EULA_STORAGE_KEY='music-tag-eula-accepted'` + `EulaEnv`（`readAccepted`/`writeAccepted`/`closeWindow`）+ `defaultEnv()`（`window.localStorage` try/catch 静默降级 + Tauri `getCurrentWindow().close()`）+ `isEulaAccepted`/`acceptEula`/`rejectEula`（均带可选 env 参数，测试注入桩，仿 store/theme.ts）
- [ ] 1.2 `src/components/EulaDialog.vue`：协议要点（个人学习/禁商用/禁转卖/禁 AI 转写/外部 API 免责）+ 「同意并继续 / 拒绝」按钮；`setup` 同步 `showDialog = ref(!isEulaAccepted())` 自门禁；全窗口模态遮罩（复用 SwitchDialog overlay：`position:fixed; inset:0` + `role="dialog" aria-modal`）；同意 → `acceptEula()`+关遮罩、拒绝 → `rejectEula()`；**不 import `@tauri-apps/api/core`**（layering 守卫）
- [ ] 1.3 `App.vue` 顶层无条件挂载 `<EulaDialog />`（一行，同 SwitchDialog 挂载点）
- [ ] 1.4 测试：
  - `src/store/eula.test.ts`（env 桩：未同意 false / 已同意 `'1'` true / 存储不可用静默降级 / acceptEula 写 `'1'` / rejectEula 调 closeWindow）
  - `src/components/eula-dialog.test.ts`（未同意 → 渲染遮罩、同意 → 写持久化+关遮罩、拒绝 → 调 closeWindow、已同意 → 不渲染）
  - `src/components/app.test.ts`（补：默认未同意 → EulaDialog 遮罩存在；旧断言不受遮罩干扰）
- [ ] 1.5 验证：`npm run test` + `npm run build`（command-contract / layering / design-layering 守卫全绿，command 仍 13 个）

## T2 README/LICENSE（文案已提交）

- [ ] 2.1 对照 spec 复核 README/LICENSE 齐全：个人学习定位 / 禁止商用 / 不提供音频文件 / 外部 API 基于公开资料免责 / 禁止 AI 转写 / 软件协议（BUSL 1.1）/ 图标 `icon/musictag.png`；LICENSE 含 BUSL 1.1 结构、Change Date 2099-12-31、禁转卖、禁 AI 转写

## T3 bug1 滚动 + bug2 折叠（已提交）

- [ ] 3.1 复核 `src/App.vue` `.editor-slot` 含 `display:flex` + `ui-editor-layout.test.ts` 断言绿
- [ ] 3.2 复核 `LyricPanel`/`CoverPanel` `watch(current.path)` 重置折叠 + `lyric-panel.test.ts`/`cover-panel.test.ts` 绿 + spec 已同步（candidate-collapse spec / V1-PRD FR-15 / design.md）

## T4 提交与收尾

- [ ] 4.1 全量验证：`npm run test` + `npm run build` + `cargo test --manifest-path src-tauri/Cargo.toml` + `openspec validate --strict`
- [ ] 4.2 归档 `/opsx:archive pre-release-check` → 提交 PR（`Closes #107`）→ 等 CI → merge
