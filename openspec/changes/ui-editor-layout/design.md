## Context

编辑表单布局三处体验问题（见 proposal Why）。三者独立无接口耦合，但共享一次人工 `npm run tauri dev` 验收，合为单变更。

## Goals / Non-Goals

**Goals:**
- 文件名字段置顶，作为「这首歌是谁」的第一信息。
- 歌词框默认高度 ×2（180→360），保留 `resize: vertical`。
- 左栏高度恒等窗口可用区，右栏超高仅内部滚动。

**Non-Goals:**
- 不改字段数据模型（DIRTY_FIELDS 顺序不影响）。
- 不做候选区折叠（属 `candidate-collapse` 子变更）。
- 不改歌词面板其他样式/交互。

## Decisions

### 1. 文件名字段置顶

`src/components/FieldList.vue` 模板：

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

`editor.test.ts` 字段顺序断言（原「歌名…文件名」）更新为「文件名…流派」。`kind="file"` 形态/样式不变。

### 2. 歌词框加高

`LyricPanel.vue` `.lyrics-box { min-height: 180px }` → `min-height: 360px`。保留 `resize: vertical`。

### 3. 左栏高度修复

根因（代码分析 + 需实跑复现确认）：`.workspace` 是 flex 行（`flex: 1 1 auto` 无 overflow），`.editor-slot` → `.editor` → `.editor-body`（`overflow-y:auto`）链路某层未守住 `min-height:0` 时，右栏内容超高会把 `.workspace` 撑高，左栏 `SongList` 作为 flex 兄弟跟着长高。

改动 `App.vue`：

```css
.workspace {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  overflow: hidden; /* 锁定高度边界：右栏超高仅内部滚动，不撑高撑顶左栏 */
}

.editor-slot {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0; /* 保证内部 .editor-body 的 overflow-y:auto 生效 */
  background: var(--bg);
}
```

若实跑发现 `.editor` 链路另有缺口，补同方向修复（`overflow`/`min-height`），验收标准见 spec。

## Risks

- 左栏高度修复为 CSS 布局改动，vitest/jsdom 不测真实布局——验收依赖 `npm run tauri dev` 人工复现/确认。
- `editor.test.ts` 顺序断言更新必须与 `FieldList.vue` 同 commit（否则测试红）。
