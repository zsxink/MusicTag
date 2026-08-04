## Context

搜索歌词/封面后候选区常显，撑高右栏编辑区。需手动可折叠、且折叠偏好跨切歌保持。

## Goals / Non-Goals

**Goals:**
- 歌词/封面候选区各一个折叠按钮，默认展开。
- 收起后候选区隐藏（`v-show` 保留 DOM，不重算搜索状态）。
- 折叠偏好跨切歌/换目录保持（用户收起后不被搜索结果自动顶开）。
- 仅候选区有内容时显示按钮。

**Non-Goals:**
- 不做全局总开关（歌词/封面独立控制，已拍板）。
- 不改候选区内容/交互/搜索生命周期（resetSearchState 语义不变）。

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

### 2. 候选区 v-show + 折叠按钮

候选区外层包 `<div class="cand-wrap" v-show="!candidatesCollapsed">`（包裹搜索状态/候选/空态/离线分支），按钮放面板 head 区：

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
const candidatesVisible = computed(
  () => songStore.lyricSearchState === 'searching'
    || songStore.lyricFetchEmpty
    || (songStore.lyricSearchState === 'done' && songStore.lyricCandidates.length > 0)
    || songStore.isOffline,
)
```

封面面板同理（`coverSearchState`/`coverCandidates`）。

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

## Risks

- 歌词/封面面板都改 → 与 `ui-editor-layout`（也改 LyricPanel.vue）共享文件卫生，故本变更 dependsOn 它（布局先行，避免同文件跨变更双改冲突）。
- `v-show` 保留 DOM：折叠态不触发候选区卸载/重挂，搜索状态、候选数据不受影响。
