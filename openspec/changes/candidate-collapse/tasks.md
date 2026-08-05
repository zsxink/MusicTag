# 任务（变更域 frontend，单组；TDD）

> 依赖序：本变更 dependsOn `ui-editor-layout`（#88，已合并）——`LyricPanel.vue` 先经布局变更改过（`.lyrics-box` min-height 180→360），在此之上加折叠，无同文件跨变更冲突。零 Rust 改动。

## G1 歌词候选区折叠

- [ ] 1.1 失败测试：`src/components/lyric-panel.test.ts` 追加「候选区折叠」describe——默认展开（`songStore.lyricSearchState='done'` + 候选非空 → `.cand-list` 可见 + 按钮「隐藏候选 ▲」）、点击折叠（`.cand-list` `isVisible()===false` + 「展开候选 ▼」）、跨切歌保持（收起后重新 `mount(LyricPanel)` 仍折叠）；跑 `npx vitest run src/components/lyric-panel.test.ts` 确认 FAIL（无 `.cand-toggle`）
- [ ] 1.2 `src/components/LyricPanel.vue`：script 补 `ref` import + `candidatesCollapsed` ref + `toggleCandidates` + `candidatesVisible` computed（searching / lyricFetchEmpty / done+候选 / isOffline，与现有分支逐条对齐）；候选区分支包 `<div class="cand-wrap" v-show="!candidatesCollapsed">`（**不改分支内部 v-if/v-else 结构**，lyricFetchEmpty 先于 done 的 CR C2 顺序保持）；候选区上方加 `.cand-toggle` 按钮（`v-if="candidatesVisible"`）+ `.cand-toggle` 样式（对齐 `.search-trigger`，更小尺寸）
- [ ] 1.3 跑 `npx vitest run src/components/lyric-panel.test.ts` 确认 PASS（新增 3 个 + 现有全部）

## G2 封面候选区折叠

- [ ] 2.1 失败测试：`src/components/cover-panel.test.ts` 追加「候选区折叠」describe（默认展开 `.cand-grid` 可见 + 按钮「隐藏候选 ▲」、点击折叠 → `isVisible()===false` + 「展开候选 ▼」）；确认 FAIL
- [ ] 2.2 `src/components/CoverPanel.vue`：同 G1 实现（`coverSearchState`/`coverCandidates`/`isOffline` 对应 computed；候选区分支包 `.cand-wrap` v-show；按钮放搜索按钮下方，`margin-top: 10px`）
- [ ] 2.3 跑 `npx vitest run src/components/cover-panel.test.ts` 确认 PASS

## G3 验证 + 文档 + 提交

- [ ] 3.1 全量：`npm run test && npm run build` 全绿
- [ ] 3.2 `docs/V1-PRD.md` FR-8 补「候选区折叠」描述（默认展开、跨切歌保持、仅候选区有内容时显示按钮）；`docs/design/design.md` §9 搜索候选区补折叠交互
- [ ] 3.3 提交：`git commit -m "feat(89): 歌词/封面搜索候选区可折叠（隐藏/展开，跨切歌保持）"`（分支 candidate-collapse，PR 基 main，Closes #89）
