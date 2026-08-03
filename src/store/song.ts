// 单 store（design.md §10.2，不用 Pinia）。v1-folder-list 承载左栏列表状态，
// v1-song-read 起承载 SongEditor 编辑状态（current/original/dirty/readonly）。
import { computed, reactive } from 'vue'

import { invokeCommand } from '../lib/tauri'
import type { LyricsSource, Song, SongSummary } from '../lib/tauri'

/** 参与 dirty 判定的可编辑字段（design.md D6：path/lyrics_source 不参与）。 */
const DIRTY_FIELDS = [
  'title',
  'artist',
  'album',
  'album_artist',
  'track',
  'track_total',
  'year',
  'genre',
  'lyrics',
  'cover',
] as const

/** 保存动作态（design.md D7）：`idle/saving/saved/save_failed` 四态；
 *  展示态由 readonly/dirty/saveState 三者合成，saveState 只存动作态避免双写失步。 */
type SaveState = 'idle' | 'saving' | 'saved' | 'save_failed'

/** 文件夹列表 + SongEditor 编辑状态。 */
interface SongEditor {
  /** 当前打开的文件夹绝对路径（null = 未打开）。 */
  folderPath: string | null
  /** 当前文件夹全部歌曲列表（invoke('list_songs') 结果）。 */
  songs: SongSummary[]
  /** 搜索框关键词（空 = 不过滤）。 */
  searchQuery: string
  /** 被选中歌曲的 path（null = 无选中）。 */
  selectedPath: string | null
  /** 编辑中歌曲（open_song 结果，表单 v-model 绑它）。 */
  current: Song | null
  /** 打开时快照（dirty 对比基准；编辑不污染它）。 */
  original: Song | null
  /** 是否未保存（computed：current/original 逐字段对比）。 */
  dirty: boolean
  /** 坏标签只读开关（open_song Err → true，表单禁用）。 */
  readonly: boolean
  /** 快照 `current.lyrics_source`（占位，供 UI badge）。 */
  lyricsSource: LyricsSource
  /** 保存动作态（design.md D7）：saving/saved/save_failed 由 save() 设置；idle 为新歌/换目录/撤销后。 */
  saveState: SaveState
  /** 保存失败原因（saveState='save_failed' 时顶栏展示「✕ 保存失败：原因」）。 */
  saveError: string
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

/**
 * 点击选中一行（spec：点击行 → 该行被选中并高亮）。
 *
 * 传入 `loadSong`（组件侧传 `(path) => invoke('open_song', { path })`）时，选中即触发
 * `open()` 读全量渲染到编辑表单（spec「选中读取完整标签」）；不传则只设选中高亮
 * （v1-folder-list 遗留场景，测试用）。
 */
export async function selectSong(
  path: string | null,
  loadSong?: (path: string) => Promise<Song>,
): Promise<void> {
  raw.selectedPath = path
  if (path !== null && loadSong !== undefined) {
    await open(path, loadSong)
  }
}

/**
 * 打开文件夹并整体替换列表（spec：重新打开整体替换 + 顶栏显示路径）。
 *
 * 换目录同时重置编辑状态（selectedPath/current/original 归零），不残留上一首
 * 的编辑内容。纯状态编排，IPC 依赖以 `loadSongs` 注入（组件侧传
 * `() => invoke('list_songs',{dir})`），便于测试不依赖 Tauri。
 * 目录为 null（用户取消选择）时不改动任何状态。
 */
export async function activateFolder(
  dir: string | null,
  loadSongs: (dir: string) => Promise<SongSummary[]>,
): Promise<void> {
  if (dir === null || dir === '') return // 取消/空，无视
  raw.folderPath = dir
  raw.selectedPath = null
  raw.current = null
  raw.original = null
  raw.readonly = false
  raw.lyricsSource = 'none'
  raw.saveState = 'idle'
  raw.saveError = ''
  raw.songs = await loadSongs(dir)
}

const raw = reactive<SongEditor>({
  folderPath: null,
  songs: [],
  searchQuery: '',
  selectedPath: null,
  current: null,
  original: null,
  // dirty 为 reactive getter（Vue 3.5 会把 getter 转成 live computed）：
  // 任何 `songStore.dirty` 读取都逐字段对比 current/original，编辑即自动翻转。
  get dirty() {
    const { current, original } = this
    if (current === null || original === null) return false
    return DIRTY_FIELDS.some((key) => current[key] !== original[key])
  },
  readonly: false,
  lyricsSource: 'none',
  saveState: 'idle',
  saveError: '',
})

/**
 * 打开一首歌：`open_song` 成功 → `current = original = song`（快照独立）、readonly=false；
 * Err（坏标签）→ current/original=null、readonly=true（表单只读禁用，spec「坏标签只读」）。
 *
 * IPC 依赖以 `loadSong` 参数注入（仿 `activateFolder`），便于测试不依赖 Tauri。
 *
 * 并发守卫：快速连点 A→B 时，两个 `open_song` IPC 响应可能乱序（慢响应后到）。响应到达后
 * 校验 `selectedPath` 仍是本次请求的 path，不是则丢弃（过期响应/过期错误均不得覆盖新选中，
 * 防表单显示旧歌而列表高亮新行的错位）。selectSong 在调用 open() 前已设 `selectedPath`。
 */
export async function open(path: string, loadSong: (path: string) => Promise<Song>): Promise<void> {
  try {
    const song = await loadSong(path)
    if (raw.selectedPath !== path) return // 已切歌/换目录，丢弃过期成功响应
    raw.original = { ...song }
    raw.current = { ...song }
    raw.readonly = false
    raw.lyricsSource = song.lyrics_source
    raw.saveState = 'idle'
    raw.saveError = ''
  } catch {
    if (raw.selectedPath !== path) return // 过期错误同样丢弃，不误设只读
    // open_song 读标签失败（损坏/结构错）→ 只读表单，能看不能改、不能保存
    raw.current = null
    raw.original = null
    raw.readonly = true
    raw.lyricsSource = 'none'
    raw.saveState = 'idle'
    raw.saveError = ''
  }
}

/**
 * 保存当前编辑 = 表单全量覆盖写回原路径（design.md D7 / D9）。
 *
 * IPC 依赖以 `saveFn` 参数注入（仿 open 的 loadSong），组件侧传
 * `(song) => invoke('save_song', { song })`，便于测试不依赖 Tauri。
 *
 * 状态机：`saving` → 成功快照 `original={...current}`（新对比基准，dirty 归 false）
 * + `saveState='saved'`；失败保留 `current`（可重试、dirty 保持 true）+ `saveError`
 * + `saveState='save_failed'`（绝不假报已保存，FR-5.4a）。
 * 只读/无歌不执行；保存中禁用再次保存（防连点并发写同一文件）。
 */
export async function save(
  saveFn: (song: Song) => Promise<void> = (song) =>
    invokeCommand('save_song', { song }).then(() => undefined),
): Promise<void> {
  if (raw.readonly || raw.current === null) return
  raw.saveState = 'saving'
  try {
    await saveFn(raw.current)
    raw.original = { ...raw.current } // 新基准：当前已写盘，dirty 归 false
    raw.saveState = 'saved'
  } catch (e) {
    raw.saveError = String(e) // current 保留、original 不更新 → dirty 保持 true
    raw.saveState = 'save_failed'
  }
}

/**
 * 编辑区撤销（design.md D8）：`current` 恢复为打开时 `original` 快照（非磁盘级），
 * 回到打开时基准；`original` 不被覆盖，再编辑可再撤销。saveState 归 idle。
 */
export async function undo(): Promise<void> {
  if (raw.original === null) return
  raw.current = { ...raw.original }
  raw.saveState = 'idle'
  raw.saveError = ''
}

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