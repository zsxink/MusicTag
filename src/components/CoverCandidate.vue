<script setup lang="ts">
// 封面候选格（design §6.4）：1:1 缩略图 + 左下角来源角标；onerror 破图静默隐藏该格。
// 点击 → store.pickCoverCandidate（点选才 download_cover 裸 bytes → lib/cover 压缩，惰性拉取）。
import { ref } from 'vue'

import type { SongCandidate } from '../api/types'
import { sourceLabel } from '../store/selectors'
import { pickCoverCandidate } from '../store/song'

const props = defineProps<{
  cand: SongCandidate
}>()

/** 缩略图破图（onerror）→ 静默隐藏该格（验收 #12：不报错不标红）。 */
const broken = ref(false)
</script>

<template>
  <button
    v-if="!broken"
    type="button"
    class="cand-cell"
    :title="`${cand.title} — ${cand.artist}`"
    @click="pickCoverCandidate(props.cand)"
  >
    <img :src="props.cand.cover_url ?? undefined" alt="" loading="lazy" @error="broken = true" />
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
