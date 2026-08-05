# 任务（变更域 frontend，单组；TDD + 人工验收）

> 单角色（Vue-Dev）串行实现，无 Rust 依赖。G1 含测试同步，G2 需人工验收。

## G1 文件名字段置顶 + 歌词框加高

- [ ] 1.1 失败测试：`src/components/editor.test.ts` 的 `FieldGrid` 顺序断言 `labels` 数组改为
      `['文件名','歌名','作者','专辑','专辑作者','音轨号','年份','流派']`；
      跑 `npx vitest run src/components/editor.test.ts` 确认 FAIL
      （`FieldList` 下按 label `.find()` 定位的断言与顺序无关，不改）
- [ ] 1.2 `src/components/FieldList.vue`：`kind="file"` 行移到模板首位（歌名之前），其余 7 行顺序不变
- [ ] 1.3 `src/components/LyricPanel.vue`：`.lyrics-box` `min-height: 180px → 360px`（保留 `resize: vertical`）
- [ ] 1.4 跑 `npx vitest run src/components/editor.test.ts` 确认 PASS；`npm run test && npm run build` 全绿

## G2 左栏高度锁定窗口可用区（人工验收）

- [ ] 2.1 复现：`npm run tauri dev` 打开含多结果的歌曲展开候选，确认左栏/窗口被顶高现象
- [ ] 2.2 `src/App.vue`：
      - `.workspace` 新增 `overflow: hidden`（`min-height:0`/`display:flex` 已存在，勿重复）
      - `.editor-slot` 新增 `min-height: 0`（保证内部 `.editor-body` `overflow-y:auto` 生效）
      - 若实跑发现 `.editor` 链路另有缺口（如空态/只读态滚动失效），补同方向 `overflow`/`min-height` 修复
- [ ] 2.3 验证：重复 2.1 场景——左栏高度不变（= 窗口可用区）、右栏出现滚动条、窗口不整体变高；
      未选中（空态）/正常态无回归；`npm run test` 全绿

## G3 提交

- [ ] 3.1 提交：`git commit -m "feat(88): 文件名字段置顶 + 歌词框加高 + 左栏高度锁定窗口可用区"`（分支 ui-editor-layout，PR Closes #88）
