## Why

核心编辑闭环（读→存）已具备，但还缺两个贯穿性 UX：**切歌/换目录未保存确认**（FR-6、FR-1-5a）与**双主题**（FR-7：深色默认、浅色跟随、手动切换、重启记忆）。本变更落地这两个横切能力，并做整体打磨（空态、120ms 过渡）。

## What Changes

- **切歌三选一弹窗**（`SwitchDialog.vue`）：有未保存修改时切歌 → 模态弹窗「保存对 `<文件名>` 的修改吗？」三个按钮：保存（先写再切）/ 不保存（丢弃切换）/ 取消（留在当前）。**换目录有未保存修改复用同一弹窗**（FR-1-5a：取消则不换目录；保存写当前编辑歌原路径）。
- **双主题**：深色为默认（防启动闪白）；浅色跟随系统 `prefers-color-scheme`；顶栏最右主题按钮手动切换（☀️/🌙）；手动选择持久记忆（重启保持，localStorage），未手动选择时继续跟随系统。
- 打磨：空态/状态统一、120ms 过渡、`prefers-reduced-motion` 减弱、弹窗 `role="dialog" aria-modal` 可 Esc 取消。

## Capabilities

### New Capabilities
- `ux-settings`: 切歌/换目录未保存三选一弹窗 + 双主题（默认/跟随/手动切换/重启记忆）+ 打磨

### Modified Capabilities
（无）

## 关联 Issue

- GitHub Issue：`#13`（变更前已建，作为本变更锚点；分支提交 `feat(13): ...`、PR `Closes #13`）

## Impact

- 复用 `v1-song-save` 的保存通道（弹窗「保存」按钮 = 先 save_song 再切）。
- 复用 `v1-folder-list` 的换目录入口（拦截点）。
- 主题持久记忆用 localStorage（V1 不引入 tauri-plugin-store，轻量即可）。
