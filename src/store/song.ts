// 单 store 骨架（design.md §10.2，不用 Pinia）。
//
// V1 规模用 Vue 组合式 API 的 `reactive`：`current` / `original` / `dirty`
// 对应 mockup 的 SongEditor 形态。本变更只铺形态占位，不实现切歌/对比/
// 保存逻辑（`dirty` 对比 current/original 的计算留待后续 v1-folder-list 起）。
import { reactive } from 'vue'

import type { LyricsSource, Song } from '../lib/tauri'

/** SongEditor 形态占位：编辑中 / 打开快照 / 脏标记 / 歌词来源。 */
interface SongEditor {
  current: Song | null
  original: Song | null
  dirty: boolean
  lyricsSource: LyricsSource
}

/** 单 store 导出。空状态：无选中歌曲，dirty 恒 false。 */
export const songStore = reactive<SongEditor>({
  current: null,
  original: null,
  dirty: false,
  lyricsSource: 'none',
})
