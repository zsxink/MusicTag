<script setup lang="ts">
// 歌词区（design.md §5 lyrics）：head 行（来源 badge + 搜索歌词占位）+ 等宽 textarea。
// - 来源 badge：内嵌标签 / 无，对应 `lyrics_source`（v1-song-read 只有 embedded/none；
//   sidecar 由 v1-lyrics-lrc 补充）。
// - textarea 等宽 mono，`lyrics` v-model 绑 current。
// - 「搜索歌词」按钮占位 disabled（搜索归 v1-search-ui）。
import { computed } from 'vue'

import { songStore } from '../store/song'

/** 来源 badge 文案（映射 lyrics_source → 展示文本，design.md D8 对齐 proposal 定稿）。 */
const sourceText = computed(() => {
  switch (songStore.lyricsSource) {
    case 'embedded':
      return '来源: 内嵌标签'
    case 'sidecar':
      return '来源: 侧载 .lrc'
    default:
      return '来源: 无'
  }
})
</script>

<template>
  <section class="lyrics">
    <div class="lyrics-head">
      <span class="label">歌词</span>
      <span class="badge">{{ sourceText }}</span>
      <!-- 「同时保存为 .lrc」opt-in（design.md D7）：v-model 绑 store.exportLrc，readonly 禁用 -->
      <label class="export-lrc">
        <input
          type="checkbox"
          v-model="songStore.exportLrc"
          :disabled="songStore.readonly"
        />
        同时保存为 .lrc
      </label>
    </div>

    <!-- 搜索歌词占位（v1-search-ui 接语义） -->
    <button class="search-trigger" type="button" disabled>🔍 搜索歌词</button>

    <textarea
      v-if="songStore.current"
      v-model="songStore.current.lyrics"
      class="lyrics-box"
      placeholder="粘贴歌词，可带时间轴（[00:11.32] …）"
      spellcheck="false"
      :disabled="songStore.readonly"
    ></textarea>
  </section>
</template>

<style scoped>
.lyrics {
  border-top: 1px solid var(--border);
  padding-top: 16px;
}

.lyrics-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.label {
  font-weight: 600;
  font-size: 13px;
}

.badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  color: var(--text-dim);
}

.export-lrc {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  color: var(--text-dim);
  cursor: pointer;
  user-select: none;
}

.export-lrc input[type='checkbox'] {
  accent-color: var(--accent);
  cursor: pointer;
}

.export-lrc:has(input:disabled) {
  opacity: 0.5;
  cursor: not-allowed;
}

.export-lrc input:disabled {
  cursor: not-allowed;
}

.search-trigger {
  margin-bottom: 10px;
  width: 100%;
  padding: 6px 0;
  background: transparent;
  border: 1px dashed var(--border);
  border-radius: 6px;
  color: var(--text-dim);
  font-size: 11.5px;
  transition: border-color 0.12s, color 0.12s, transform 0.05s;
}

.search-trigger:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.search-trigger:active {
  transform: translateY(1px);
}

.search-trigger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

.lyrics-box {
  width: 100%;
  min-height: 180px;
  resize: vertical;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  color: var(--text);
  font-family: var(--mono);
  font-size: 12.5px;
  line-height: 1.8;
  padding: 12px 14px;
  outline: none;
  transition: border-color 0.12s;
}

.lyrics-box:focus {
  border-color: var(--accent);
}

.lyrics-box::placeholder {
  color: var(--text-dim);
}

.lyrics-box:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
