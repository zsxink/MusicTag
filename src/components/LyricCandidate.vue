<script setup lang="ts">
// 歌词候选条（design §6.5）：来源标签 + 歌名 — 作者（超长省略），hover 琥珀。
// 点击 → store.pickLyricCandidate（点选才 fetch_lyric 拉文本，惰性拉取；None → C2 换源）。
import type { SongCandidate } from '../api/types'
import { sourceLabel } from '../store/selectors'
import { pickLyricCandidate } from '../store/song'

defineProps<{
  cand: SongCandidate
}>()
</script>

<template>
  <button type="button" class="cand-row" :title="`${cand.title} — ${cand.artist}`" @click="pickLyricCandidate(cand)">
    <span class="src-tag">{{ sourceLabel(cand.source) }}</span>
    <span class="cand-text">{{ cand.title }} — {{ cand.artist }}</span>
  </button>
</template>

<style scoped>
/* design §6.5：来源标签 + 歌名—作者，hover 琥珀 */
.cand-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.12s, background 0.12s;
}

.cand-row:hover {
  border-color: var(--accent);
  background: var(--hover);
}

.cand-row:active {
  transform: translateY(1px);
}

.src-tag {
  flex: 0 0 auto;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  color: var(--text-dim);
}

.cand-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
