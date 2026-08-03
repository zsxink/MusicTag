// 单 store（design.md §10.2，不用 Pinia）。v1-folder-list 承载左栏列表状态，
// v1-song-read 起承载 SongEditor 编辑状态（current/original/dirty/readonly）。
//
// §10 职责拆分：本文件只留 reactive 状态 + 动作 + dirty getter；
// 纯工具（fileName/fileNameStem）在 lib/path.ts，纯展示派生（titleText/artistText/filteredSongs）
// 在 store/selectors.ts，IPC 类型化封装在 api/songs.ts。
import { reactive } from 'vue'

import { renameSong as defaultRename } from '../api/songs'
import { saveSong as defaultSave } from '../api/songs'
import type { CoverInput, LyricsSource, Song, SongSummary } from '../api/types'
import { fileName, replaceFileName } from '../lib/path'

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
  /** 保存时同步写 `.lrc` 的 opt-in 复选框（design.md D7：独立 UI 状态，非 Song 字段、不进 DIRTY_FIELDS）。 */
  exportLrc: boolean
  /** 保存动作态（design.md D7）：saving/saved/save_failed 由 save() 设置；idle 为新歌/换目录/撤销后。 */
  saveState: SaveState
  /** 保存失败原因（saveState='save_failed' 时顶栏展示「✕ 保存失败：原因」）。 */
  saveError: string
  /** 改名草稿（v1-rename-sync D5）：改后的新文件名，null = 未改。独立 UI 状态，
   *  非 Song 字段、不进 DIRTY_FIELDS（单改文件名不脏表单，保存门禁单独放行 renamePending）。 */
  pendingRename: string | null
  /** 派生：是否存在待改名（pendingRename !== null）。保存门禁单独放行（D5，同 exportLrc 先例）。 */
  renamePending: boolean
  /** 改名被拒标记（撞名）：供文件名行内提示「目标已存在」，换名后重存即完成改名（D6）。 */
  renameRejected: boolean
}

/**
 * 点击选中一行（spec：点击行 → 该行被选中并高亮）。
 *
 * 传入 `loadSong`（组件侧传 `api/songs.ts` 的 `openSong`）时，选中即触发
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
 * `(dir) => listSongs(dir)`，即 `api/songs.ts` 的 listSongs），便于测试不依赖 Tauri。
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
  raw.exportLrc = false // design.md D7：换目录重置 opt-in
  raw.saveState = 'idle'
  raw.saveError = ''
  raw.pendingRename = null // design.md D8：换目录弃置改名草稿
  raw.renameRejected = false
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
  // **必须原位保留在 reactive 字面量内**——挪出即失去响应式追踪，dirty 不再随编辑更新。
  get dirty() {
    const { current, original } = this
    if (current === null || original === null) return false
    return DIRTY_FIELDS.some((key) => current[key] !== original[key])
  },
  /** 派生：是否存在待改名（pendingRename !== null）。保存门禁单独放行（D5，同 exportLrc 先例）。 */
  get renamePending() {
    return this.pendingRename !== null
  },
  readonly: false,
  lyricsSource: 'none',
  exportLrc: false,
  saveState: 'idle',
  saveError: '',
  pendingRename: null,
  renameRejected: false,
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
    raw.exportLrc = false // design.md D7：切歌重置 opt-in（每首歌默认不勾选）
    raw.saveState = 'idle'
    raw.saveError = ''
    raw.pendingRename = null // design.md D8：切歌弃置改名草稿（回到打开时文件名）
    raw.renameRejected = false
  } catch {
    if (raw.selectedPath !== path) return // 过期错误同样丢弃，不误设只读
    // open_song 读标签失败（损坏/结构错）→ 只读表单，能看不能改、不能保存
    raw.current = null
    raw.original = null
    raw.readonly = true
    raw.lyricsSource = 'none'
    raw.exportLrc = false
    raw.saveState = 'idle'
    raw.saveError = ''
    raw.pendingRename = null
    raw.renameRejected = false
  }
}

/**
 * 保存当前编辑 = 表单全量覆盖写回原路径（design.md D7 / D9）。
 *
 * `exportLrc`（D3/D7）：保存期 opt-in——true 时经 `saveFn(current, true)` 同步写同目录
 * 同名 `.lrc`（空歌词由 Rust 侧 no-op）；仅切歌/换目录重置，保存成功后保持勾选。
 *
 * v1-rename-sync（D5/D6）：保存联动改名——若 `pendingRename` 非空（改名草稿）：
 * - 与当前文件名相同 → 无操作（清草稿）；
 * - 否则先 `renameFn(current.path, pendingRename)` 改名成功 → 路径同步
 *   （current.path / selectedPath / songs 列表项 = replaceFileName(old, new)）、清草稿；
 *   改名被拒（撞名）→ `renameRejected=true`、`saveError` 置「目标已存在」，
 *   但**不 return**：FR-5.6 标签仍写回原路径（改名被拒不影响标签保存，D6）。
 * 再 `saveFn(current, exportLrc)`：current.path = 新路径（改名成功）或原路径（被拒）。
 *
 * IPC 依赖以 `saveFn` / `renameFn` 参数注入（仿 open 的 loadSong），默认 loader 为
 * `api/songs.ts` 的 `saveSong` / `renameSong`（经 api/client → invoke），测试可注入
 * 自定义函数不依赖 Tauri。
 *
 * 状态机：`saving` → 成功快照 `original={...current}`（新对比基准，dirty 归 false）
 * + `saveState='saved'`；失败保留 `current`（可重试、dirty 保持 true）+ `saveError`
 * + `saveState='save_failed'`（绝不假报已保存，FR-5.4a）。
 * 保存状态按**标签写盘结果**定——改名被拒不报「保存失败」（D6 假象）。
 * 只读/无歌不执行；保存中禁用再次保存（防连点并发写同一文件）。
 */
export async function save(
  exportLrc: boolean,
  saveFn: (song: Song, exportLrc: boolean) => Promise<void> = defaultSave,
  renameFn: (path: string, newName: string) => Promise<void> = defaultRename,
): Promise<void> {
  if (raw.readonly || raw.current === null) return
  raw.saveState = 'saving'

  // 改名联动（独立动作，D5）：pendingRename 非空才进改名分支
  if (raw.pendingRename !== null) {
    if (raw.pendingRename === fileName(raw.current.path)) {
      // 与当前同名 = 无操作（用户改回原样再保存）
      raw.pendingRename = null
      raw.renameRejected = false
    } else {
      const oldPath = raw.current.path
      try {
        await renameFn(oldPath, raw.pendingRename)
        // 改名成功 → 路径同步（当前/选中/列表项），新路径由前端 replaceFileName 计算（D4）
        const newPath = replaceFileName(oldPath, raw.pendingRename)
        raw.current.path = newPath
        raw.selectedPath = newPath
        raw.songs = raw.songs.map((s) => (s.path === oldPath ? { ...s, path: newPath } : s))
        raw.pendingRename = null
        raw.renameRejected = false
      } catch (e) {
        // 撞名被拒（或改名失败）→ 行内提示「目标已存在」；不 return：标签仍写回原路径（FR-5.6）
        raw.renameRejected = true
        raw.saveError = String(e)
      }
    }
  }

  try {
    await saveFn(raw.current, exportLrc) // current.path = 新路径（改名成功）或原路径（被拒）
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
 * v1-rename-sync：同时弃置改名草稿（pendingRename / renameRejected，design.md D8）。
 */
export async function undo(): Promise<void> {
  if (raw.original === null) return
  raw.current = { ...raw.original }
  raw.saveState = 'idle'
  raw.saveError = ''
  raw.pendingRename = null
  raw.renameRejected = false
}

/**
 * 写改名草稿（v1-rename-sync D5）：`pendingRename` 独立 UI 状态（非 Song 字段、
 * 不进 DIRTY_FIELDS，单改文件名不脏表单）。空串/空 → null（回到原文件名）；写入即清
 * `renameRejected`（换名后重存 = 重新尝试改名）。readonly（坏标签只读）时无视。
 */
export function setPendingRename(name: string | null): void {
  if (raw.readonly) return
  raw.pendingRename = name === null || name === '' ? null : name
  raw.renameRejected = false
}

/**
 * 封面区写入封面（v1-cover-embed D5）：压缩后 data URL → `current.cover`（预览即压缩图），
 * mime → `current.cover_mime`（badge 展示）。`cover` 已在 `DIRTY_FIELDS` → 自动翻转 dirty。
 * 无歌（current=null）或坏标签只读时无视（组件已 `:disabled` 守卫，双保险）。
 */
export function setCover(input: CoverInput): void {
  if (raw.readonly || raw.current === null) return
  raw.current.cover = input.data_url
  raw.current.cover_mime = input.mime
}

/**
 * 清空封面：置 `null` → 保存后 `apply_cover` 不 push、既有封面被清除（全量覆盖语义）。
 * `cover` 置 null 与 original 的 cover 不一致 → dirty 翻转（配合删除标记）。
 */
export function clearCover(): void {
  if (raw.readonly || raw.current === null) return
  raw.current.cover = null
  raw.current.cover_mime = null
}

/** 只读封装 store（避免组件直接改整个对象；字段仍可单独赋值）。 */
export const songStore = raw
