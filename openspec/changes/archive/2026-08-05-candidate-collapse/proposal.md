## Why

搜索歌词/封面后，候选区常显会把右栏编辑区撑高，挤压歌词输入框等编辑空间。用户需要能手动收起候选区、聚焦编辑；搜索新结果时又需要能再展开。

## What Changes

- **歌词候选区折叠**：`LyricPanel.vue` 加「隐藏候选 ▲ / 展开候选 ▼」按钮，默认展开；收起后候选区（搜索状态/候选列表/空态/离线提示）整体隐藏（`v-show` 保留 DOM）。
- **封面候选区折叠**：`CoverPanel.vue` 同理。
- **偏好跨切歌保持**：折叠态为组件局部 ref，切歌不重置（不随 `resetSearchState` 清理），用户收起后保持到手动展开；换目录/坏标签只读（面板卸载）后重新选歌默认展开。
- **按钮出现时机**：仅候选区「有内容」时显示折叠按钮（搜索中/有候选/空态/离线），无内容时不占位。

## Capabilities

### New Capabilities
- `candidate-collapse`: 歌词/封面搜索候选区各提供折叠交互——「隐藏候选 ▲ / 展开候选 ▼」，默认展开、跨切歌保持折叠偏好、仅候选区有内容时显示按钮。

### Modified Capabilities
（无——折叠是新增交互，不替换既有候选区语义）

## 关联 Issue

GitHub Issue：`#89`（分支提交 `feat(89): ...`、PR `Closes #89`）

## Impact

- `src/components/LyricPanel.vue`：候选区包 `v-show` + 折叠按钮 + 局部 ref。
- `src/components/CoverPanel.vue`：同上。
- `src/components/lyric-panel.test.ts`、`cover-panel.test.ts`：新增折叠 describe。
- 文档同步：`docs/V1-PRD.md` FR-8 补「候选区折叠」描述、`docs/design/design.md` §9 候选区。
