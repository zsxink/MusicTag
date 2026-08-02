// 单 store（design.md §10.2，不用 Pinia）。v1-folder-list 起承载左栏列表状态。
// 后续 v1-song-read 起的 SongEditor 形态字段（current/original/dirty）再并入。
import { computed, reactive } from 'vue'

import type { LyricsSource, Song, SongSummary } from '../lib/tauri'

/** 文件夹列表 + SongEditor 形态占位。 */
interface SongEditor {
  /** 当前打开的文件夹绝对路径（null = 未打开）。 */
  folderPath: string | null
  /** 当前文件夹全部歌曲列表（invoke('list_songs') 结果）。 */
  songs: SongSummary[]
  /** 搜索框关键词（空 = 不过滤）。 */
  searchQuery: string
  /** 被选中歌曲的 path（null = 无选中）。 */
  selectedPath: string | null
  /** —— SongEditor 占位字段 —— */
  current: Song | null
  original: Song | null
  dirty: boolean
  lyricsSource: LyricsSource
}

/** 取路径最后一段（跨平台兼容 `/` 与 `\` 分隔）。 */
export function fileName(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return i >= 0 ? path.slice(i + 1) : path
}

/** 去扩展名的文件名（空标签回退展示用）。 */
function fileNameStem(path: string): string {
  const name = fileName(path)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

/** 行内歌名：title trim 空 → 回退文件名（去扩展名）。 */
export function titleText(sum: SongSummary): string {
  return sum.title.trim() !== '' ? sum.title : fileNameStem(sum.path)
}

/** 行内作者：artist trim 空 → 回退文件名（去扩展名）。 */
export function artistText(sum: SongSummary): string {
  return sum.artist.trim() !== '' ? sum.artist : fileNameStem(sum.path)
}

const raw = reactive<SongEditor>({
  folderPath: null,
  songs: [],
  searchQuery: '',
  selectedPath: null,
  current: null,
  original: null,
  dirty: false,
  lyricsSource: 'none',
})

/** 只读封装 store（避免组件直接改整个对象；字段仍可单独赋值）。 */
export const songStore = raw

/** 搜索过滤 + 文件名升序的展示列表（spec：按歌名/作者包含、忽略大小写）。 */
export const filteredSongs = computed<SongSummary[]>(() => {
  const q = raw.searchQuery.trim().toLowerCase()
  const sorted = [...raw.songs].sort((a, b) =>
    fileName(a.path).localeCompare(fileName(b.path)),
  )
  if (q === '') return sorted
  return sorted.filter(
    (x) =>
      x.title.toLowerCase().includes(q) || x.artist.toLowerCase().includes(q),
  )
})