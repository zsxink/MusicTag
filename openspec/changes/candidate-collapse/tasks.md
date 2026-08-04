# 任务（变更域 frontend，单组；TDD）

## G1 歌词候选区折叠

- [ ] 1.1 失败测试：`src/components/lyric-panel.test.ts` 新增折叠 describe——默认展开（`.cand-list` 可见 + 按钮「隐藏候选 ▲」）、点击隐藏（`isVisible()===false` + 「展开候选 ▼」）、跨切歌保持（收起后重新挂载仍折叠）；跑 `npx vitest run src/components/lyric-panel.test.ts` 确认 FAIL
- [ ] 1.2 `src/components/LyricPanel.vue`：加 `candidatesCollapsed` ref + `toggleCandidates` + `candidatesVisible` computed + 折叠按钮 + `.cand-toggle` 样式；候选区分支包 `<div class="cand-wrap" v-show="!candidatesCollapsed">`
- [ ] 1.3 跑 `npx vitest run src/components/lyric-panel.test.ts` 确认 PASS

## G2 封面候选区折叠

- [ ] 2.1 失败测试：`src/components/cover-panel.test.ts` 新增折叠 describe（默认展开 + 点击折叠）；确认 FAIL
- [ ] 2.2 `src/components/CoverPanel.vue`：同 G1 实现（coverSearchState/coverCandidates 对应 computed）
- [ ] 2.3 跑 `npx vitest run src/components/cover-panel.test.ts` 确认 PASS

## G3 验证 + 文档 + 提交

- [ ] 3.1 全量：`npm run test && npm run build` 全绿
- [ ] 3.2 `docs/V1-PRD.md` FR-8 补「候选区折叠」描述；`docs/design/design.md` §9 候选区补折叠交互
- [ ] 3.3 提交：`git commit -m "feat(89): 歌词/封面搜索候选区可折叠（隐藏/展开，跨切歌保持）"`（分支 candidate-collapse，PR Closes #89）
