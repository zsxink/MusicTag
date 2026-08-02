<script setup lang="ts">
// 单字段行（design.md §5 field）：左标签 + 右输入框。
// 三形态：
// - `text`：普通文本字段（歌名/作者/专辑/专辑作者/年份/流派），v-model 绑 current
// - `track`：音轨号 `track` / 共 `track_total`（inline-suffix 布局）
// - `file`：文件名行，只读展示（mono），改名归 v1-rename-sync
import { computed } from 'vue'

import { fileName, songStore } from '../store/song'

const props = withDefaults(
  defineProps<{
    /** 字段标签（如「歌名」「音轨号」）。 */
    label: string
    /** 字段 key（绑 current[key]）；`file`/`track` 形态可缺省。 */
    field?: 'title' | 'artist' | 'album' | 'album_artist' | 'year' | 'genre'
    /** 输入框占位符。 */
    placeholder?: string
    /** 形态：默认 text；track = 音轨号/总数对；file = 只读文件名行。 */
    kind?: 'text' | 'track' | 'file'
  }>(),
  {
    /** 普通字段行（歌名/作者/专辑/专辑作者/年份/流派）不传 kind → 默认 text 输入框。 */
    kind: 'text',
  },
)

/** 当前编辑中歌曲（可能为 null，表单只在 current 非空时渲染）。 */
const current = computed(() => songStore.current)

/** 只读文件名（当前选中歌曲的路径最后一段）。 */
const file = computed(() => fileName(songStore.selectedPath ?? ''))
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

    <!-- 文件名行：只读 mono（改名归 v1-rename-sync） -->
    <div v-else-if="kind === 'file'" class="file-row" :title="songStore.selectedPath ?? ''">
      <span class="file-name">{{ file }}</span>
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

/* 文件名行（mono） */
.file-row {
  min-width: 0;
}

.file-name {
  display: block;
  font-family: var(--mono);
  font-size: 12.5px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
