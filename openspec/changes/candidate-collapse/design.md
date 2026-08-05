## Context

搜索歌词/封面后候选区常显，撑高右栏编辑区。需手动可折叠、且折叠偏好跨切歌保持。

## 技术方案（供实现者）

本变更纯前端展示交互，不改任何 store 字段/动作、不改 IPC 契约、不新增依赖。

- **组件边界**：`src/components/LyricPanel.vue`（歌词候选区）与 `src/components/CoverPanel.vue`（封面候选区）各自独立实现折叠，互不相干（歌词/封面独立控制，已拍板）。
- **数据流**：折叠偏好是组件局部 `ref`，不进入 `store/song.ts`；候选内容仍由 store 的 `lyricSearchState`/`lyricCandidates`/`lyricFetchEmpty`/`isOffline`（歌词）与 `coverSearchState`/`coverCandidates`/`isOffline`（封面）驱动。折叠只做「显示 / 隐藏」包装，不参与搜索生命周期（resetSearchState 语义不变，见 Non-Goals）。
- **渲染结构**：候选区外层包 `<div class="cand-wrap" v-show="!candidatesCollapsed">`（v-show 保留 DOM，不卸载候选分支），折叠按钮 `.cand-toggle` 放候选区上方（歌词区：head 与 textarea 之间；封面区：搜索按钮上方）。按钮出现与否由 `candidatesVisible` computed 决定（候选区「有内容」才显示）。
- **切歌保持的实现基础**：`LyricPanel` 与 `CoverPanel` 是 `Editor.vue` 下**常驻子组件**（歌曲打开期间始终挂载；切歌/`selectSong` 只改 store 状态、不销毁重建面板），故组件局部 `ref` 跨切歌天然保留，无需持久化。仅换目录/清空当前歌（`activateFolder` 置 `current=null`）才卸载面板、ref 重置——此后用户重新选歌，重置为默认展开合理。

## 来源与依赖序

- 本变更来自融大变更：总 PRD `docs/superpowers/specs/2026-08-05-ux-polish-and-layering-refactor-design.md` §2.3（候选折叠）+ `docs/superpowers/plans/2026-08-05-ux-polish.md` Task 3；nested change `candidate-collapse`（Issue #89）。
- **变更域：frontend**（纯 Vue 组件 + 组件测试，零 Rust 改动）。
- **依赖序**：`dependsOn: ui-editor-layout`（#88，已合并）。两者都改 `src/components/LyricPanel.vue`——布局变更（`.lyrics-box` min-height 180→360）先行合回 main，本变更再在该文件上加折叠，避免同文件跨变更双改冲突。前端组内 candidate-collapse 独立 CR/验收/合并（不并行、不依赖 Rust 侧）。

## Goals / Non-Goals

**Goals:**
- 歌词/封面候选区各一个折叠按钮，默认展开。
- 收起后候选区隐藏（`v-show` 保留 DOM，不重算搜索状态）。
- 折叠偏好跨切歌/换目录保持（用户收起后不被搜索结果自动顶开）。
- 仅候选区有内容时显示按钮。

**Non-Goals:**
- 不做全局总开关（歌词/封面独立控制，已拍板）。
- 不改候选区内容/交互/搜索生命周期（resetSearchState 语义不变）。
- 折叠偏好不做跨会话持久化（重启不记忆）——这是纯会话内展示态，已拍板；换目录后默认展开。

## 精确语义

- **跨切歌保持**：切歌（`selectSong` → `open` → `resetSearchState` 清候选）时折叠按钮依 `candidatesVisible` 判断——新歌搜索中/有候选/空态/离线时按钮再现且保持上次折叠态；新歌无候选（idle 且无内容）时按钮不显示。
- **换目录保持（保守实现）**：`activateFolder` 置 `current=null` → 面板卸载 → 折叠 ref 重置为默认展开。若需严格保持，后续在 `resetSearchState` 中不动折叠态（本变更不为此引入跨切歌状态提升，非必需）。
- **点击折叠按钮仅翻转 `candidatesCollapsed`**：不触发 store 动作、不清候选、不重跑搜索；候选数据与 `cand-wrap` 内 DOM 原样保留（`v-show` 隐藏）。

## Decisions

### 1. 折叠态为组件局部 ref（不进 store）

折叠偏好是纯展示偏好、无跨组件依赖 → 放面板组件局部：

```ts
// LyricPanel.vue / CoverPanel.vue
const candidatesCollapsed = ref(false)
function toggleCandidates(): void {
  candidatesCollapsed.value = !candidatesCollapsed.value
}
```

跨切歌保持：ref 不随 `resetSearchState` 清理（resetSearchState 在 store，管候选内容；折叠 ref 在组件，互不影响）。组件实例常驻（面板不销毁），切歌只清 store 候选，折叠态保留。

> 注：`LyricPanel.vue` 现有 script 只 `import { computed } from 'vue'`，需补 `ref`；`CoverPanel.vue` 已 import `ref`。

### 2. 候选区 v-show + 折叠按钮

候选区外层包 `<div class="cand-wrap" v-show="!candidatesCollapsed">`（包裹搜索状态/候选/空态/离线分支），按钮放候选区上方：

```vue
<button
  v-if="candidatesVisible"
  class="cand-toggle"
  type="button"
  @click="toggleCandidates"
>{{ candidatesCollapsed ? '展开候选 ▼' : '隐藏候选 ▲' }}</button>
```

`candidatesVisible` computed（候选区有内容才显示按钮）：

```ts
// LyricPanel.vue
const candidatesVisible = computed(
  () => songStore.lyricSearchState === 'searching'
    || songStore.lyricFetchEmpty
    || (songStore.lyricSearchState === 'done' && songStore.lyricCandidates.length > 0)
    || songStore.isOffline,
)
```

封面面板同理（`coverSearchState`/`coverCandidates`/`coverFetchEmpty` 无此字段——封面无 fetch 空态）：

```ts
// CoverPanel.vue
const candidatesVisible = computed(
  () => songStore.coverSearchState === 'searching'
    || (songStore.coverSearchState === 'done' && songStore.coverCandidates.length > 0)
    || songStore.isOffline,
)
```

> **与模板分支对齐的保证**：`candidatesVisible` 的判空口径与现有候选区模板 v-if 分支（searching / done+候选 / done 空态 / C2 lyricFetchEmpty / offline）逐条对齐，保证「有内容⇔有按钮」；按钮 `v-if` 独立于 `v-show`（折叠与否不影响按钮显示判定）。

### 3. 样式

`.cand-toggle` 对齐现有 `.search-trigger` 的克制风格（透明底 + 边框 + 圆角 + hover accent），尺寸更小：

```css
.cand-toggle {
  margin-bottom: 10px;
  padding: 3px 10px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-dim);
  font-size: 11px;
  cursor: pointer;
}
.cand-toggle:hover { color: var(--accent); border-color: var(--accent); }
```

`LyricPanel.vue` 的 `.cand-toggle` 加 `margin-top: 0`（head 与按钮同处上方区域）；`CoverPanel.vue` 的 `.cand-toggle` 加 `margin-top: 10px`（封面搜索按钮下方）。

## 测试设计（TDD，组件测试）

**`src/components/lyric-panel.test.ts`** 追加 describe「候选区折叠」：
1. 默认展开：`songStore.lyricSearchState='done'` + 候选非空 → `.cand-list` 可见、`.cand-toggle` 文案含「隐藏候选」。
2. 点击折叠：`.cand-list` `isVisible()===false`、按钮文案含「展开候选」。
3. 跨切歌保持：点击折叠后重新 `mount(LyricPanel)`（模拟切歌后候选重来）→ 新实例 `.cand-list` 仍 `isVisible()===false`。

**`src/components/cover-panel.test.ts`** 追加 describe「候选区折叠」：同上 1–2（网格 `.cand-grid`）。

> 复用现有 mock（`../api/search`、`@tauri-apps/api/core`、`@tauri-apps/api/window`）与 `openSong()` helper；沿用现有「直接设 `songStore.lyricSearchState='done'`」模式，不新增依赖。

## Risks

- 歌词/封面面板都改 → 与 `ui-editor-layout`（也改 LyricPanel.vue）共享文件卫生，故本变更 dependsOn 它（布局先行，避免同文件跨变更双改冲突）。
- `v-show` 保留 DOM：折叠态不触发候选区卸载/重挂，搜索状态、候选数据不受影响。
- `.cand-wrap` 包裹分支时**不得改动分支内部 v-if/v-else 结构**（尤其 lyricFetchEmpty 先于 done 的 CR C2 顺序），只加外层 v-show 容器。
- 换目录时折叠态重置为默认展开（面板卸载）——与本变更「跨切歌保持」要求不冲突（换目录清空编辑态，重新选歌展开合理）；如被验收视为缺陷，回退方案是提升为 store 持久态。
