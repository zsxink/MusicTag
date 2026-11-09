<script setup lang="ts">
// 封面候选格（design §6.4）：1:1 缩略图 + 左下角来源角标。
// 缩略图破图时只切换为占位态、保留格子与点选（Issue #192）：点选走 Rust download_cover，
// 不依赖 WebView 能否加载远程图片；整格移除会让「有候选」表现成「搜不到封面」。
import { ref } from 'vue'

import type { SongCandidate } from '../api/types'
import { sourceLabel } from '../store/selectors'
import { pickCoverCandidate } from '../store/song'

const props = defineProps<{
  cand: SongCandidate
}>()

const emit = defineEmits<{
  /** 缩略图加载失败（父组件据此汇总「N 张加载失败」提示）。 */
  (e: 'broken'): void
}>()

/** 破图 → 只隐藏 img 并显示占位，不移除整个按钮（不报错、不标红；保留点选入口）。 */
const broken = ref(false)
function onImageError(): void {
  if (broken.value) return
  broken.value = true
  emit('broken')
}
</script>

<template>
  <button
    type="button"
    class="cand-cell"
    :class="{ 'is-broken': broken }"
    :title="`${cand.title} — ${cand.artist}`"
    @click="pickCoverCandidate(props.cand)"
  >
    <img
      v-if="!broken"
      :src="props.cand.cover_url ?? undefined"
      alt=""
      loading="lazy"
      @error="onImageError"
    />
    <span v-else class="cand-fallback" aria-hidden="true">
      <span class="cand-fallback-icon"></span>
      <span class="cand-fallback-text">缩略图加载失败<br />仍可点选下载</span>
    </span>
    <span class="src-tag">{{ sourceLabel(props.cand.source) }}</span>
  </button>
</template>

<style scoped>
/* design §6.4：3 列网格的一格（1:1 方形，圆角描边，hover 琥珀） */
.cand-cell {
  position: relative;
  aspect-ratio: 1;
  width: 100%;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  background: var(--panel-2);
  cursor: pointer;
  transition: border-color 0.12s;
}

/* 破图态：虚线描边标示占位，不标红、不报错 */
.cand-cell.is-broken {
  border-style: dashed;
}

.cand-cell:hover {
  border-color: var(--accent);
}

.cand-cell:active {
  transform: translateY(1px);
}

.cand-cell img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  pointer-events: none;
}

/* 破图占位：纯 CSS 方框 + dim 文案，不依赖图标字体/外链资源 */
.cand-fallback {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 4px;
  color: var(--text-dim);
  font-size: 9px;
  line-height: 1.4;
  text-align: center;
  pointer-events: none;
}

.cand-fallback-icon {
  width: 20px;
  height: 20px;
  border: 1px dashed var(--text-dim);
  border-radius: 2px;
}

/* 来源角标（左下角，9px 白字、半透明底、3px 圆角） */
.src-tag {
  position: absolute;
  left: 3px;
  bottom: 3px;
  max-width: calc(100% - 6px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 9px;
  line-height: 1.4;
  padding: 0 4px;
  border-radius: 3px;
  color: #fff;
  background: rgba(0, 0, 0, 0.6);
  pointer-events: none;
}
</style>
