<script setup lang="ts">
// 左栏单行（v1-folder-list）：「作者 - 歌名」；title/artist 前端 trim 空 → 回退文件名（去扩展名）。
// 选中态用 design.md `--active` 琥珀底 + 歌名变琥珀。
// v1-song-read：选中即触发 `open_song` 读全量（spec「选中读取完整标签」）。
import { openSong } from '../api/songs'
import type { Song, SongSummary } from '../api/types'
import { artistText, titleText } from '../store/selectors'
import { selectSong, songStore } from '../store/song'

const props = defineProps<{
  song: SongSummary
}>()

/** 该行是否被选中（store 比对 path）。 */
const isSelected = () => songStore.selectedPath === props.song.path

/** 打开歌曲：api/songs.ts 的 openSong（invoke('open_song', { path }) 读全量标签）。 */
function loadSong(path: string): Promise<Song> {
  return openSong(path)
}

/** 点击选中该行并读取完整标签。 */
function select() {
  selectSong(props.song.path, loadSong)
}
</script>

<template>
  <li
    class="song-row"
    :class="{ selected: isSelected() }"
    :data-path="song.path"
    @click="select"
  >
    <span class="row-artist">{{ artistText(song) }}</span>
    <span class="row-title">{{ titleText(song) }}</span>
  </li>
</template>

<style scoped>
.song-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
}

.song-row:hover {
  background: var(--hover);
}

.song-row.selected {
  background: var(--active);
}

.song-row.selected .row-title {
  color: var(--accent);
}

.row-artist {
  color: var(--text-dim);
  font-size: 12px;
}

.row-title {
  color: var(--text);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>