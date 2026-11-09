<script setup lang="ts">
// 封面候选格（design §6.4）：默认主动下载缩略图并以 data URL 直接展示（Issue #192 路线 2）。
// 下载走 Rust `download_cover`（loadCoverPreview 限流 4），不依赖 WKWebView 加载外链图片；
// 下载 / 解码失败或 @error 时才切占位态，保留格子与点选（点选再走 pickCoverCandidate）。
import { onMounted, ref } from 'vue'

import type { SongCandidate } from '../api/types'
import { coverBytesToDataUrl } from '../lib/cover'
import { loadCoverPreview } from '../lib/coverPreview'
import { sourceLabel } from '../store/selectors'
import { pickCoverCandidate, songStore } from '../store/song'

const props = defineProps<{
  cand: SongCandidate
}>()

const emit = defineEmits<{
  /** 缩略图未能预览（父组件据此汇总「N 张封面未能预览」提示）。 */
  (e: 'broken'): void
}>()

const imgSrc = ref<string | null>(null)
const broken = ref(false)

/** 切到占位态：不报错、不标红，且同一格只上报一次。 */
function markBroken(): void {
  if (broken.value) return
  broken.value = true
  imgSrc.value = null
  emit('broken')
}

onMounted(async () => {
  const url = props.cand.cover_url
  if (url === null) {
    markBroken()
    return
  }
  const seq = songStore.coverSearchSeq
  try {
    const bytes = await loadCoverPreview(url)
    if (songStore.coverSearchSeq !== seq) return // 已切歌 / 重搜，丢弃结果
    imgSrc.value = coverBytesToDataUrl(bytes)
  } catch {
    if (songStore.coverSearchSeq !== seq) return
    markBroken()
  }
})
</script>

<template>
  <button
    type="button"
    class="cand-cell"
    :class="{ 'is-broken': broken }"
    :title="`${cand.title} — ${cand.artist}`"
    @click="pickCoverCandidate(props.cand)"
  >
    <img v-if="imgSrc" :src="imgSrc" alt="" @error="markBroken" />
    <span v-else class="cand-fallback" aria-hidden="true">
      <span class="cand-fallback-icon"></span>
      <span v-if="broken" class="cand-fallback-text">封面加载失败<br />仍可点选下载</span>
      <span v-else class="cand-fallback-text">封面加载中…</span>
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

/* 失败态：虚线描边标示占位，不标红、不报错 */
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

/* 占位：纯 CSS 方框 + dim 文案，不依赖图标字体 / 外链资源 */
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
