# 任务（变更域 frontend，单组；TDD）

## G1 文件名字段置顶 + 歌词框加高

- [ ] 1.1 失败测试：`src/components/editor.test.ts` 字段顺序断言改为 `['文件名','歌名','作者','专辑','专辑作者','音轨号','年份','流派']`；跑 `npx vitest run src/components/editor.test.ts` 确认 FAIL
- [ ] 1.2 `src/components/FieldList.vue`：`kind="file"` 行移到模板首位（歌名之前）
- [ ] 1.3 `src/components/LyricPanel.vue`：`.lyrics-box` `min-height: 180px → 360px`
- [ ] 1.4 跑 `npx vitest run src/components/editor.test.ts` 确认 PASS；`npm run test && npm run build` 全绿

## G2 左栏高度修复

- [ ] 2.1 复现：`npm run tauri dev` 打开含多结果歌曲展开候选，记录左栏被顶现象
- [ ] 2.2 `src/App.vue`：`.workspace` 加 `overflow: hidden`；`.editor-slot` 加 `min-height: 0`（若实跑发现 `.editor` 链路另有缺口，补同方向修复）
- [ ] 2.3 验证：重复 2.1 场景——左栏高度不变、右栏滚动、窗口不整体变高；`npm run test` 无回归

## G3 提交

- [ ] 3.1 提交：`git commit -m "feat(88): 文件名字段置顶 + 歌词框加高 + 左栏高度锁定窗口可用区"`（分支 ui-editor-layout，PR Closes #88）
