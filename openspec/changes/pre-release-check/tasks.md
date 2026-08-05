# 任务（发布前检测：授权弹窗 + 协议声明 + bug 修复）

> 域 = frontend。唯一新增开发是授权弹窗（纯前端：EulaDialog + localStorage，零 Rust/零 command 变更）；README/LICENSE 与 bug1/bug2 已在工作树完成，verify/CR 复核即可。

## T1 授权弹窗（新开发，纯前端）

- [ ] 1.1 `src/components/EulaDialog.vue`：协议要点（个人学习/禁商用/禁转卖/禁 AI 转写/外部 API 免责）+ 「同意并继续 / 拒绝」按钮
- [ ] 1.2 `App.vue` 挂载 + 启动时序：启动查 `localStorage.musictag.eula_accepted`；未同意 → EulaDialog 全窗口遮罩主界面；同意 → `localStorage.setItem('musictag.eula_accepted','1')` + 进主界面；拒绝 → Tauri `getCurrentWindow().close()` 关闭应用
- [ ] 1.3 测试：EulaDialog 组件测试（同意→持久化+进主界面、拒绝→关闭应用、已同意→不弹、localStorage mock）

## T2 README/LICENSE（文案已备）

- [ ] 2.1 对照 spec 复核 README/LICENSE 齐全：个人学习定位 / 禁止商用 / 不提供音频文件 / 外部 API 基于公开资料免责 / 禁止 AI 转写 / 软件协议（BUSL 1.1）/ 图标 `icon/musictag.png`

## T3 bug1 滚动 + bug2 折叠（已完成）

- [ ] 3.1 复核 `src/App.vue` `.editor-slot` 含 `display:flex` + `ui-editor-layout.test.ts` 断言绿
- [ ] 3.2 复核 `LyricPanel`/`CoverPanel` `watch(current.path)` 重置折叠 + 测试绿 + spec 同步（candidate-collapse spec / V1-PRD FR-15 / design.md）

## T4 提交与收尾

- [ ] 4.1 全量验证：`npm run test` + `npm run build` + `cargo test` + `openspec validate --strict`
- [ ] 4.2 归档 `/opsx:archive pre-release-check` → 提交 PR（`Closes #107`）→ 等 CI → merge
