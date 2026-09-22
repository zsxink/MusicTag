# missing-filter-refresh 任务清单

> 变更域：**frontend**。纯前端 UI 增量，无 Rust/store/API 改动。TDD：先写失败测试再实现。

## G1 Vue：刷新按钮与测试

- [ ] 1.1 **先补失败测试**：在 `src/components/songlist.test.ts` 增加刷新场景——① 扫描完成后点「刷新」再次调用 `scan_missing` 并更新命中列表；② 扫描进行中点「刷新」后仅显示最新一次结果（作废旧扫描）；③ 第一次扫描失败后点「刷新」重扫成功，命中列表恢复；④ 未开面板不渲染刷新按钮。
- [ ] 1.2 在 `SongList.vue` 的 `.missing-panel-head`（「关闭」左侧）增加「刷新」按钮，点击调用既有 `retryMissingScan()`（复用 `scanMissing`）；复用 `.missing-close-btn` 视觉类，不新增样式。
- [ ] 1.3 运行 `npm run test` 与 `npm run build`，确认新增/既有测试全绿。
- [ ] 1.4 按 pipe 规范增量提交（`feat(129): ...`），提交含 specs/design/tasks 与代码；PR 使用 `Closes #129`。

## G2 验证与交付

- [ ] 2.1 执行 `npx openspec validate missing-filter-refresh --strict --no-interactive`，全绿。
- [ ] 2.2 归档变更并同步主规格（`openspec/specs/missing-fields-filter/spec.md` 的性能与状态复位 requirement 命中刷新行为）；确认 archive 后重新 validate 通过。
- [ ] 2.3 依赖项：复用 `missing-fields-filter` 既有 promise resolve 式 mock 与 `songStore` 复位 beforeEach，不新增 mock 基建。