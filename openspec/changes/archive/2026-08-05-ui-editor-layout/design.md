## Context

编辑表单布局三处体验问题（见 proposal Why）：文件名在表单位、歌词框偏低、右栏内容超高撑高左栏/窗口。三者独立无接口耦合，但共享一次人工 `npm run tauri dev` 布局验收，合为单变更。

**变更域判定：frontend（纯前端）**。三处均为 Vue 模板 / scoped CSS / vitest 断言改动，不触任何 Rust/Tauri command、不涉 IPC、不改 store 数据模型。**无需后端依赖，无 Rust→Vue 顺序问题**——无 worktree 时仅 Vue-Dev 单角色串行实现即可。

## Goals / Non-Goals

**Goals:**
- 文件名字段置顶，作为「这首歌是谁」的第一信息。
- 歌词框默认高度 ×2（180→360），保留 `resize: vertical`。
- 左栏高度恒等窗口可用区，右栏超高仅内部滚动、窗口不整体变高。

**Non-Goals:**
- 不改字段数据模型（`songStore.current` 字段形状、DIRTY_FIELDS 顺序、保存语义均不动）。
- 不做候选区折叠（属 `candidate-collapse` 子变更）。
- 不改歌词面板其他样式/交互、不改封面区、不改空态/坏标签只读态。
- 不改 sidebar 宽度（280px 等现有布局参数）。

## Current Behavior（现状，代码确认）

- `App.vue`：`.app` 为纵向 flex（`height:100%`），`.workspace` 已带 `min-height:0` + `display:flex`，`.editor-slot` 有 `min-width:0`。
- `.editor-body`（Editor.vue）已有 `overflow-y:auto` + `min-height:0`，右栏本应内部滚动。
- 但 `.workspace` 缺 `overflow:hidden`、`.editor-slot` 缺 `min-height:0` → 右栏内容超高时 flex 行被撑开，左栏 `SongList`（`flex:0 0 auto`，宽度 280px）作为兄弟被顶高，窗口整体变高。
- 现状副作用：左栏高度跟随右栏内容变化（割裂）。

## Decisions

### 1. 文件名字段置顶

`src/components/FieldList.vue` 模板将 `kind="file"` 行移到首位（歌名之前）：

```vue
<FieldRow label="文件名" kind="file" />
<FieldRow label="歌名" field="title" />
<FieldRow label="作者" field="artist" />
<FieldRow label="专辑" field="album" />
<FieldRow label="专辑作者" field="album_artist" />
<FieldRow label="音轨号" kind="track" />
<FieldRow label="年份" field="year" />
<FieldRow label="流派" field="genre" />
```

`kind="file"` 行的 `FieldRow` 形态/绑定不变（仍可编辑改名行，spec Scenario「文件名行样式不变」）。**与 PRD FR-3.3 对齐**：PRD 可编辑字段列表首项即「文件名」，本次置顶使布局与规格一致，无需改 PRD。

**测试同步（必须同 commit）**：`editor.test.ts` 两处断言改顺序——
- `describe('FieldGrid')` 的 `labels` 数组由 `['歌名',…,'文件名']` 改为 `['文件名','歌名','作者','专辑','专辑作者','音轨号','年份','流派']`。
- `describe('FieldList 全字段行')` 下按标签查找的断言（`byLabel('歌名')` 等）用 `.find()` 按 label 定位，**与 DOM 顺序无关**，无需改；只有按 `findAll` 顺序断言的 `FieldGrid` 测试需更新。

### 2. 歌词框加高

`LyricPanel.vue` `.lyrics-box { min-height: 180px }` → `min-height: 360px`。保留 `resize: vertical`。其余样式（边框/焦点/禁用/placeholder）不变。

**无对应 vitest**：css min-height 不是属性断言；jsdom 亦不测真实布局。歌词相关现有测试（badge / readonly disabled / v-model）不依赖该高度，不受影响。

### 3. 左栏高度锁定窗口可用区

根因与修复（见 Current Behavior）：在 flex 布局里，约束内容超高不外溢要同时满足两层——

- **父容器锁高**：`.workspace` 加 `overflow: hidden`——锁定该行高度边界，右栏内容超高不再把 `.workspace` 撑高顶起左栏。实际代码 delta 仅新增 `overflow: hidden` 一行（`min-height:0`/`display:flex` 已存在）。
- **子容器放行滚动**：`.editor-slot` 加 `min-height: 0`——让 `.editor-body` 的 `overflow-y:auto` 真正生效（flex 子项默认 `min-height:auto`，会阻止收缩，导致滚动失效）。`.editor`/`.editor-body` 已含 `min-height:0` + `overflow-y:auto`，无需再动。

改动 `App.vue`：

```css
.workspace {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  overflow: hidden; /* 锁定高度边界：右栏超高仅内部滚动，不撑高顶起左栏 */
}

.editor-slot {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0; /* 保证内部 .editor-body 的 overflow-y:auto 生效 */
  background: var(--bg);
}
```

`SongList`（`flex:0 0 auto` 宽度) 高度行为不变：`.workspace` 高度被锁定后，左栏高度恒等于窗口可用区（`.app` 纵向 flex，`.workspace` `flex:1 1 auto` 撑满）。

若实跑发现 `.editor` 链路另有缺口（空态 `.editor-empty` 或只读态下滚动失效等），补同方向修复（`overflow`/`min-height`），验收标准见 spec。

## Risks

- 左栏高度修复为纯 CSS 布局改动，vitest/jsdom 不测真实布局——验收依赖 `npm run tauri dev` 人工复现/确认（G2 任务含复现 + 验证两步）。
- `editor.test.ts` 字段顺序断言更新必须与 `FieldList.vue` 同 commit（否则测试红）；且只改 `FieldGrid` 的 `labels` 顺序断言，勿误改按 label 查找的断言。
- 空态/正常态不得回归：`overflow:hidden` 是给 `.workspace` 加的，若未来出现滚动需求需复评，但本次范围不引入跨端/数据模型变更。

## 依赖顺序

frontend 单域，无跨端依赖。组内顺序：G1（字段顺序 + 歌词高度，含测试）→ G2（左栏高度，人工验收）→ G3（提交）。G1/G2 均可在 Tauri dev 窗口一并人工验收，故共享单次验收、合为单 PR。
