# missing-filter-refresh 任务清单

> 变更域：**frontend**。纯前端 UI 增量，无 Rust/store/API 改动。TDD：先写失败测试再实现。
> 依赖：无 Rust 前置——`scanMissing` store 方法（store/song.ts:388）与 `scan_missing` command 契约（design.md §10 / api/songs.ts:30）均已存在。
> ⚠️ 硬约束（design.md D1）：刷新按钮**不得**复用 `.missing-close-btn` class——`songlist.test.ts:341` 用 `w.get('button.missing-close-btn')` 要求该选择器唯一。

## G1 Vue：刷新按钮与测试

- [ ] 1.1 **先补失败测试**（全部复用既有 `mockInvoke` promise-resolve 基建，`beforeEach` 已复位 `missing-*` 状态，见 songlist.test.ts:287-292）：
  - ① **扫描完成后刷新重扫**：首次 `scan_missing` 返回 `[{ path b, missing:['lyrics'] }]` → 点 `[data-testid="missing-refresh-btn"]` → 断言 attempts=2 且命中列表更新为新返回结果（badge 变化可证）。
  - ② **扫描中点刷新只反映最新**：首次 `scan_missing` 返回 pending Promise（`resolveScan` 手动控制）→ 点刷新触发第二次扫描 → 先 resolve 旧扫描、再 resolve 新扫描 → 断言列表只含第二次结果（旧结果不落地）。
  - ③ **失败后刷新重扫恢复**：attempts=1 时 `scan_missing` throw → 断言「扫描失败」提示 → 点刷新 → 断言 attempts=2、列表恢复命中（可对照既有 `missing-retry-btn` 用例 songlist.test.ts:386）。
  - ④ **未开面板/未开文件夹不渲染**：`missingFilterEnabled=false` 时不渲染刷新按钮（`data-testid` 存在性断言）；按钮渲染在 `.missing-panel` 内。
- [ ] 1.2 在 `SongList.vue` 的 `.missing-panel-head`（「关闭」左侧）增加「刷新」按钮：`<button data-testid="missing-refresh-btn" @click="retryMissingScan">刷新</button>`。点击调既有 `retryMissingScan()`（→ `scanMissing()`）。
  - **class 处理（二选一）**：并入三按钮共享样式选择器（`.missing-panel-head button` 或把 `SongList.vue:239` 共享块加入该 class）；**禁挂 `.missing-close-btn`**。后加的 hover 态进 `:251` 共享 hover 规则。
- [ ] 1.3 运行 `npm run test` 与 `npm run build`，确认新增/既有测试全绿（重点：既有 `close-missing` 用例 `get('button.missing-close-btn')` 不因按钮共存报 multiple elements）。
- [ ] 1.4 按 pipe 规范增量提交（`feat(129): ...`），提交含 specs/design/tasks 与代码；PR 使用 `Closes #129`。

## G2 验证与交付

- [ ] 2.1 执行 `npx openspec validate missing-filter-refresh --strict --no-interactive`，全绿。
- [ ] 2.2 归档变更并同步主规格 `openspec/specs/missing-fields-filter/spec.md` 的「性能与状态复位」Requirement（已含「手动刷新重扫」等三条新场景在 change specs）；确认 archive 后重新 validate 通过。
- [ ] 2.3 依赖项：复用 `missing-fields-filter` 既有 promise resolve 式 mock 与 `songStore` 复位 beforeEach，不新增 mock 基建。