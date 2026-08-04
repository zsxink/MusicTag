## Why

编辑表单布局有三处体验问题：
1. **文件名字段在表单最底部**（8 字段最后一位），但文件名是用户第一眼想确认的信息，应置顶。
2. **歌词输入框默认高度偏低**（min-height 180px），多行歌词需要频繁手动拉高。
3. **搜索结果展开时会把左栏文件浏览器顶高**——右栏编辑区内容超高时 `.workspace` flex 行被撑开，左栏跟着长高，窗口整体变高，体验割裂。

## What Changes

- **文件名字段置顶**：`FieldList.vue` 模板把 `kind="file"` 行移到最前（歌名之前）；`editor.test.ts` 字段顺序断言同步更新。
- **歌词框加高**：`LyricPanel.vue` `.lyrics-box` `min-height: 180px → 360px`（保留 `resize: vertical`）。
- **左栏高度修复**：`App.vue` `.workspace` 加 `overflow: hidden`（锁定高度边界）、`.editor-slot` 加 `min-height: 0`（保证 `.editor-body` 内部滚动生效）——右栏候选展开仅内部滚动，左栏高度恒等于窗口可用区，窗口不再整体变高。

## Capabilities

### New Capabilities
（无——三项均为既有 UI 的布局微调）

### Modified Capabilities
- `editor-layout`: 字段顺序（文件名置顶）、歌词框默认高度（×2）、左栏高度锁定窗口可用区（右栏超高仅内部滚动）。

## 关联 Issue

GitHub Issue：`#88`（分支提交 `feat(88): ...`、PR `Closes #88`）

## Impact

- `src/components/FieldList.vue`：字段顺序调整。
- `src/components/LyricPanel.vue`：歌词框 `min-height` 180→360。
- `src/App.vue`：`.workspace` overflow + `.editor-slot` min-height。
- `src/components/editor.test.ts`：字段顺序断言更新。
- 文档同步：`docs/design/design.md` §5 字段顺序/布局、`docs/V1-PRD.md` FR-3 表单描述（若涉及）。
