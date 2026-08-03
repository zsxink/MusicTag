<script setup lang="ts">
// 单字段行（design.md §5 field）：左标签 + 右输入框。
// 三形态：
// - `text`：普通文本字段（歌名/作者/专辑/专辑作者/年份/流派），v-model 绑 current
// - `track`：音轨号 `track` / 共 `track_total`（inline-suffix 布局）
// - `file`：文件名行，可编辑（v1-rename-sync）——独立 UI 状态 `pendingRename`，
//   非 Song 字段、不进 DIRTY_FIELDS（D5：单改文件名不脏表单）
import { computed } from 'vue'

import { fileName } from '../lib/path'
import { setPendingRename, songStore } from '../store/song'

const props = withDefaults(
  defineProps<{
    /** 字段标签（如「歌名」「音轨号」）。 */
    label: string
    /** 字段 key（绑 current[key]）；`file`/`track` 形态可缺省。 */
    field?: 'title' | 'artist' | 'album' | 'album_artist' | 'year' | 'genre'
    /** 输入框占位符。 */
    placeholder?: string
    /** 形态：默认 text；track = 音轨号/总数对；file = 可编辑文件名行。 */
    kind?: 'text' | 'track' | 'file'
  }>(),
  {
    /** 普通字段行（歌名/作者/专辑/专辑作者/年份/流派）不传 kind → 默认 text 输入框。 */
    kind: 'text',
  },
)

/** 当前编辑中歌曲（可能为 null，表单只在 current 非空时渲染）。 */
const current = computed(() => songStore.current)

/** 只读回退文件名（当前选中歌曲的路径最后一段；pendingRename 为空时展示）。 */
const file = computed(() => fileName(songStore.selectedPath ?? ''))

/** 文件名行显示值 = 改名草稿 ?? 原文件名（D5：pendingRename 独立于 Song 字段）。 */
const fileValue = computed(() => songStore.pendingRename ?? file.value)

/** 输入即写改名草稿（空串 → null，回到原文件名；同时清撞名标记）。 */
function onRenameInput(e: Event): void {
  setPendingRename((e.target as HTMLInputElement).value)
}
</script>

<template>
  <div class="field">
    <span class="field-label">{{ label }}</span>

    <!-- 普通文本字段 -->
    <input
      v-if="kind === 'text' && field && current"
      v-model="current[field]"
      class="field-input"
      type="text"
      :placeholder="placeholder ?? '未设置'"
      :disabled="songStore.readonly"
    />

    <!-- 音轨号 / 共：inline-suffix（design.md §5） -->
    <div v-else-if="kind === 'track' && current" class="inline-suffix">
      <input
        v-model="current.track"
        class="field-input track-input"
        type="text"
        placeholder="–"
        :disabled="songStore.readonly"
      />
      <span class="tot">/ 共</span>
      <input
        v-model="current.track_total"
        class="field-input track-total"
        type="text"
        placeholder="–"
        :disabled="songStore.readonly"
      />
    </div>

    <!-- 文件名行：可编辑（v1-rename-sync）。改名独立动作，保存时联动「先改名 → 再写标签」 -->
    <div v-else-if="kind === 'file'" class="file-row" :title="songStore.selectedPath ?? ''">
      <input
        class="field-input file-input"
        type="text"
        :value="fileValue"
        :disabled="songStore.readonly"
        @input="onRenameInput"
      />
      <!-- 撞名被拒行内提示（D6：标签仍写回原路径，换名后重存即完成改名） -->
      <span v-if="songStore.renameRejected" class="file-rejected" role="alert">目标已存在</span>
    </div>
  </div>
</template>

<style scoped>
.field {
  display: grid;
  grid-template-columns: 76px 1fr;
  align-items: center;
  gap: 10px;
  padding: 7px 0;
}

.field-label {
  color: var(--text-dim);
  font-size: 12px;
}

.field-input {
  width: 100%;
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--text);
  padding: 6px 10px;
  border-radius: 6px;
  font: inherit;
  font-size: 13px;
  outline: none;
  transition: border-color 0.12s;
}

.field-input:focus {
  border-color: var(--accent);
}

.field-input::placeholder {
  color: var(--text-dim);
}

.field-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.inline-suffix {
  display: flex;
  align-items: center;
  gap: 6px;
}

.track-input {
  flex: 1;
}

.track-total {
  width: 48px;
  flex: 0 0 auto;
}

.tot {
  color: var(--text-dim);
  font-size: 12px;
  white-space: nowrap;
}

/* 文件名行（可编辑，mono） */
.file-row {
  min-width: 0;
}

.file-input {
  font-family: var(--mono);
  font-size: 12.5px;
}

.file-rejected {
  display: block;
  margin-top: 3px;
  font-size: 11px;
  font-weight: 600;
  color: var(--danger);
}
</style>
