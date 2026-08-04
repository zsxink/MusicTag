// 单 store（design.md §10.2，不用 Pinia）。v1-folder-list 承载左栏列表状态，
// v1-song-read 起承载 SongEditor 编辑状态（current/original/dirty/readonly）。
//
// §10 职责拆分：本文件只留 reactive 状态 + 动作 + dirty getter；
// 纯工具（fileName/fileNameStem）在 lib/path.ts，纯展示派生（titleText/artistText/filteredSongs）
// 在 store/selectors.ts，IPC 类型化封装在 api/songs.ts。
import { reactive } from 'vue'

import { downloadCover as defaultDownloadCover } from '../api/search'
import { fetchLyric as defaultFetchLyric } from '../api/search'
import { searchSongs as defaultSearchSongs } from '../api/search'
import { searchSource as defaultSearchSource } from '../api/search'
import { renameSong as defaultRename } from '../api/songs'
import { saveSong as defaultSave } from '../api/songs'
import type {
  CoverInput,
  LyricsSource,
  MusicSourceId,
  SearchResult,
  Song,
  SongCandidate,
  SongSummary,
} from '../api/types'
import { bytesToCoverInput as defaultBytesToCoverInput } from '../lib/cover'
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

/** 搜索态（v1-search-ui D2：按 kind 分离，歌词/封面各管各的候选区独立状态机）。
 *  自动搜索可同时搜两类、手动搜索只搜一类——若为全局单值，手动搜歌词会让封面面板误显「搜索中…」。 */
type SearchState = 'idle' | 'searching' | 'done'

/** 切歌/换目录未保存确认的待办动作（v1-ux-settings D1：两个入口共享同一三选一状态机）。
 *  pendingAction 非 null → App 渲染 <SwitchDialog/>；loader 闭包存 reactive 合法（仿 saveFn 注入先例）。 */
export type PendingAction =
  | { kind: 'switch'; path: string; loadSong?: (path: string) => Promise<Song> }
  | { kind: 'folder'; dir: string; loadSongs: (dir: string) => Promise<SongSummary[]> }

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
  /** 未保存时切歌/换目录的待确认动作（null = 无；非 null → App 渲染 SwitchDialog 三选一）。 */
  pendingAction: PendingAction | null
  /** 歌词搜索态（D2）：idle/searching/done，歌词候选区独立状态机。 */
  lyricSearchState: SearchState
  /** 封面搜索态（D2）：idle/searching/done，封面候选区独立状态机。 */
  coverSearchState: SearchState
  /** 歌词候选（search_song 的 songs，后端已打分去重排序）。 */
  lyricCandidates: SongCandidate[]
  /** 封面候选（songs 中 cover_url 非 null 的子集）。 */
  coverCandidates: SongCandidate[]
  /** 会话级离线（D3）：自动搜索全源失败首响置位，sticky 到重启；后续选中不再自动搜。 */
  isOffline: boolean
  /** 本首已判定过「选中即搜」（D1 仅一次；删除内容不重算，切歌由 resetSearchState 清零）。 */
  searchedThisSong: boolean
  /** 点选歌词候选的来源平台（badge 展示「来源: 网易云 / QQ音乐 / 咪咕」；null = 未点选，沿用 lyricsSource）。 */
  lyricSourcePlatform: MusicSourceId | null
  /** C2 全源取词失败 → 空态「未找到匹配的歌词，可手动粘贴」。 */
  lyricFetchEmpty: boolean
  /** 歌词搜索序号（D2.6 过期守卫，v1-search-fixes 按 kind 分离）：每次歌词搜索捕获
   *  `mySeq=++lyricSearchSeq`，resolve 时 `mySeq≠lyricSearchSeq` 丢弃结果。
   *  与封面计数器分离——避免任一面板搜索作废另一面板在途结果（跨 kind 串扰卡死）。 */
  lyricSearchSeq: number
  /** 封面搜索序号（同上，独立于歌词）。 */
  coverSearchSeq: number
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
    // D1：选中即搜——open 成功后、current 非空且 !readonly 触发（后台异步，不阻塞编辑）。
    // resolvePending 的保存后切歌路径天然收敛于此（open 是选中唯一路径）。
    if (raw.current !== null && !raw.readonly) {
      void autoSearchOnSelect()
    }
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
  resetSearchState() // D5：换目录候选生命周期 = 当前歌曲，作废在途搜索（isOffline 会话级不清）
  raw.songs = await loadSongs(dir)
}

/**
 * 切歌拦截门（v1-ux-settings D1）：有未保存修改时弹三选一（保存/不保存/取消），
 * 无 dirty 直接执行 selectSong（行为不变，spec「无修改直接切」）。
 * 点击已选中行（path === selectedPath）为 no-op（与 mockup onRowClick 同语义，防重读丢编辑）。
 */
export function requestSwitch(
  path: string,
  loadSong?: (path: string) => Promise<Song>,
): Promise<void> {
  // D1 单一 pending 状态机：弹窗已打开（pendingAction 非 null）→ 忽略新请求，
  // 不覆盖原 pending 意图（否则 ⌘O/点行会静默改道三选一的语境）。
  if (raw.pendingAction !== null) return Promise.resolve()
  if (path === raw.selectedPath) return Promise.resolve()
  if (raw.dirty) {
    raw.pendingAction = { kind: 'switch', path, loadSong }
    return Promise.resolve()
  }
  return selectSong(path, loadSong)
}

/**
 * 换目录拦截门（v1-ux-settings D1）：有未保存修改时复用同一三选一弹窗
 * （spec「换目录未保存确认复用」：取消则不换目录；保存写当前编辑歌原路径）。
 * 无 dirty 直接执行 activateFolder（行为不变）。dir 为 null/空（用户取消原生选择器）时无视
 * （即使 dirty 也不弹窗——用户已明确取消，保持当前状态）。
 */
export function requestFolder(
  dir: string | null,
  loadSongs: (dir: string) => Promise<SongSummary[]>,
): Promise<void> {
  // D1 单一 pending 状态机：弹窗已打开 → 忽略新请求（弹窗打开期间 ⌘O 不得覆盖原 pending）。
  if (raw.pendingAction !== null) return Promise.resolve()
  if (dir === null || dir === '') return Promise.resolve()
  if (raw.dirty) {
    raw.pendingAction = { kind: 'folder', dir, loadSongs }
    return Promise.resolve()
  }
  return activateFolder(dir, loadSongs)
}

/**
 * 弹窗三选一收尾（v1-ux-settings D1–D3）：
 * - 'save'：完整复用 store.save（saveState 四态 + exportLrc + rename 联动，与顶栏保存按钮语义一致）。
 *   成功（saveState='saved'）→ 执行 pending 动作（切歌/换目录）→ 清 pending；
 *   失败（saveState='save_failed'）→ **弹窗保持打开、不切换**、顶栏「✕ 保存失败」、
 *   dirty 保持 true（D3：保存先写再切，失败时绝不切走丢内容）。
 * - 'discard'：不保存，直接执行 pending 动作（切换即弃置编辑）→ 清 pending。
 * 保存中（saveState='saving'）忽略再次调用（防连点并发写同一文件，弹窗「保存」按钮已禁用双保险）。
 * 竞态守卫（CR）：await save 之后、执行 pending 动作之前校验 pendingAction 身份 ——
 *   保存进行中用户取消（cancelPending）或 discard 改道 → pending 已清 → 保存结果仅落盘、
 *   不再切换（spec「取消留在当前」）；保存进行中 discard → 忽略，防意图丢弃仍写盘。
 * saveFn/renameFn 可注入（仿 save() 先例），测试不依赖 Tauri。
 */
export async function resolvePending(
  choice: 'save' | 'discard',
  saveFn?: (song: Song, exportLrc: boolean) => Promise<void>,
  renameFn?: (path: string, newName: string) => Promise<void>,
): Promise<void> {
  const action = raw.pendingAction
  if (action === null) return

  if (choice === 'save') {
    if (raw.saveState === 'saving') return // 防连点并发写同一文件
    await save(raw.exportLrc, saveFn, renameFn)
    if (raw.pendingAction !== action) return // 保存中已取消 → 只保留保存结果、不切换（CR）
    if (raw.saveState !== 'saved') return // 保存失败 → 弹窗保持打开、不切换（D3）
  } else {
    if (raw.saveState === 'saving') return // 保存中改道 discard → 忽略，防意图丢弃仍写盘（CR）
  }

  // 保存成功 / 丢弃 → 执行 pending 动作 → 清 pending
  raw.pendingAction = null
  if (action.kind === 'switch') {
    await selectSong(action.path, action.loadSong)
  } else {
    await activateFolder(action.dir, action.loadSongs)
  }
}

/** 取消：清 pending、留在当前（spec「取消留在当前」/「换目录取消不换目录」）。 */
export function cancelPending(): void {
  raw.pendingAction = null
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
  pendingAction: null,
  lyricSearchState: 'idle',
  coverSearchState: 'idle',
  lyricCandidates: [],
  coverCandidates: [],
  isOffline: false,
  searchedThisSong: false,
  lyricSourcePlatform: null,
  lyricFetchEmpty: false,
  lyricSearchSeq: 0,
  coverSearchSeq: 0,
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
    resetSearchState() // D5：候选生命周期 = 当前歌曲，作废在途搜索（isOffline 会话级不清）
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
    resetSearchState() // D5：坏标签同样重置搜索状态（无歌可搜）
  }
}

/**
 * 候选生命周期 = 当前歌曲（D5）：清两类候选、searchState 归 idle、searchedThisSong=false、
 * `lyricSourcePlatform=null`、`lyricFetchEmpty=false`、`lyricSearchSeq++` 与 `coverSearchSeq++`
 * （作废在途搜索——切歌后旧搜索结果 resolve 时 mySeq≠对应 kind 序号即丢弃，D2.6）。
 * `isOffline` 不清（会话级）。open（成功+失败分支）与 activateFolder 均调用；
 * 未点选候选切歌直接丢弃、无弹窗（FR-8.14）。
 */
function resetSearchState(): void {
  raw.lyricCandidates = []
  raw.coverCandidates = []
  raw.lyricSearchState = 'idle'
  raw.coverSearchState = 'idle'
  raw.searchedThisSong = false
  raw.lyricSourcePlatform = null
  raw.lyricFetchEmpty = false
  raw.lyricSearchSeq++
  raw.coverSearchSeq++
}

/**
 * 选中即搜（D1）：守卫 current 非空 / !readonly / !searchedThisSong / !isOffline →
 * 判定只补缺失（`lyrics.trim()==='' && lyricsSource!=='sidecar'` 搜歌词；`cover===null` 搜封面）→
 * 有缺失才搜 → 每类捕获独立序号（`++lyricSearchSeq` / `++coverSearchSeq`，过期守卫，v1-search-fixes
 * 按 kind 分离防跨类串扰）→ searching → 分桶填充 → done。
 *
 * resolve 后 `result.all_failed`（后端 v1-search-fixes：三源**全部网络失败/超时**）→ `isOffline=true`
 * （会话级、sticky，仅自动搜索判定 D3）；IPC reject 按全源失败同样标记（防御）。仅将**本次实际
 * 搜索过且结果仍有效的那一类** searchState 归 idle（修复离线分支误归两类、未搜类也显示离线提示）。
 * 冷门歌「三源成功但空」不再判离线（all_failed=false，FR-8.4a 语义）。IPC 依赖以 `searchSongs`
 * 注入（默认 api/search.ts，测试注入桩）。
 *
 * 裸文件守卫（CR：避免离线误判）：`title.trim() === ''` 直接 return——后端 `search_song`
 * 对空 title 无短路守卫（空关键字三源很可能全 0），每次选中白发一次必为空的 3 源并发搜索。
 * D1 设计明确此类应走手动按钮（FR-8.13：填歌名后手动搜）。故裸文件不自动搜、也不置
 * `searchedThisSong`（尚未「判定过」，与 null/readonly/offline 守卫同为前置守卫语义）。
 */
export async function autoSearchOnSelect(
  searchSongs: (title: string, artist: string) => Promise<SearchResult> = defaultSearchSongs,
): Promise<void> {
  const cur = raw.current
  if (cur === null || raw.readonly || raw.searchedThisSong || raw.isOffline) return
  if (cur.title.trim() === '') return // 裸文件（title 空，FR-8.13）：不自动搜，避免空搜索 + 离线误判；填歌名后走手动按钮
  raw.searchedThisSong = true // 本首已判定过（删除内容后 flag 不重算，切歌才清零）
  const needLyrics = cur.lyrics.trim() === '' && raw.lyricsSource !== 'sidecar'
  const needCover = cur.cover === null
  if (!needLyrics && !needCover) return // 已有内容 → 不搜（候选区保持 idle）
  const lyricSeq = needLyrics ? ++raw.lyricSearchSeq : null
  const coverSeq = needCover ? ++raw.coverSearchSeq : null
  if (needLyrics) raw.lyricSearchState = 'searching'
  if (needCover) raw.coverSearchState = 'searching'
  try {
    const result = await searchSongs(cur.title, cur.artist) // 一次调用同时喂两类候选（惰性拉取）
    // 每类独立校验过期：任一类被新搜索/切歌作废，只丢弃该类，不影响仍有效的那类。
    const lyricValid = lyricSeq !== null && raw.lyricSearchSeq === lyricSeq
    const coverValid = coverSeq !== null && raw.coverSearchSeq === coverSeq
    if (!lyricValid && !coverValid) return
    if (lyricValid) {
      raw.lyricCandidates = result.songs
      raw.lyricSearchState = 'done'
    }
    if (coverValid) {
      raw.coverCandidates = result.songs.filter((s) => s.cover_url !== null)
      raw.coverSearchState = 'done'
    }
    if (result.all_failed) {
      // 后端 D8/v1-search-fixes：三源全部失败 → 离线（冷门歌正常空结果 all_failed=false 不触发）
      raw.isOffline = true
      if (lyricValid) raw.lyricSearchState = 'idle'
      if (coverValid) raw.coverSearchState = 'idle'
    }
  } catch {
    const lyricValid = lyricSeq !== null && raw.lyricSearchSeq === lyricSeq
    const coverValid = coverSeq !== null && raw.coverSearchSeq === coverSeq
    if (!lyricValid && !coverValid) return
    raw.isOffline = true // IPC reject 按全源失败同样标记（防御）
    if (lyricValid) raw.lyricSearchState = 'idle'
    if (coverValid) raw.coverSearchState = 'idle'
  }
}

/**
 * 手动搜索按钮（D7）：无视离线 / 缺失判定，用户主动发起即刷新对应 kind 候选。
 * `searchState` 各自 searching → done；手动搜索失败不标离线（D3 仅自动搜索判定），
 * 空候选 + done → 候选区空态（cand-empty）。readonly / 无歌时禁用（组件守卫，双保险）。
 * 搜歌词时清 `lyricFetchEmpty`（CR C2）：新搜索作废上次 C2 全源失败空态，否则残留旧
 * 空态会遮蔽本次返回的新候选（模板 lyricFetchEmpty 分支优先于 done 候选列表）。
 */
export async function manualSearch(
  kind: 'lyrics' | 'cover',
  searchSongs: (title: string, artist: string) => Promise<SearchResult> = defaultSearchSongs,
): Promise<void> {
  const cur = raw.current
  if (cur === null || raw.readonly) return
  // 并发守卫（v1-search-fixes 按 kind 分离）：只自增本类序号——搜索中重复点本类按钮重搜
  // → 旧结果作废；不再误作废另一类在途搜索（修复跨 kind 串扰卡死）。
  const mySeq = kind === 'lyrics' ? ++raw.lyricSearchSeq : ++raw.coverSearchSeq
  if (kind === 'lyrics') {
    raw.lyricSearchState = 'searching'
    raw.lyricFetchEmpty = false // 新搜索作废上次 C2 全源失败空态（避免残留旧空态遮蔽新候选）
  } else raw.coverSearchState = 'searching'
  try {
    const result = await searchSongs(cur.title, cur.artist)
    if (kind === 'lyrics' ? raw.lyricSearchSeq !== mySeq : raw.coverSearchSeq !== mySeq) return
    if (kind === 'lyrics') {
      raw.lyricCandidates = result.songs
      raw.lyricSearchState = 'done'
    } else {
      raw.coverCandidates = result.songs.filter((s) => s.cover_url !== null)
      raw.coverSearchState = 'done'
    }
  } catch {
    if (kind === 'lyrics' ? raw.lyricSearchSeq !== mySeq : raw.coverSearchSeq !== mySeq) return
    if (kind === 'lyrics') {
      raw.lyricCandidates = []
      raw.lyricSearchState = 'done'
    } else {
      raw.coverCandidates = []
      raw.coverSearchState = 'done'
    }
  }
}

/** C2 换源固定顺序（netease → qqmusic → migu），跳过原源。 */
const C2_SOURCE_ORDER: MusicSourceId[] = ['netease', 'qqmusic', 'migu']

/**
 * 归一化（对齐 Rust `searcher::norm`：trim + 全角转半角 + 小写），供 C2 候选身份校验。
 * 与后端打分归一化保持同规则，避免前后端判定不一致。
 */
function normalizeForMatch(s: string): string {
  return s
    .trim()
    .split('')
    .map((ch) => {
      const code = ch.charCodeAt(0)
      if (code === 0x3000) return ' ' // 全角空格
      if (code >= 0xff01 && code <= 0xff5e) return String.fromCharCode(code - 0xfee0)
      return ch
    })
    .join('')
    .toLowerCase()
}

/** C2：在单源原始候选中找「归一化 title/artist 与点选候选一致」的那条（防「同名不同歌」）。 */
function findSameSong(list: SongCandidate[], cand: SongCandidate): SongCandidate | undefined {
  const t = normalizeForMatch(cand.title)
  const a = normalizeForMatch(cand.artist)
  return list.find(
    (c) => normalizeForMatch(c.title) === t && normalizeForMatch(c.artist) === a,
  )
}

/**
 * 点选歌词候选（D4）：`fetchLyric(cand.source, cand.id)` 成功 → `current.lyrics` 填入 +
 * `lyricSourcePlatform = cand.source`（badge 显示平台，dirty 翻转，仍可编辑）。
 * None → C2 换源：以 **cand 自身 title/artist**（点选那首歌的身份，非可能被编辑的 current）
 * 对每家剩余源走单源 `searchSource`（v1-search-fixes：绕过聚合去重——聚合会把同曲多源候选
 * 折叠成一条，导致换源找不到其他源），并按归一化 title/artist **身份校验**（防 FR-8.8a 明令
 * 禁止的「同名不同歌」）后 `fetchLyric`；成功填 + badge=该源；全源失败 → `lyricFetchEmpty=true`
 * （空态，不降级到低分候选）。已切歌（lyricSearchSeq 变化）→ 结果丢弃不应用。
 * IPC 依赖以 `fetchLyric` / `searchSource` 注入。
 */
export async function pickLyricCandidate(
  cand: SongCandidate,
  fetchLyric: (source: MusicSourceId, id: string) => Promise<string | null> = defaultFetchLyric,
  searchSource: (source: MusicSourceId, title: string, artist: string) => Promise<SongCandidate[]> = defaultSearchSource,
): Promise<void> {
  if (raw.readonly || raw.current === null) return
  const mySeq = raw.lyricSearchSeq // 当前歌曲身份（切歌 resetSearchState 自增 → 过期丢弃）
  const text = await fetchLyric(cand.source, cand.id)
  if (raw.lyricSearchSeq !== mySeq) return
  if (text !== null && text !== undefined) {
    raw.current.lyrics = text
    raw.lyricSourcePlatform = cand.source
    raw.lyricFetchEmpty = false
    return
  }
  // C2：取词 None → 换另一家源重试同一首歌（不降级到低分候选）。
  // 剩余源无顺序依赖，`searchSource` 并行发起（最坏 6s 而非串行 12s）；命中仍按固定序。
  try {
    const remaining = C2_SOURCE_ORDER.filter((source) => source !== cand.source) // 跳过原源
    const lists = await Promise.all(
      remaining.map(async (source) => ({
        source,
        list: await searchSource(source, cand.title, cand.artist),
      })),
    )
    if (raw.lyricSearchSeq !== mySeq) return
    for (const { source, list } of lists) {
      const c = findSameSong(list, cand) // 身份校验：找不到同曲候选 → 跳过该源
      if (c === undefined) continue
      const text2 = await fetchLyric(source, c.id)
      if (raw.lyricSearchSeq !== mySeq) return
      if (text2 !== null && text2 !== undefined) {
        raw.current.lyrics = text2
        raw.lyricSourcePlatform = source
        raw.lyricFetchEmpty = false
        return
      }
    }
    raw.lyricFetchEmpty = true // 全源失败 → 空态
  } catch {
    if (raw.lyricSearchSeq !== mySeq) return
    raw.lyricFetchEmpty = true
  }
}

/**
 * 点选封面候选（D6）：`cover_url` null 忽略 → `downloadCover(url)` → 裸 bytes →
 * `bytesToCoverInput`（魔数嗅探 mime + data URL + ≤2048 压缩）→ `setCover`（复用既有动作，
 * cover 在 DIRTY_FIELDS → 自动翻转 dirty）。下载 / 解码 / 压缩失败 → **静默从 coverCandidates
 * 移除该张**（其余不受影响，不报错不标红，验收 #12）；已切歌（coverSearchSeq 变化）→ 丢弃结果不应用。
 */
export async function pickCoverCandidate(
  cand: SongCandidate,
  downloadCover: (url: string) => Promise<number[]> = defaultDownloadCover,
  bytesToCoverInput: (bytes: number[]) => Promise<CoverInput> = defaultBytesToCoverInput,
): Promise<void> {
  if (raw.readonly || raw.current === null) return
  if (cand.cover_url === null) return
  const mySeq = raw.coverSearchSeq
  try {
    const bytes = await downloadCover(cand.cover_url)
    if (raw.coverSearchSeq !== mySeq) return // 已切歌，丢弃结果不应用
    const input = await bytesToCoverInput(bytes)
    if (raw.coverSearchSeq !== mySeq) return
    setCover(input)
  } catch {
    if (raw.coverSearchSeq !== mySeq) return
    // 静默移除该张（按 source+id 匹配——同一候选身份，不依赖对象引用，其余不受影响）
    raw.coverCandidates = raw.coverCandidates.filter((c) => !(c.source === cand.source && c.id === cand.id))
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
  // D5：badge 回到 original 的来源（候选保留——仍是当前歌，可重选）
  raw.lyricSourcePlatform = null
  raw.lyricFetchEmpty = false
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
