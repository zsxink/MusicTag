## Context

编辑闭环（读/存/封面/歌词/改名）已就绪。本变更补切歌确认弹窗与双主题两个横切 UX，并整体打磨。

## Goals / Non-Goals

**Goals:**
- 切歌/换目录未保存三选一弹窗（统一抽象复用）。
- 双主题：深色默认 + 浅色跟随系统 + 手动切换持久记忆。
- 打磨：空态/过渡/reduced-motion/无障碍。

**Non-Goals:**
- 不引入 `tauri-plugin-store`（localStorage 足够）。
- 不做主题之外的其他设置项。

## Decisions

- **弹窗抽象**：`SwitchDialog.vue` 为通用三选一模态组件（`role="dialog" aria-modal`，可 Esc 取消），由切歌与换目录两处复用（FR-6 与 FR-1-5a）。「保存」= 先 `save_song` 成功再切；「不保存」= 丢弃；「取消」= 留在当前。
- **触发判定**：切歌/换目录前检查 store `dirty`；`dirty=false` 直接切。
- **主题机制**：
  - 全局 `data-theme` 属性挂 `<html>`，`[data-theme="light"]` 覆盖浅色 token；默认深色。
  - `matchMedia('(prefers-color-scheme: light)')` 监听系统；手动选择时写入 localStorage `music-tag-theme`，优先级高于系统。
  - 手动选择状态存 `'dark'|'light'|null`（null=跟随系统）。
- **持久记忆**：localStorage（重启保持，FR-7.4）。
- **打磨**：过渡 120ms；`prefers-reduced-motion` 下减弱；按钮按压位移 1px；弹窗阴影 `0 18px 48px`。

## Risks / Trade-offs

- localStorage 在 Tauri WebView 可用（原生持久化），跨平台行为一致；不引入 store 插件避免依赖。
- 「保存再切」若保存失败：不切换、留在当前并展示保存失败提示（同 `v1-song-save` 语义），避免切走丢内容。
