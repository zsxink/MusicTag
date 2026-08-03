// 纯展示派生（design.md §10 前端 store 职责拆分：selectors → store → api 单向，无环）。
// 只从 songStore 派生展示数据，不持有/修改状态。
import { computed } from 'vue'

import type { MusicSourceId, SongSummary } from '../api/types'
import { fileName, fileNameStem } from '../lib/path'
import { songStore } from './song'

/** 音乐来源平台展示文案（候选来源标签 / badge 平台来源，design §6.4/6.5）。 */
export function sourceLabel(source: MusicSourceId): string {
  switch (source) {
    case 'netease':
      return '网易云'
    case 'qqmusic':
      return 'QQ音乐'
    case 'migu':
      return '咪咕'
  }
}

/** 行内歌名：title trim 空 → 回退文件名（去扩展名）。 */
export function titleText(sum: SongSummary): string {
  return sum.title.trim() !== '' ? sum.title : fileNameStem(sum.path)
}

/** 行内作者：artist trim 空 → 回退文件名（去扩展名）。 */
export function artistText(sum: SongSummary): string {
  return sum.artist.trim() !== '' ? sum.artist : fileNameStem(sum.path)
}

/** 搜索过滤 + 文件名升序的展示列表（spec：按歌名/作者包含、忽略大小写）。
 *  computed 从 songStore 派生；模板用解包后的数组（勿写 `.value`，bug #27 回归）。 */
export const filteredSongs = computed<SongSummary[]>(() => {
  const q = songStore.searchQuery.trim().toLowerCase()
  const sorted = [...songStore.songs].sort((a, b) =>
    fileName(a.path).localeCompare(fileName(b.path)),
  )
  if (q === '') return sorted
  return sorted.filter(
    (x) =>
      x.title.toLowerCase().includes(q) || x.artist.toLowerCase().includes(q),
  )
})
