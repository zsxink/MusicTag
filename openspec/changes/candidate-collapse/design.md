## Context

搜索歌词/封面后候选区常显，撑高右栏编辑区。需手动可折叠、且折叠偏好跨切歌保持。

## 技术方案（供实现者）

本变更纯前端展示交互，不改任何 store 字段/动作、不改 IPC 契约、不新增依赖。

- **组件边界**：`src/components/LyricPanel.vue`（歌词候选区）与 `src/components/CoverPanel.vue`（封面候选区）各自独立实现折叠，互不相干（歌词/封面独立控制，已拍板）。
- **数据流**：折叠偏好是组件局部 `ref`，不进入 `store/song.ts`；候选内容仍由 store 的 `lyricSearchState`/`lyricCandidates`/`lyricFetchEmpty`/`isOffline`（歌词）与 `coverSearchState`/`coverCandidates`/`isOffline`（封面）驱动。折叠只做「显示 / 隐藏」包装，不参与搜索生命周期（resetSearchState 语义不变，见 Non-Goals）。
- **渲染结构**：候选区外层包 `<div class="cand-wrap" v-show="!candidatesCollapsed">`（v-show 保留 DOM，不卸载候选分支），折叠按钮 `.cand-toggle` 放候选区上方（歌词区：head 与 textarea 之间；封面区：搜索按钮上方）。按钮出现与否由 `candidatesVisible` computed 决定（候选区「有内容」才显示）。
- **切歌保持的实现基础**：`LyricPanel`（直接挂 `Editor.vue` 的 `editor-body`）与 `CoverPanel`（经 `FieldGrid.vue` 同挂在 `editor-body`，design §10.1 组件树）是**常驻子组件**——正常歌 ↔ 正常歌切歌（`selectSong` 只改 store 状态、`editor-body` 分支不卸载），组件实例与局部 `ref` 天然保留，跨切歌折叠偏好无需持久化。**卸载只发生在 `editor-body` 分支被替换时**：换目录/清空当前歌（`activateFolder` 置 `current=null` → 空态分支）或坏标签只读（`readonly=true` → readonly-note 分支）；此后重新选歌，折叠 ref 重置为默认展开。

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
- **切歌经过无内容中间态（测试锁定）**：`resetSearchState` 把状态归 idle 的瞬间候选区无内容 → 折叠按钮随 `v-if="candidatesVisible"` 暂隐；但 `cand-wrap` 的 v-show 折叠态**保留**——新歌搜索中/候选到来时按钮复现、仍保持折叠（G1 测试 5 覆盖该序列）。
- **换目录 / 只读（保守实现）**：`activateFolder` 置 `current=null`（或坏标签歌 `readonly=true`）→ `editor-body` 卸载 → 折叠 ref 重置为默认展开。符合「换目录清空编辑态、重新选歌默认展开」（PRD FR-8.15）；若需严格保持，后续在 `resetSearchState` 中不动折叠态（本变更不为此引入状态提升，非必需）。
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
    || (songStore.lyricSearchState === 'done' && songStore.lyricCandidates.length === 0)
    || songStore.isOffline,
)
```

封面面板同理（`coverSearchState`/`coverCandidates`/`isOffline`——封面无 `lyricFetchEmpty` 对应字段，无 C2 fetch 空态）：

```ts
// CoverPanel.vue
const candidatesVisible = computed(
  () => songStore.coverSearchState === 'searching'
    || (songStore.coverSearchState === 'done' && songStore.coverCandidates.length > 0)
    || (songStore.coverSearchState === 'done' && songStore.coverCandidates.length === 0)
    || songStore.isOffline,
)
```

> **与模板分支对齐的保证**：`candidatesVisible` 判空口径与候选区模板 v-if 分支逐条对齐（searching / `lyricFetchEmpty` 仅歌词 / done+候选 / **done+空 → 渲染空态 `.cand-empty`，亦属「有内容」** / offline），保证「有内容⇔有按钮」。done 的两条显式分支（候选非空 / 候选空）合起来等价于 `state==='done'`，逐条写出便于与模板分支核对、防漏；按钮 `v-if` 独立于 `v-show`（折叠与否不影响按钮显示判定）。

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

**`src/components/lyric-panel.test.ts`** 追加 describe「候选区折叠」8 条用例：
1. 默认展开：`lyricSearchState='done'` + 候选非空 → `.cand-list` 存在、`.cand-wrap` 内联 `display` 非 `none`、按钮文案含「隐藏候选」。
2. 点击折叠 → `.cand-wrap` 内联 `display==='none'`、按钮文案含「展开候选」。
3. 重新展开：再点按钮 → 恢复显示、文案「隐藏候选」。
4. 跨切歌保持：收起后**保持同一挂载实例**，改 store（模拟 `resetSearchState` 后新歌候选到来）→ `.cand-wrap` 仍 `none`、按钮「展开候选」。
5. 切歌经过无内容中间态：收起 → store 归 idle（候选无内容 → 按钮暂隐、折叠态保留）→ 新歌 searching（按钮复现、仍折叠）→ done+新候选（仍折叠）。
6. 候选区无内容（idle 且无候选/非离线）→ 不显示按钮、无占位。
7. 空态算有内容（done+候选空 → `.cand-empty` 渲染）→ 显示按钮。
8. `lyricFetchEmpty`（C2 全源失败空态）→ 显示按钮。

**`src/components/cover-panel.test.ts`** 追加 describe「候选区折叠」6 条用例：同上 1–4 与 6–7（网格 `.cand-grid`、空态「未找到匹配的封面」）；封面无 `lyricFetchEmpty` 字段，无第 8 条。

> **断言口径**：`v-show` 只改 `.cand-wrap` 的内联 `style.display`，happy-dom 不计算样式（`isVisible()` 不可靠）→ 断言内联属性（`candWrapDisplay` helper）。跨切歌保持用**同一实例 + 改 store** 断言 ref 未随 `resetSearchState` 清理——不是重新 mount（重挂载新建 ref、会重置为展开）。复用现有 mock（`../api/search`、`@tauri-apps/api/core`、`@tauri-apps/api/window`）与 `openSong()` helper；沿用现有「直接设 `songStore.lyricSearchState='done'`」模式，不新增依赖。

## Risks

- 歌词/封面面板都改 → 与 `ui-editor-layout`（也改 LyricPanel.vue）共享文件卫生，故本变更 dependsOn 它（布局先行，避免同文件跨变更双改冲突）。
- `v-show` 保留 DOM：折叠态不触发候选区卸载/重挂，搜索状态、候选数据不受影响。
- `.cand-wrap` 包裹分支时**不得改动分支内部 v-if/v-else 结构**（尤其 lyricFetchEmpty 先于 done 的 CR C2 顺序），只加外层 v-show 容器。
- `current=null`（换目录/清空）或 `readonly=true`（坏标签只读）都会卸载 `editor-body` 分支 → 折叠 ref 重置为默认展开；坏标签歌本身无候选区可折叠、换目录清空编辑态后重新选歌展开，均与「跨切歌保持」要求不冲突（正常歌 ↔ 正常歌切歌不卸载、偏好保持）。如被验收视为缺陷，回退方案是提升为 store 持久态。
