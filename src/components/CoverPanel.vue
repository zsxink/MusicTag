<script setup lang="ts">
// 封面区（design.md §5 cover）：1:1 封面预览 + 无封面空态占位 + 搜索封面按钮占位。
// - `current.cover` 为 base64 data URL，`<img :src>` 直接用（IPC 契约）。
// - 无封面 → 虚线框 + 占位提示（spec「封面区占位」）。
// - 「搜索封面」按钮占位 disabled（搜索归 v1-search-ui）。
import { computed } from 'vue'

import { songStore } from '../store/song'

const cover = computed(() => songStore.current?.cover ?? null)
const coverMime = computed(() => songStore.current?.cover_mime ?? null)
</script>

<template>
  <div class="cover">
    <!-- 有封面：1:1 预览 -->
    <div v-if="cover" class="cover-box has-cover">
      <img :src="cover" alt="封面" class="cover-img" />
    </div>

    <!-- 无封面：虚线框空态占位 -->
    <div v-else class="cover-box cover-empty">
      <span class="cover-mark" aria-hidden="true">🖼</span>
      <span class="cover-hint">无封面</span>
    </div>

    <div class="cover-meta">{{ coverMime ? coverMime : '未设置' }}</div>

    <!-- 搜索封面占位（v1-search-ui 接语义） -->
    <button class="search-trigger" type="button" disabled>🔍 搜索封面</button>
  </div>
</template>

<style scoped>
.cover {
  width: 200px;
}

.cover-box {
  aspect-ratio: 1;
  width: 100%;
  border: 1px dashed var(--border);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-dim);
  background: var(--panel-2);
  overflow: hidden;
  transition: border-color 0.12s;
}

.cover-box.has-cover {
  border-style: solid;
  padding: 0;
}

.cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.cover-empty:hover {
  border-color: var(--accent);
}

.cover-mark {
  font-size: 30px;
  opacity: 0.4;
}

.cover-hint {
  font-size: 11.5px;
}

.cover-meta {
  margin-top: 8px;
  text-align: center;
  color: var(--text-dim);
  font-size: 11px;
  font-family: var(--mono);
}

.search-trigger {
  margin-top: 10px;
  width: 100%;
  padding: 6px 0;
  background: transparent;
  border: 1px dashed var(--border);
  border-radius: 6px;
  color: var(--text-dim);
  font-size: 11.5px;
  transition: border-color 0.12s, color 0.12s;
}

.search-trigger:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.search-trigger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
