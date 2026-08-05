## Why

V1 验收通过，正式发布前需补齐「个人学习软件」的法律与产品完备性。当前仓库缺三块：

1. **无首次授权确认**：软件首次打开直接进入主界面，未向用户明示「个人学习用途 / 禁止商用 / 禁止 AI 转写」等协议，也未获得同意。
2. **协议声明仅在工作树未入规格**：README 的免责/授权条款、LICENSE（基于 BUSL 1.1 + 禁转卖/AI 转写）已写好但未纳入 OpenSpec 规格，未随 pipe 流程受控提交。
3. **两处 bug 未修**：编辑界面无法下拉看歌词框（`.editor-slot` 缺 `display:flex`）；折叠偏好「跨切歌保持」实测不好用，改为「切歌后默认展开」。

本变更统一处理（发布前检测）：授权弹窗 + 协议声明 + 两个 bug 修复，一次 PR 提交合并。

## What Changes

- **首次打开授权确认弹窗**：应用首次启动时弹出授权确认窗口，展示协议要点（个人学习用途 / 禁商用 / 禁转卖 / 禁 AI 转写 / 外部 API 免责），用户**同意才能进入主界面**；拒绝则退出应用。同意状态持久化（本地 config），二次启动不再弹。
- **README / LICENSE 协议声明**：README 加个人学习定位、不提供音频文件、外部 API 基于公开资料免责、个人用途限制、禁 AI 转写声明、软件协议章节、顶部图标；LICENSE 基于 BUSL 1.1 结构（Change Date 2099-12-31）+ 附加禁转卖/AI 转写条款。
- **bug1 滚动修复**：`src/App.vue` `.editor-slot` 补 `display: flex`，让 `.editor-body` 的 `overflow-y: auto` 生效，歌词框可见可滚动。
- **bug2 折叠调整**：`LyricPanel`/`CoverPanel` 加 `watch(songStore.current?.path)`，切歌时折叠态重置为默认展开（原「跨切歌保持」废弃）。

## Capabilities

### New Capabilities
- `eula-gate`: 首次打开授权确认弹窗——展示协议要点、同意才进入主界面、拒绝退出、同意状态本地持久化（二次启动不弹）。

### Modified Capabilities
- `readme-license-*`: README/LICENSE 协议声明（个人学习 / 禁商用 / 禁转卖 / 禁 AI 转写 / 外部 API 免责 / 图标）。
- `candidate-collapse`: 折叠偏好从「跨切歌保持」改为「切歌后默认展开」。
- `editor-scroll`: 编辑界面滚动修复（`.editor-slot` flex）。

## 关联 Issue

GitHub Issue：`#107`（分支提交 `feat(107): ...`、PR `Closes #107`）。

## Impact

- 新增：授权弹窗组件 + 同意状态持久化（Rust config 或前端 localStorage）+ 相关测试。
- 修改：README.md、LICENSE、`src/App.vue`、`src/components/LyricPanel.vue`、`src/components/CoverPanel.vue`、spec 文档（candidate-collapse/design.md 等）。
- 无 IPC 契约变更（授权状态走本地 config，不新增 Tauri command，除非 Architect 判定需要）。
