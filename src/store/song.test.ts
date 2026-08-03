import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'

// mock ../api/search → store/song.ts 的默认注入（autoSearchOnSelect 等默认 searchSongs/
// fetchLyric/downloadCover）。既有 selectSong-with-loader 用例在选中行时触发 autoSearchOnSelect，
// 必须兜底默认 searchSongs（返回全源 0 → 标离线，不影响既有断言；搜索相关新用例注入显式桩）。
vi.mock('../api/search', () => ({
  searchSongs: vi.fn(async () => ({
    songs: [],
    source_stats: [
      ['netease', 0],
      ['qqmusic', 0],
      ['migu', 0],
    ],
  })),
  fetchLyric: vi.fn(async () => null),
  downloadCover: vi.fn(async () => []),
}))

import type { CoverInput, MusicSourceId, SearchResult, Song, SongCandidate, SongSummary } from '../api/types'
import { searchSongs as mockedSearchSongs } from '../api/search'
import {
  activateFolder,
  autoSearchOnSelect,
  cancelPending,
  clearCover,
  manualSearch,
  open,
  pickCoverCandidate,
  pickLyricCandidate,
  requestFolder,
  requestSwitch,
  resolvePending,
  save,
  selectSong,
  setCover,
  setPendingRename,
  songStore,
  undo,
} from './song'

const s = (path: string, title = '', artist = ''): SongSummary => ({ path, title, artist })

/** 构造一首完整标签的 Song（v1-song-read 契约形状）。 */
const makeSong = (over: Partial<Song> = {}): Song => ({
  path: '/a/song.flac',
  title: '歌名',
  artist: '作者',
  album: '',
  album_artist: '',
  track: '1',
  track_total: '10',
  year: '2020',
  genre: '',
  lyrics: '',
  lyrics_source: 'none',
  cover: null,
  cover_mime: null,
  ...over,
})

describe('songStore 骨架（SongEditor 形态占位）', () => {
  it('初始为空状态：无选中歌曲', () => {
    expect(songStore.current).toBeNull()
    expect(songStore.original).toBeNull()
    expect(songStore.dirty).toBe(false)
    expect(songStore.lyricsSource).toBe('none')
  })
})

describe('songStore — v1-song-read 编辑状态模型', () => {
  beforeEach(() => {
    songStore.selectedPath = null
    songStore.current = null
    songStore.original = null
    songStore.readonly = false
    songStore.lyricsSource = 'none'
    songStore.saveState = 'idle'
    songStore.saveError = ''
  })

  it('open 成功：current=original 快照、dirty=false、readonly=false', async () => {
    const song = makeSong()
    // 生产路径 selectSong 先设 selectedPath 再 open（并发守卫依赖该不变量）
    songStore.selectedPath = song.path
    await open('/a/song.flac', vi.fn(async () => song))

    expect(songStore.current).toEqual(song)
    expect(songStore.original).toEqual(song)
    expect(songStore.current).not.toBe(songStore.original) // 快照必须独立，编辑不污染原始值
    expect(songStore.dirty).toBe(false)
    expect(songStore.readonly).toBe(false)
    expect(songStore.lyricsSource).toBe(song.lyrics_source)
  })

  it('编辑任一字段 → dirty=true', async () => {
    songStore.selectedPath = '/a/song.flac'
    await open('/a/song.flac', vi.fn(async () => makeSong()))

    songStore.current!.title = '新歌名'
    expect(songStore.dirty).toBe(true)

    // 编辑歌词同样触发
    songStore.current!.lyrics = '[00:00.00] 一行'
    expect(songStore.dirty).toBe(true)
  })

  it('改回原值 → dirty=false（逐字段对比）', async () => {
    songStore.selectedPath = '/a/song.flac'
    await open('/a/song.flac', vi.fn(async () => makeSong()))

    songStore.current!.title = '新歌名'
    expect(songStore.dirty).toBe(true)
    songStore.current!.title = '歌名'
    expect(songStore.dirty).toBe(false)
  })

  it('open_song Err → readonly=true、current/original=null、dirty=false', async () => {
    songStore.selectedPath = '/bad/broken.mp3'
    await open('/bad/broken.mp3', vi.fn(async () => { throw new Error('读取标签失败') }))

    expect(songStore.readonly).toBe(true)
    expect(songStore.current).toBeNull()
    expect(songStore.original).toBeNull()
    expect(songStore.dirty).toBe(false)
  })

  it('切歌：再 open 另一首 → current 替换、dirty 归零', async () => {
    songStore.selectedPath = '/a/one.flac'
    await open('/a/one.flac', vi.fn(async () => makeSong({ path: '/a/one.flac', title: 'One' })))
    songStore.current!.title = '改过'
    expect(songStore.dirty).toBe(true)

    songStore.selectedPath = '/a/two.flac'
    await open('/a/two.flac', vi.fn(async () => makeSong({ path: '/a/two.flac', title: 'Two' })))

    expect(songStore.current?.path).toBe('/a/two.flac')
    expect(songStore.current?.title).toBe('Two')
    expect(songStore.dirty).toBe(false)
  })

  it('selectSong 带 loader：选中并触发 open 读取', async () => {
    const loadSong = vi.fn(async (p: string) => makeSong({ path: p, title: 'T' }))

    await selectSong('/a/s.flac', loadSong)

    expect(songStore.selectedPath).toBe('/a/s.flac')
    expect(loadSong).toHaveBeenCalledWith('/a/s.flac')
    expect(songStore.current?.title).toBe('T')
  })

  it('selectSong 无 loader（纯选中）：只设 selectedPath，不读全量', async () => {
    await selectSong('/a/s.flac')
    expect(songStore.selectedPath).toBe('/a/s.flac')
    expect(songStore.current).toBeNull()
  })

  it('并发守卫：慢的旧响应后到 → 丢弃，不覆盖新选中（防表单/列表错位）', async () => {
    // A 请求慢、B 请求快：B 先返回并设 current，A 后返回必须被丢弃
    let resolveA!: (s: Song) => void
    const loadA = vi.fn(() => new Promise<Song>((res) => { resolveA = res }))
    const loadB = vi.fn(async () => makeSong({ path: '/a/b.flac', title: 'B' }))

    // 模拟点击 A → 点击 B（B 先完成，selectedPath 已是 B）
    const pA = selectSong('/a/a.flac', loadA)
    await selectSong('/a/b.flac', loadB)

    expect(songStore.selectedPath).toBe('/a/b.flac')
    expect(songStore.current?.title).toBe('B')

    // A 的慢响应此刻才到 → 已过期，丢弃
    resolveA(makeSong({ path: '/a/a.flac', title: 'A' }))
    await pA

    expect(songStore.current?.title).toBe('B') // 未被旧歌覆盖
    expect(songStore.current?.path).toBe('/a/b.flac')
  })

  it('并发守卫：过期错误同样丢弃，不误设只读', async () => {
    // A 请求将失败但后到，B 已成功打开 → A 的错误不得把 readonly 置 true
    let rejectA!: (e: Error) => void
    const loadA = vi.fn(() => new Promise<Song>((_, rej) => { rejectA = rej }))
    const loadB = vi.fn(async () => makeSong({ path: '/a/b.flac', title: 'B' }))

    const pA = selectSong('/a/broken.flac', loadA)
    await selectSong('/a/b.flac', loadB)
    expect(songStore.readonly).toBe(false)

    rejectA(new Error('读取标签失败'))
    await pA

    expect(songStore.readonly).toBe(false) // 旧错误不误设只读
    expect(songStore.current?.path).toBe('/a/b.flac')
  })

  it('换目录（activateFolder）：重置编辑状态，不残留上一首', async () => {
    songStore.selectedPath = '/a/old.flac'
    await open('/a/old.flac', vi.fn(async () => makeSong({ path: '/a/old.flac' })))
    songStore.current!.title = '改过'
    expect(songStore.dirty).toBe(true)

    await activateFolder('/newdir', vi.fn(async () => []))

    expect(songStore.selectedPath).toBeNull()
    expect(songStore.current).toBeNull()
    expect(songStore.original).toBeNull()
    expect(songStore.dirty).toBe(false)
    expect(songStore.readonly).toBe(false)
    expect(songStore.saveState).toBe('idle')
    expect(songStore.saveError).toBe('')
  })
})

describe('songStore — v1-song-save 保存状态机与撤销（design.md D7/D8）', () => {
  beforeEach(() => {
    songStore.selectedPath = '/a/song.flac'
    songStore.current = { ...makeSong() }
    songStore.original = { ...makeSong() }
    songStore.readonly = false
    songStore.lyricsSource = 'none'
    songStore.saveState = 'idle'
    songStore.saveError = ''
  })

  it('save 默认走 invoke("save_song")：成功 → original 更新、dirty=false、saveState=saved', async () => {
    songStore.current!.title = '改过' // 制造 dirty
    expect(songStore.dirty).toBe(true)

    const saveFn = vi.fn(async () => undefined)
    await save(false, saveFn)

    expect(saveFn).toHaveBeenCalledWith(songStore.current, false) // 提交整个 current 对象 + exportLrc
    expect(songStore.original).toEqual(songStore.current) // 新基准已快照
    expect(songStore.original).not.toBe(songStore.current) // 快照独立
    expect(songStore.current!.title).toBe('改过') // current 保留
    expect(songStore.dirty).toBe(false) // 保存后归 false（已写盘）
    expect(songStore.saveState).toBe('saved')
    expect(songStore.saveError).toBe('')
  })

  it('save 失败：current 保留可重试、dirty 保持 true、saveState=save_failed、saveError 有值', async () => {
    songStore.current!.artist = '新作者'
    expect(songStore.dirty).toBe(true)
    const originalSnapshot = { ...songStore.original }

    const saveFn = vi.fn(async () => { throw new Error('磁盘写入失败') })
    await save(false, saveFn)

    expect(songStore.current!.artist).toBe('新作者') // 内容保留
    expect(songStore.original).toEqual(originalSnapshot) // original 不更新
    expect(songStore.dirty).toBe(true) // 绝不假报已保存
    expect(songStore.saveState).toBe('save_failed')
    expect(songStore.saveError).toBe('Error: 磁盘写入失败')

    // 修复后重试成功 → dirty 归 false、saved
    await save(false, vi.fn(async () => {}))
    expect(songStore.saveState).toBe('saved')
    expect(songStore.dirty).toBe(false)
  })

  it('readonly 或 current=null → 不执行保存，状态不变', async () => {
    songStore.readonly = true
    const saveFn = vi.fn(async () => {})
    await save(false, saveFn)
    expect(saveFn).not.toHaveBeenCalled()
    expect(songStore.saveState).toBe('idle')

    // current=null 且非只读 → 同样不执行
    songStore.readonly = false
    songStore.current = null
    await save(false, saveFn)
    expect(saveFn).not.toHaveBeenCalled()
  })

  it('undo：current 回到 original、dirty=false、saveState 归 idle', async () => {
    songStore.current!.title = '改过'
    songStore.current!.lyrics = '[00:00.00] 新词'
    songStore.saveState = 'save_failed'
    songStore.saveError = '某错误'

    await undo()

    expect(songStore.current).toEqual(songStore.original) // 恢复到打开时快照
    expect(songStore.current).not.toBe(songStore.original) // 快照独立
    expect(songStore.dirty).toBe(false)
    expect(songStore.saveState).toBe('idle')
    expect(songStore.saveError).toBe('')
  })

  it('undo 后 original 不被覆盖，再编辑可再撤销', async () => {
    songStore.current!.title = '第一改'
    await undo()
    expect(songStore.current!.title).toBe('歌名')
    songStore.current!.title = '第二改'
    await undo()
    expect(songStore.current!.title).toBe('歌名') // 回到同一基准
  })

  it('open 成功 → saveState 归 idle、saveError 清空（新歌作为新基准）', async () => {
    songStore.saveState = 'saved'
    songStore.saveError = 'old'
    songStore.selectedPath = '/a/next.flac'
    await open('/a/next.flac', vi.fn(async () => makeSong({ path: '/a/next.flac', title: 'Next' })))

    expect(songStore.saveState).toBe('idle')
    expect(songStore.saveError).toBe('')
    expect(songStore.dirty).toBe(false)
  })

  it('open 失败（坏标签）→ saveState 归 idle、saveError 清空', async () => {
    songStore.saveState = 'save_failed'
    songStore.saveError = 'old'
    songStore.selectedPath = '/bad/x.mp3'
    await open('/bad/x.mp3', vi.fn(async () => { throw new Error('坏标签') }))

    expect(songStore.readonly).toBe(true)
    expect(songStore.saveState).toBe('idle')
    expect(songStore.saveError).toBe('')
  })

  it('换目录（activateFolder）→ saveState 归 idle、saveError 清空', async () => {
    songStore.saveState = 'saved'
    songStore.saveError = 'old'
    await activateFolder('/d', vi.fn(async () => []))
    expect(songStore.saveState).toBe('idle')
    expect(songStore.saveError).toBe('')
  })
})

describe('songStore — v1-lyrics-lrc exportLrc opt-in（design.md D7）', () => {
  beforeEach(() => {
    songStore.selectedPath = '/a/song.flac'
    songStore.current = { ...makeSong() }
    songStore.original = { ...makeSong() }
    songStore.readonly = false
    songStore.lyricsSource = 'none'
    songStore.exportLrc = false
    songStore.saveState = 'idle'
    songStore.saveError = ''
  })

  it('初始为 false（opt-in 默认不勾选）', () => {
    expect(songStore.exportLrc).toBe(false)
  })

  it('勾选是保存期选项，不进 DIRTY_FIELDS：exportLrc=true 不翻转 dirty', () => {
    expect(songStore.dirty).toBe(false)
    songStore.exportLrc = true
    expect(songStore.dirty).toBe(false) // 复选框本身不是编辑内容
  })

  it('save(exportLrc) 把 opt-in 传给 saveFn（current, true）', async () => {
    songStore.exportLrc = true
    const saveFn = vi.fn(async () => undefined)
    await save(true, saveFn)
    expect(saveFn).toHaveBeenCalledWith(songStore.current, true)
  })

  it('dirty=false 时 save(true) 也可执行（独立导出门禁：勾选 + 歌词非空即触发，CR 修复）', async () => {
    // 核心场景：已含内嵌歌词、表单未编辑（dirty=false），勾选导出 .lrc 可直接保存
    songStore.current!.lyrics = '[00:00.00] 已内嵌歌词'
    songStore.original!.lyrics = '[00:00.00] 已内嵌歌词'
    songStore.exportLrc = true
    expect(songStore.dirty).toBe(false) // D7：复选框不脏表单
    expect(songStore.exportLrc).toBe(true)

    const saveFn = vi.fn(async () => undefined)
    await save(true, saveFn)

    expect(saveFn).toHaveBeenCalledWith(songStore.current, true)
    expect(songStore.saveState).toBe('saved')
    expect(songStore.dirty).toBe(false)
  })

  it('保存成功后保持勾选（D7：连续保存多首可保持导出意愿，仅切歌/换目录重置）', async () => {
    songStore.exportLrc = true
    await save(true, vi.fn(async () => undefined))
    expect(songStore.saveState).toBe('saved')
    expect(songStore.exportLrc).toBe(true) // 不因保存成功而复位
  })

  it('切歌（open 成功）→ exportLrc 重置 false', async () => {
    songStore.exportLrc = true
    songStore.selectedPath = '/a/next.flac'
    await open('/a/next.flac', vi.fn(async () => makeSong({ path: '/a/next.flac', title: 'Next' })))
    expect(songStore.exportLrc).toBe(false)
  })

  it('open 失败（坏标签）→ exportLrc 同样重置 false', async () => {
    songStore.exportLrc = true
    songStore.selectedPath = '/bad/x.mp3'
    await open('/bad/x.mp3', vi.fn(async () => { throw new Error('坏标签') }))
    expect(songStore.readonly).toBe(true)
    expect(songStore.exportLrc).toBe(false)
  })

  it('换目录（activateFolder）→ exportLrc 重置 false', async () => {
    songStore.exportLrc = true
    await activateFolder('/d', vi.fn(async () => []))
    expect(songStore.exportLrc).toBe(false)
  })
})

describe('songStore — v1-cover-embed setCover/clearCover（design.md D5）', () => {
  beforeEach(() => {
    songStore.selectedPath = '/a/song.flac'
    songStore.current = { ...makeSong() }
    songStore.original = { ...makeSong() }
    songStore.readonly = false
    songStore.lyricsSource = 'none'
    songStore.saveState = 'idle'
    songStore.saveError = ''
  })

  const cover: CoverInput = {
    data_url: 'data:image/png;base64,AAAA',
    mime: 'image/png',
  }

  it('setCover：current.cover = data_url、current.cover_mime = mime，且 dirty 翻转', () => {
    expect(songStore.current!.cover).toBeNull()
    expect(songStore.dirty).toBe(false)

    setCover(cover)

    expect(songStore.current!.cover).toBe('data:image/png;base64,AAAA')
    expect(songStore.current!.cover_mime).toBe('image/png')
    // cover 在 DIRTY_FIELDS → 预览即自动翻转 dirty，无需改 dirty 判定
    expect(songStore.dirty).toBe(true)
  })

  it('setCover：readonly 时无视（坏标签只读，封面区已禁用）', () => {
    songStore.readonly = true
    setCover(cover)
    expect(songStore.current!.cover).toBeNull()
    expect(songStore.current!.cover_mime).toBeNull()
    expect(songStore.dirty).toBe(false)
  })

  it('setCover：current=null 时无视（无歌不写）', () => {
    songStore.current = null
    setCover(cover)
    expect(songStore.current).toBeNull()
  })

  it('clearCover：cover/cover_mime 置 null，dirty 翻转（保存后走既有删除语义）', () => {
    songStore.current!.cover = 'data:image/png;base64,AAAA'
    songStore.current!.cover_mime = 'image/png'
    expect(songStore.dirty).toBe(true)
    songStore.original = { ...songStore.current } // 模拟已保存：新基准含封面
    expect(songStore.dirty).toBe(false)

    clearCover()

    expect(songStore.current!.cover).toBeNull()
    expect(songStore.current!.cover_mime).toBeNull()
    expect(songStore.dirty).toBe(true) // 与 original 的封面不一致 → 删除标记
  })

  it('clearCover：readonly 时无视', () => {
    songStore.current!.cover = 'data:image/png;base64,AAAA'
    songStore.readonly = true
    clearCover()
    expect(songStore.current!.cover).toBe('data:image/png;base64,AAAA')
  })

  it('setCover 后 save：写入 current.cover 并经 save_song 提交', async () => {
    setCover(cover)
    expect(songStore.dirty).toBe(true)
    const saveFn = vi.fn(async () => undefined)
    await save(false, saveFn)
    expect(saveFn).toHaveBeenCalledWith(songStore.current, false)
    expect(songStore.current!.cover).toBe('data:image/png;base64,AAAA')
    expect(songStore.dirty).toBe(false) // 保存后归零（压缩图已写盘）
  })
})

describe('songStore — v1-folder-list 状态（并入自 store.test.ts）', () => {
  beforeEach(() => {
    songStore.folderPath = null
    songStore.songs = []
    songStore.searchQuery = ''
    songStore.selectedPath = null
  })

  it('初始为空状态：无目录、无列表、无搜索、无选中', () => {
    expect(songStore.folderPath).toBeNull()
    expect(songStore.songs).toEqual([])
    expect(songStore.searchQuery).toBe('')
    expect(songStore.selectedPath).toBeNull()
  })

  describe('selectSong — 点击选中（spec: 点击行选中高亮）', () => {
    it('传入 path 即选中该行', () => {
      selectSong('/a/song.flac')
      expect(songStore.selectedPath).toBe('/a/song.flac')
    })

    it('传入 null 清除选中（换目录后无选中）', () => {
      selectSong('/a/song.flac')
      selectSong(null)
      expect(songStore.selectedPath).toBeNull()
    })
  })

  describe('activateFolder — 换目录整体替换列表 + 顶栏路径（spec: 重新打开整体替换）', () => {
    it('目录非空：设 folderPath、加载并整体替换 songs、重置 selectedPath', async () => {
      const dir = '/music/other'
      const fresh = [s('/music/other/a.flac', 'A', 'AA'), s('/music/other/b.mp3', 'B', 'BB')]
      const loadSongs = vi.fn(async () => fresh)

      await activateFolder(dir, loadSongs)

      expect(loadSongs).toHaveBeenCalledWith(dir)
      expect(songStore.folderPath).toBe(dir) // 顶栏展示路径
      expect(songStore.songs).toEqual(fresh)
      expect(songStore.selectedPath).toBeNull() // 换目录重置选中
    })

    it('换目录前已有旧列表：结果被整体替换而非追加', async () => {
      songStore.songs = [s('/old/zz.flac', 'Old', 'O')]
      const fresh = [s('/new/a.flac', 'New', 'N')]
      await activateFolder('/new', async () => fresh)
      expect(songStore.songs).toEqual(fresh)
      expect(songStore.folderPath).toBe('/new')
    })

    it('取消（dir 为空/null）→ 不改动任何状态、不调 loader', async () => {
      const loader = vi.fn(async () => [])
      await activateFolder(null, loader)
      await activateFolder('', loader)
      expect(songStore.folderPath).toBeNull()
      expect(songStore.songs).toEqual([])
      expect(loader).not.toHaveBeenCalled()
    })
  })
})

describe('songStore — v1-rename-sync 改名-保存联动（design.md D5/D6：改名独立状态、撞名不假报保存失败）', () => {
  beforeEach(() => {
    songStore.selectedPath = '/a/song.flac'
    songStore.current = { ...makeSong() }
    songStore.original = { ...makeSong() }
    songStore.readonly = false
    songStore.lyricsSource = 'none'
    songStore.saveState = 'idle'
    songStore.saveError = ''
    songStore.pendingRename = null
    songStore.renameRejected = false
  })

  it('初始：pendingRename=null、renameRejected=false、renamePending=false', () => {
    expect(songStore.pendingRename).toBeNull()
    expect(songStore.renameRejected).toBe(false)
    expect(songStore.renamePending).toBe(false)
  })

  it('setPendingRename：写入新名并清 renameRejected；空串 → null', () => {
    songStore.renameRejected = true
    setPendingRename('新歌.flac')
    expect(songStore.pendingRename).toBe('新歌.flac')
    expect(songStore.renameRejected).toBe(false)
    expect(songStore.renamePending).toBe(true)

    setPendingRename('')
    expect(songStore.pendingRename).toBeNull()
    expect(songStore.renamePending).toBe(false)
  })

  it('纯改名不进 DIRTY_FIELDS：setPendingRename 不翻转 dirty（D5 独立 UI 状态）', () => {
    expect(songStore.dirty).toBe(false)
    setPendingRename('新歌.flac')
    expect(songStore.dirty).toBe(false)
  })

  it('改名成功：先 renameFn → 路径同步（current/selectedPath/songs 列表）→ 再写标签，dirty 归零', async () => {
    songStore.songs = [s('/a/song.flac', '歌名', '作者'), s('/a/other.mp3', 'Other', 'O')]
    setPendingRename('新歌.flac')
    const renameFn = vi.fn(async () => undefined)
    const saveFn = vi.fn(async () => undefined)

    await save(false, saveFn, renameFn)

    expect(renameFn).toHaveBeenCalledWith('/a/song.flac', '新歌.flac') // rename 用旧 path + 新名
    expect(saveFn).toHaveBeenCalledWith(songStore.current, false) // 标签写新路径
    expect(songStore.current!.path).toBe('/a/新歌.flac') // 路径同步
    expect(songStore.selectedPath).toBe('/a/新歌.flac')
    expect(songStore.songs[0].path).toBe('/a/新歌.flac') // 列表项同步
    expect(songStore.songs[1].path).toBe('/a/other.mp3') // 其它项不动
    expect(songStore.pendingRename).toBeNull()
    expect(songStore.renameRejected).toBe(false)
    expect(songStore.saveState).toBe('saved')
    expect(songStore.dirty).toBe(false)
  })

  it('改名被拒（撞名）：renameRejected=true、标签仍写回原路径、保存状态按标签写盘结果定（D6）', async () => {
    setPendingRename('撞名.flac')
    const renameFn = vi.fn(async () => { throw new Error('目标已存在') })
    const saveFn = vi.fn(async () => undefined)

    await save(false, saveFn, renameFn)

    expect(songStore.renameRejected).toBe(true)
    expect(songStore.pendingRename).toBe('撞名.flac') // 保留，换名后重存即完成改名
    expect(songStore.current!.path).toBe('/a/song.flac') // 标签仍写回原路径
    expect(saveFn).toHaveBeenCalledWith(songStore.current, false)
    expect(songStore.saveState).toBe('saved') // 改名被拒不报「保存失败」（绝不假象）
    expect(songStore.dirty).toBe(false)
  })

  it('撞名被拒后换名重试 → 第二次保存改名成功、路径同步、dirty 归零（spec「用户换名重试」）', async () => {
    setPendingRename('撞名.flac')
    const renameFn1 = vi.fn(async () => { throw new Error('目标已存在') })
    await save(false, vi.fn(async () => undefined), renameFn1)
    expect(songStore.renameRejected).toBe(true)
    expect(songStore.pendingRename).toBe('撞名.flac')

    // 用户换名重试：setPendingRename 即清 renameRejected（重新尝试改名）
    setPendingRename('换名.flac')
    expect(songStore.renameRejected).toBe(false)
    const renameFn2 = vi.fn(async () => undefined)
    const saveFn2 = vi.fn(async () => undefined)
    await save(false, saveFn2, renameFn2)

    expect(renameFn2).toHaveBeenCalledWith('/a/song.flac', '换名.flac')
    expect(saveFn2).toHaveBeenCalledWith(songStore.current, false)
    expect(songStore.current!.path).toBe('/a/换名.flac') // 换名后路径同步
    expect(songStore.pendingRename).toBeNull()
    expect(songStore.renameRejected).toBe(false)
    expect(songStore.saveState).toBe('saved')
    expect(songStore.dirty).toBe(false)
  })

  it('改名被拒且标签保存也失败：saveState=save_failed、saveError=标签错误、dirty 保持 true', async () => {
    songStore.current!.title = '改过'
    setPendingRename('撞名.flac')
    const renameFn = vi.fn(async () => { throw new Error('目标已存在') })
    const saveFn = vi.fn(async () => { throw new Error('磁盘写入失败') })

    await save(false, saveFn, renameFn)

    expect(songStore.renameRejected).toBe(true)
    expect(songStore.saveState).toBe('save_failed')
    expect(songStore.saveError).toBe('Error: 磁盘写入失败')
    expect(songStore.dirty).toBe(true) // 内容保留可重试，绝不假报
  })

  it('改名目标与当前同名 = 无操作：只清 pendingRename、不调 renameFn', async () => {
    setPendingRename('song.flac') // 与 fileName(current.path) 相同
    const renameFn = vi.fn(async () => undefined)
    const saveFn = vi.fn(async () => undefined)

    await save(false, saveFn, renameFn)

    expect(renameFn).not.toHaveBeenCalled()
    expect(songStore.pendingRename).toBeNull()
    expect(songStore.current!.path).toBe('/a/song.flac')
    expect(songStore.saveState).toBe('saved')
  })

  it('切歌（open 成功）→ pendingRename/renameRejected 重置（回到打开时文件名）', async () => {
    setPendingRename('新歌.flac')
    songStore.renameRejected = true
    songStore.selectedPath = '/a/next.flac'
    await open('/a/next.flac', vi.fn(async () => makeSong({ path: '/a/next.flac', title: 'Next' })))
    expect(songStore.pendingRename).toBeNull()
    expect(songStore.renameRejected).toBe(false)
  })

  it('open 失败（坏标签）→ 同样重置', async () => {
    setPendingRename('新歌.flac')
    songStore.renameRejected = true
    songStore.selectedPath = '/bad/x.mp3'
    await open('/bad/x.mp3', vi.fn(async () => { throw new Error('坏标签') }))
    expect(songStore.readonly).toBe(true)
    expect(songStore.pendingRename).toBeNull()
    expect(songStore.renameRejected).toBe(false)
  })

  it('换目录（activateFolder）→ 重置', async () => {
    setPendingRename('新歌.flac')
    songStore.renameRejected = true
    await activateFolder('/d', vi.fn(async () => []))
    expect(songStore.pendingRename).toBeNull()
    expect(songStore.renameRejected).toBe(false)
  })

  it('撤销（undo）→ 重置（改名草稿弃置）', async () => {
    songStore.current!.title = '改过'
    setPendingRename('新歌.flac')
    songStore.renameRejected = true
    await undo()
    expect(songStore.pendingRename).toBeNull()
    expect(songStore.renameRejected).toBe(false)
  })

  it('renamePending 随 save 成功归 false（pendingRename 已清）', async () => {
    setPendingRename('新歌.flac')
    await save(false, vi.fn(async () => undefined), vi.fn(async () => undefined))
    expect(songStore.renamePending).toBe(false)
    expect(songStore.pendingRename).toBeNull()
  })
})

describe('songStore — v1-ux-settings 切歌/换目录三选一状态机（design.md D1–D3）', () => {
  beforeEach(() => {
    songStore.selectedPath = '/a/song.flac'
    songStore.current = { ...makeSong() }
    songStore.original = { ...makeSong() }
    songStore.readonly = false
    songStore.lyricsSource = 'none'
    songStore.exportLrc = false
    songStore.saveState = 'idle'
    songStore.saveError = ''
    songStore.pendingRename = null
    songStore.renameRejected = false
    songStore.pendingAction = null
    songStore.folderPath = null
  })

  describe('requestSwitch — dirty 拦截门（spec: 无修改直接切 / 有修改弹窗）', () => {
    it('干净态 → 直接切歌，pendingAction 保持 null（spec「无修改直接切」）', async () => {
      const loadSong = vi.fn(async (p: string) => makeSong({ path: p, title: 'Two' }))
      await requestSwitch('/a/two.flac', loadSong)
      expect(songStore.pendingAction).toBeNull()
      expect(songStore.selectedPath).toBe('/a/two.flac')
      expect(songStore.current?.title).toBe('Two')
      expect(loadSong).toHaveBeenCalledWith('/a/two.flac')
    })

    it('dirty 态 → 进入 pending（弹窗三选一），不立即切歌、编辑保留', () => {
      songStore.current!.title = '改过'
      expect(songStore.dirty).toBe(true)

      requestSwitch('/a/two.flac', vi.fn(async () => makeSong({ path: '/a/two.flac' })))

      expect(songStore.pendingAction).toMatchObject({ kind: 'switch', path: '/a/two.flac' })
      expect(songStore.selectedPath).toBe('/a/song.flac') // 未切换
      expect(songStore.current?.title).toBe('改过') // 编辑保留
    })

    it('点击已选中行（path === selectedPath）为 no-op，不弹窗不重读', () => {
      songStore.current!.title = '改过'
      expect(songStore.dirty).toBe(true)
      requestSwitch('/a/song.flac', vi.fn(async () => makeSong()))
      expect(songStore.pendingAction).toBeNull() // 不弹窗（同 mockup onRowClick）
      expect(songStore.current?.title).toBe('改过') // 不重读、不丢编辑
    })

    it('无 loader（纯选中）干净态 → 只设 selectedPath（仿 selectSong 语义）', async () => {
      await requestSwitch('/a/two.flac')
      expect(songStore.pendingAction).toBeNull()
      expect(songStore.selectedPath).toBe('/a/two.flac')
    })

    it('pending 期间再次 requestSwitch（点另一行）→ 忽略，不覆盖原 pending（D1 单一状态机）', () => {
      songStore.current!.title = '改过'
      expect(songStore.dirty).toBe(true)
      requestSwitch('/a/two.flac', vi.fn(async () => makeSong({ path: '/a/two.flac' })))
      expect(songStore.pendingAction).toMatchObject({ kind: 'switch', path: '/a/two.flac' })

      // 弹窗未决时再点另一行 → 保持原 pending 意图（弹窗文案与行为一致）
      requestSwitch('/a/three.flac', vi.fn(async () => makeSong({ path: '/a/three.flac' })))
      expect(songStore.pendingAction).toMatchObject({ kind: 'switch', path: '/a/two.flac' })
      expect(songStore.selectedPath).toBe('/a/song.flac') // 未切歌
    })
  })

  describe('requestFolder — 换目录复用同一弹窗（spec: 换目录未保存确认复用）', () => {
    it('干净态 → 直接换目录，pendingAction 保持 null', async () => {
      songStore.folderPath = '/a'
      const loadSongs = vi.fn(async () => [s('/new/x.flac', 'X', 'XX')])
      await requestFolder('/new/dir', loadSongs)
      expect(songStore.pendingAction).toBeNull()
      expect(songStore.folderPath).toBe('/new/dir')
      expect(loadSongs).toHaveBeenCalledWith('/new/dir')
    })

    it('dirty 态 → 进入 pending folder，不立即换目录', () => {
      songStore.folderPath = '/a'
      songStore.current!.title = '改过'
      requestFolder('/new/dir', vi.fn(async () => []))
      expect(songStore.pendingAction).toMatchObject({ kind: 'folder', dir: '/new/dir' })
      expect(songStore.folderPath).toBe('/a') // 未换目录
      expect(songStore.current?.title).toBe('改过')
    })

    it('取消选择（dir=null/空）→ 无视，即使 dirty 也不弹窗（用户已明确取消）', () => {
      songStore.current!.title = '改过'
      expect(songStore.dirty).toBe(true)
      const loadSongs = vi.fn(async () => [])
      requestFolder(null, loadSongs)
      requestFolder('', loadSongs)
      expect(songStore.pendingAction).toBeNull()
      expect(loadSongs).not.toHaveBeenCalled()
      expect(songStore.folderPath).toBeNull()
    })

    it('pending switch 期间 ⌘O（requestFolder）→ 忽略，不改道弹窗意图（D1 单一状态机）', () => {
      songStore.current!.title = '改过'
      requestSwitch('/a/two.flac', vi.fn(async () => makeSong({ path: '/a/two.flac' })))
      expect(songStore.pendingAction).toMatchObject({ kind: 'switch', path: '/a/two.flac' })

      // 弹窗未决时按 ⌘O 并选中一个文件夹 → 不覆盖，仍保持「切歌」三选一语境
      requestFolder('/new/dir', vi.fn(async () => [s('/new/x.flac', 'X', 'XX')]))
      expect(songStore.pendingAction).toMatchObject({ kind: 'switch', path: '/a/two.flac' })
      expect(songStore.folderPath).toBeNull() // 未换目录
    })

    it('pending folder 期间 requestSwitch（点行）→ 忽略，不改道换目录意图（D1 单一状态机）', () => {
      songStore.current!.title = '改过'
      songStore.folderPath = '/a'
      requestFolder('/new/dir', vi.fn(async () => []))
      expect(songStore.pendingAction).toMatchObject({ kind: 'folder', dir: '/new/dir' })

      requestSwitch('/a/two.flac', vi.fn(async () => makeSong({ path: '/a/two.flac' })))
      expect(songStore.pendingAction).toMatchObject({ kind: 'folder', dir: '/new/dir' })
      expect(songStore.selectedPath).toBe('/a/song.flac') // 未切歌
    })
  })

  describe('resolvePending — 三选一收尾（design.md D1–D3）', () => {
    it('"save" 成功：先完整保存（saveFn 注入）→ 再执行切歌、清 pending、dirty 归零', async () => {
      songStore.current!.title = '改过'
      const savedSong = songStore.current // 保存提交的对象 = 切换前的 current 引用
      const loadSong = vi.fn(async (p: string) => makeSong({ path: p, title: 'Two' }))
      requestSwitch('/a/two.flac', loadSong)
      const saveFn = vi.fn(async () => undefined)

      await resolvePending('save', saveFn)

      expect(saveFn).toHaveBeenCalledWith(savedSong, false) // 完整复用 save 通道
      // 保存成功 → 执行切歌（open 重置 saveState=idle，即已切到新歌）
      expect(songStore.saveState).toBe('idle')
      expect(songStore.pendingAction).toBeNull()
      expect(songStore.selectedPath).toBe('/a/two.flac')
      expect(songStore.current?.title).toBe('Two')
      expect(songStore.dirty).toBe(false)
    })

    it('"save" 失败：keep pending 不切换、save_failed、dirty 保持 true（D3 绝不切走丢内容）', async () => {
      songStore.current!.title = '改过'
      const loadSong = vi.fn(async () => makeSong({ path: '/a/two.flac' }))
      requestSwitch('/a/two.flac', loadSong)
      const saveFn = vi.fn(async () => { throw new Error('磁盘写入失败') })

      await resolvePending('save', saveFn)

      expect(songStore.saveState).toBe('save_failed')
      expect(songStore.saveError).toBe('Error: 磁盘写入失败')
      expect(songStore.pendingAction).not.toBeNull() // 弹窗保持打开
      expect(songStore.selectedPath).toBe('/a/song.flac') // 未切换
      expect(songStore.dirty).toBe(true)

      // 用户重试成功 → 执行切歌
      await resolvePending('save', vi.fn(async () => undefined))
      expect(songStore.pendingAction).toBeNull()
      expect(songStore.selectedPath).toBe('/a/two.flac')
    })

    it('"discard"：不保存直接切歌（丢弃编辑）、清 pending', async () => {
      songStore.current!.title = '改过'
      const loadSong = vi.fn(async (p: string) => makeSong({ path: p, title: 'Two' }))
      requestSwitch('/a/two.flac', loadSong)

      await resolvePending('discard')

      expect(songStore.pendingAction).toBeNull()
      expect(songStore.selectedPath).toBe('/a/two.flac')
      expect(songStore.current?.title).toBe('Two') // 编辑已丢弃
      expect(songStore.dirty).toBe(false)
    })

    it('换目录 "save" 成功：保存当前编辑到原路径，再替换列表（spec 场景）', async () => {
      songStore.current!.title = '改过'
      songStore.folderPath = '/a'
      const loadSongs = vi.fn(async () => [s('/new/x.flac', 'X', 'XX')])
      requestFolder('/new/dir', loadSongs)
      const saveFn = vi.fn(async () => undefined)

      await resolvePending('save', saveFn)

      expect(saveFn).toHaveBeenCalled() // 保存写当前编辑歌原路径
      expect(songStore.pendingAction).toBeNull()
      expect(songStore.folderPath).toBe('/new/dir') // 再替换列表
      expect(songStore.songs).toEqual([s('/new/x.flac', 'X', 'XX')])
      expect(loadSongs).toHaveBeenCalledWith('/new/dir')
    })

    it('换目录 "discard"：不保存直接换目录（丢弃编辑）', async () => {
      songStore.current!.title = '改过'
      songStore.folderPath = '/a'
      requestFolder('/new/dir', vi.fn(async () => []))

      await resolvePending('discard')

      expect(songStore.pendingAction).toBeNull()
      expect(songStore.folderPath).toBe('/new/dir')
    })

    it('保存中（saving）再调 "save" → 忽略，不重复写盘（防连点）', async () => {
      songStore.current!.title = '改过'
      requestSwitch('/a/two.flac', vi.fn(async () => makeSong({ path: '/a/two.flac' })))
      songStore.saveState = 'saving'
      const saveFn = vi.fn(async () => undefined)

      await resolvePending('save', saveFn)

      expect(saveFn).not.toHaveBeenCalled()
      expect(songStore.pendingAction).not.toBeNull()
    })

    it('pendingAction=null 时 resolvePending 为 no-op', async () => {
      const saveFn = vi.fn(async () => undefined)
      await resolvePending('save', saveFn)
      await resolvePending('discard')
      expect(saveFn).not.toHaveBeenCalled()
    })
  })

  describe('cancelPending — 取消留在当前（spec「取消留在当前」）', () => {
    it('清 pending、不切换、编辑保留', () => {
      songStore.current!.title = '改过'
      requestSwitch('/a/two.flac', vi.fn(async () => makeSong({ path: '/a/two.flac' })))
      expect(songStore.pendingAction).not.toBeNull()

      cancelPending()

      expect(songStore.pendingAction).toBeNull()
      expect(songStore.selectedPath).toBe('/a/song.flac')
      expect(songStore.current?.title).toBe('改过')
      expect(songStore.dirty).toBe(true)
    })

    it('换目录取消 → 不换目录、保持当前状态（spec 场景）', () => {
      songStore.current!.title = '改过'
      songStore.folderPath = '/a'
      requestFolder('/new/dir', vi.fn(async () => []))
      cancelPending()
      expect(songStore.pendingAction).toBeNull()
      expect(songStore.folderPath).toBe('/a')
      expect(songStore.songs).toEqual([])
    })
  })

  describe('边界：坏标签只读 / 无选中 → dirty 恒 false → 不弹窗（spec「无修改直接切」自然满足）', () => {
    it('readonly（current/original=null）→ requestSwitch 直接执行不弹窗', async () => {
      songStore.current = null
      songStore.original = null
      songStore.readonly = true
      const loadSong = vi.fn(async (p: string) => makeSong({ path: p }))
      await requestSwitch('/a/two.flac', loadSong)
      expect(songStore.pendingAction).toBeNull()
      expect(songStore.selectedPath).toBe('/a/two.flac')
    })

    it('无选中（current=null 非只读）→ 直接执行不弹窗', async () => {
      songStore.current = null
      songStore.original = null
      songStore.readonly = false
      await requestSwitch('/a/two.flac')
      expect(songStore.pendingAction).toBeNull()
      expect(songStore.selectedPath).toBe('/a/two.flac')
    })
  })
})

describe('songStore — v1-search-ui 搜索联动（D1–D7：选中即搜/只补缺失/离线/生命周期/手动/C2/封面静默）', () => {
  const makeCand = (over: Partial<SongCandidate> = {}): SongCandidate => ({
    source: 'netease',
    id: 'n1',
    title: '歌名',
    artist: '作者',
    album: '专辑',
    cover_url: 'https://p1.music.126.net/1.jpg',
    ...over,
  })

  const result = (songs: SongCandidate[], stats?: Array<[MusicSourceId, number]>): SearchResult => ({
    songs,
    source_stats: stats ?? [
      ['netease', songs.length],
      ['qqmusic', 0],
      ['migu', 0],
    ],
  })

  beforeEach(() => {
    songStore.selectedPath = '/a/song.flac'
    songStore.current = { ...makeSong() }
    songStore.original = { ...makeSong() }
    songStore.readonly = false
    songStore.lyricsSource = 'none'
    songStore.saveState = 'idle'
    songStore.saveError = ''
    songStore.isOffline = false
    songStore.searchedThisSong = false
    songStore.lyricCandidates = []
    songStore.coverCandidates = []
    songStore.lyricSearchState = 'idle'
    songStore.coverSearchState = 'idle'
    songStore.lyricSourcePlatform = null
    songStore.lyricFetchEmpty = false
    songStore.searchSeq = 0
    vi.mocked(mockedSearchSongs).mockClear()
  })

  describe('autoSearchOnSelect — 选中即搜（D1/D2/D3：只补缺失、判定一次、离线首响）', () => {
    it('歌词与封面都缺失 → 一次 search_song 分桶填充两类候选，state=done', async () => {
      const searchSongs = vi.fn(async () =>
        result([
          makeCand({ cover_url: 'https://x/1.jpg' }),
          makeCand({ source: 'qqmusic', id: 'q1', cover_url: null }),
        ]),
      )
      await autoSearchOnSelect(searchSongs)

      expect(searchSongs).toHaveBeenCalledWith('歌名', '作者')
      expect(songStore.lyricSearchState).toBe('done')
      expect(songStore.lyricCandidates).toHaveLength(2) // 全部候选
      expect(songStore.coverSearchState).toBe('done')
      expect(songStore.coverCandidates).toHaveLength(1) // 只过滤出有 cover_url 的
      expect(songStore.coverCandidates[0].source).toBe('netease')
      expect(songStore.searchedThisSong).toBe(true)
      expect(songStore.isOffline).toBe(false)
    })

    it('已有封面只有歌词缺失 → 只搜歌词（coverSearchState 保持 idle，不干扰封面候选区）', async () => {
      songStore.current!.cover = 'data:image/jpeg;base64,AAA'
      songStore.current!.cover_mime = 'image/jpeg'
      const searchSongs = vi.fn(async () => result([makeCand()]))

      await autoSearchOnSelect(searchSongs)

      expect(songStore.lyricSearchState).toBe('done')
      expect(songStore.lyricCandidates).toHaveLength(1)
      expect(songStore.coverSearchState).toBe('idle') // 封面不缺 → 不进入封面搜索态
      expect(songStore.coverCandidates).toEqual([])
    })

    it('已有歌词只缺封面 → 只搜封面', async () => {
      songStore.current!.lyrics = '[00:00.00] 已有'
      songStore.current!.lyrics_source = 'embedded'
      songStore.lyricsSource = 'embedded'
      const searchSongs = vi.fn(async () => result([makeCand({ cover_url: 'https://x/1.jpg' })]))

      await autoSearchOnSelect(searchSongs)

      expect(songStore.coverSearchState).toBe('done')
      expect(songStore.coverCandidates).toHaveLength(1)
      expect(songStore.lyricSearchState).toBe('idle')
    })

    it('侧载 .lrc 歌词存在（lyricsSource=sidecar）→ 歌词不搜；封面缺失仍搜封面（D1 needLyrics 判定）', async () => {
      songStore.lyricsSource = 'sidecar' // 同名 .lrc 存在 → 已有歌词
      songStore.current!.lyrics = ''
      const searchSongs = vi.fn(async () => result([makeCand({ cover_url: 'https://x/1.jpg' })]))

      await autoSearchOnSelect(searchSongs)

      expect(songStore.lyricSearchState).toBe('idle')
      expect(songStore.coverSearchState).toBe('done')
    })

    it('已有歌词且已有封面 → 不搜（searchSongs 不调用，候选区保持 idle）', async () => {
      songStore.current!.lyrics = '[00:00.00] 已有'
      songStore.current!.lyrics_source = 'embedded'
      songStore.lyricsSource = 'embedded'
      songStore.current!.cover = 'data:image/jpeg;base64,AAA'
      const searchSongs = vi.fn(async () => result([makeCand()]))

      await autoSearchOnSelect(searchSongs)

      expect(searchSongs).not.toHaveBeenCalled()
      expect(songStore.lyricSearchState).toBe('idle')
      expect(songStore.coverSearchState).toBe('idle')
      expect(songStore.searchedThisSong).toBe(true) // 判定一次仍置位（flag 不重算）
    })

    it('不自动覆盖（spec 候选点选写入）：候选展示时未点选 → 不改变 current 的歌词/封面内容', async () => {
      // 已有歌词（内嵌）→ 只搜封面；候选展示但未点选 → current.lyrics/cover 不被覆盖
      songStore.current!.lyrics = '[00:00.00] 已有'
      songStore.current!.lyrics_source = 'embedded'
      songStore.original!.lyrics = '[00:00.00] 已有' // 与 current 一致 → dirty=false 基准
      songStore.original!.lyrics_source = 'embedded'
      songStore.lyricsSource = 'embedded'
      songStore.current!.cover = null
      const searchSongs = vi.fn(async () =>
        result([
          makeCand({ cover_url: 'https://x/1.jpg' }),
          makeCand({ source: 'qqmusic', id: 'q1', cover_url: 'https://q/1.jpg' }),
        ]),
      )

      await autoSearchOnSelect(searchSongs)

      expect(songStore.coverSearchState).toBe('done')
      expect(songStore.coverCandidates).toHaveLength(2) // 候选仅展示
      expect(songStore.lyricSearchState).toBe('idle') // 歌词已有不搜
      expect(songStore.current!.lyrics).toBe('[00:00.00] 已有') // 未点选 → 不覆盖歌词
      expect(songStore.current!.cover).toBeNull() // 未点选 → 不写入封面
      expect(songStore.dirty).toBe(false) // 内容未变
    })

    it('删除内容后不重搜（FR-8.4）：searchedThisSong 置位后再次调用 → 直接 return', async () => {
      songStore.current!.cover = 'data:image/jpeg;base64,AAA'
      const searchSongs = vi.fn(async () => result([makeCand()]))
      await autoSearchOnSelect(searchSongs)
      expect(songStore.searchedThisSong).toBe(true)
      expect(searchSongs).toHaveBeenCalledTimes(1)

      // 用户删除歌词 → 再次 autoSearch（同一次选中的场景不允许）→ 不重搜
      songStore.current!.lyrics = ''
      await autoSearchOnSelect(searchSongs)
      expect(searchSongs).toHaveBeenCalledTimes(1) // 不重搜
      expect(songStore.lyricSearchState).toBe('done') // 保持首次结果
    })

    it('离线首响（D3）：全源 0 → isOffline=true、搜索态归 idle（候选区显示离线提示）', async () => {
      const searchSongs = vi.fn(async () => result([], [['netease', 0], ['qqmusic', 0], ['migu', 0]]))

      await autoSearchOnSelect(searchSongs)

      expect(songStore.isOffline).toBe(true)
      expect(songStore.lyricSearchState).toBe('idle')
      expect(songStore.coverSearchState).toBe('idle')
    })

    it('IPC reject（防御）：同样标记离线', async () => {
      const searchSongs = vi.fn(async () => { throw new Error('network down') })

      await autoSearchOnSelect(searchSongs)

      expect(songStore.isOffline).toBe(true)
      expect(songStore.lyricSearchState).toBe('idle')
    })

    it('裸文件（title 空，FR-8.13）：不自动搜、不标离线（CR：空 title 无后端短路，会白发空搜索 + 误判整会话离线）', async () => {
      songStore.current!.title = ''
      const searchSongs = vi.fn(async () =>
        result([], [['netease', 0], ['qqmusic', 0], ['migu', 0]]),
      )

      await autoSearchOnSelect(searchSongs)

      expect(searchSongs).not.toHaveBeenCalled() // 不白发必为空的 3 源搜索
      expect(songStore.isOffline).toBe(false) // 不误判离线（sticky 至重启）
      expect(songStore.lyricSearchState).toBe('idle')
      expect(songStore.coverSearchState).toBe('idle')
      expect(songStore.searchedThisSong).toBe(false) // 尚未「判定过」，与其它前置守卫同语义
    })

    it('裸文件守卫为前置：title 全空格同样跳过（trim 判定）', async () => {
      songStore.current!.title = '   '
      const searchSongs = vi.fn(async () => result([makeCand()]))
      await autoSearchOnSelect(searchSongs)
      expect(searchSongs).not.toHaveBeenCalled()
      expect(songStore.searchedThisSong).toBe(false)
    })

    it('离线后不再自动搜：isOffline=true 时后续调用直接 return（只留手动按钮）', async () => {
      songStore.isOffline = true
      const searchSongs = vi.fn(async () => result([makeCand()]))

      await autoSearchOnSelect(searchSongs)

      expect(searchSongs).not.toHaveBeenCalled()
      expect(songStore.lyricSearchState).toBe('idle')
    })

    it('readonly（坏标签只读）→ 不搜', async () => {
      songStore.readonly = true
      const searchSongs = vi.fn(async () => result([makeCand()]))
      await autoSearchOnSelect(searchSongs)
      expect(searchSongs).not.toHaveBeenCalled()
    })

    it('current=null → 不搜', async () => {
      songStore.current = null
      const searchSongs = vi.fn(async () => result([makeCand()]))
      await autoSearchOnSelect(searchSongs)
      expect(searchSongs).not.toHaveBeenCalled()
    })

    it('过期结果丢弃（D2.6）：切歌后旧搜索 resolve → 不覆盖新状态', async () => {
      // 慢搜索 A：开始后立即切歌（resetSearchState 自增 searchSeq）→ A resolve 时 mySeq != searchSeq
      let resolveA!: (r: SearchResult) => void
      const searchA = vi.fn(() => new Promise<SearchResult>((res) => { resolveA = res }))
      const pA = autoSearchOnSelect(searchA)
      expect(songStore.lyricSearchState).toBe('searching')

      // 切歌 → 状态重置（searchSeq++ 作废在途搜索）
      songStore.selectedPath = '/a/next.flac'
      songStore.current = { ...makeSong({ path: '/a/next.flac', title: 'Next' }) }
      songStore.original = { ...makeSong({ path: '/a/next.flac', title: 'Next' }) }
      songStore.lyricsSource = 'none'
      songStore.lyricCandidates = []
      songStore.coverCandidates = []
      songStore.lyricSearchState = 'idle'
      songStore.coverSearchState = 'idle'
      songStore.searchedThisSong = false
      songStore.searchSeq++ // 等价 resetSearchState 的作废在途搜索

      resolveA(result([makeCand()]))
      await pA

      expect(songStore.lyricCandidates).toEqual([]) // 旧结果被丢弃
      expect(songStore.lyricSearchState).toBe('idle') // 未被旧结果置 done
    })
  })

  describe('selectSong 尾部触发 autoSearchOnSelect（D1：open 成功后、current 非空且 !readonly）', () => {
    it('选中行 → open 成功 → 自动搜索（后台异步不阻塞选中）', async () => {
      const cand = makeCand({ cover_url: 'https://x/1.jpg' })
      vi.mocked(mockedSearchSongs).mockResolvedValue(result([cand]))
      const loadSong = vi.fn(async (p: string) => makeSong({ path: p, title: 'T' }))

      await selectSong('/a/s.flac', loadSong)
      await flushPromises()

      expect(mockedSearchSongs).toHaveBeenCalledWith('T', '作者') // 用 open 读到的 title/artist
      expect(songStore.lyricSearchState).toBe('done')
      expect(songStore.lyricCandidates).toEqual([cand])
    })

    it('坏标签只读 → 不触发自动搜索', async () => {
      const loadSong = vi.fn(async () => { throw new Error('坏标签') })
      await selectSong('/bad/x.mp3', loadSong)
      await flushPromises()
      expect(mockedSearchSongs).not.toHaveBeenCalled()
      expect(songStore.readonly).toBe(true)
    })

    it('切歌（resolvePending 保存后）收敛于 selectSong → 新歌触发自动搜索、旧候选被清', async () => {
      const cand = makeCand()
      vi.mocked(mockedSearchSongs).mockResolvedValue(result([cand]))
      // 打开一首、制造 dirty、切歌走弹窗
      songStore.selectedPath = '/a/one.flac'
      songStore.current = { ...makeSong({ path: '/a/one.flac' }) }
      songStore.original = { ...makeSong({ path: '/a/one.flac' }) }
      songStore.current!.title = '改过'
      requestSwitch('/a/two.flac', vi.fn(async (p: string) => makeSong({ path: p, title: 'Two' })))
      await resolvePending('discard') // 丢弃编辑直接切歌
      await flushPromises()

      expect(songStore.selectedPath).toBe('/a/two.flac')
      expect(mockedSearchSongs).toHaveBeenCalledWith('Two', '作者') // 新歌触发
    })
  })

  describe('resetSearchState — 候选生命周期 = 当前歌曲（D5）', () => {
    it('open 成功 → 清两类候选、searchState 归 idle、searchedThisSong=false、searchSeq++', async () => {
      songStore.lyricCandidates = [makeCand()]
      songStore.coverCandidates = [makeCand()]
      songStore.lyricSearchState = 'done'
      songStore.coverSearchState = 'searching'
      songStore.searchedThisSong = true
      songStore.lyricSourcePlatform = 'netease'
      songStore.lyricFetchEmpty = true
      songStore.searchSeq = 5

      songStore.selectedPath = '/a/next.flac'
      await open('/a/next.flac', vi.fn(async () => makeSong({ path: '/a/next.flac', title: 'Next' })))

      expect(songStore.lyricCandidates).toEqual([])
      expect(songStore.coverCandidates).toEqual([])
      expect(songStore.lyricSearchState).toBe('idle')
      expect(songStore.coverSearchState).toBe('idle')
      expect(songStore.searchedThisSong).toBe(false)
      expect(songStore.lyricSourcePlatform).toBeNull()
      expect(songStore.lyricFetchEmpty).toBe(false)
      expect(songStore.searchSeq).toBe(6) // 作废在途搜索
    })

    it('open 失败（坏标签）→ 同样重置搜索状态', async () => {
      songStore.lyricSearchState = 'searching'
      songStore.searchedThisSong = true
      songStore.lyricCandidates = [makeCand()]

      songStore.selectedPath = '/bad/x.mp3'
      await open('/bad/x.mp3', vi.fn(async () => { throw new Error('坏标签') }))

      expect(songStore.readonly).toBe(true)
      expect(songStore.lyricSearchState).toBe('idle')
      expect(songStore.lyricCandidates).toEqual([])
      expect(songStore.searchedThisSong).toBe(false)
    })

    it('换目录（activateFolder）→ 重置搜索状态，但 isOffline 保持（会话级）', async () => {
      songStore.isOffline = true
      songStore.lyricSearchState = 'searching'
      songStore.searchedThisSong = true
      await activateFolder('/d', vi.fn(async () => []))
      expect(songStore.lyricSearchState).toBe('idle')
      expect(songStore.searchedThisSong).toBe(false)
      expect(songStore.isOffline).toBe(true) // 会话级不清
    })

    it('undo：lyricSourcePlatform/lyricFetchEmpty 重置，候选保留（D5 可重选）', async () => {
      songStore.lyricCandidates = [makeCand()]
      songStore.lyricSourcePlatform = 'netease'
      songStore.lyricFetchEmpty = true
      songStore.current!.lyrics = '[00:00.00] 改过'
      songStore.current!.cover = 'data:image/jpeg;base64,AAA'

      await undo()

      expect(songStore.lyricSourcePlatform).toBeNull() // badge 回到 original 来源
      expect(songStore.lyricFetchEmpty).toBe(false)
      expect(songStore.lyricCandidates).toEqual([makeCand()]) // 候选保留
    })
  })

  describe('manualSearch — 手动按钮（D7：无视离线 / 缺失判定，刷新对应 kind）', () => {
    it('手动搜歌词：无视 isOffline 照搜，只刷 lyricCandidates', async () => {
      songStore.isOffline = true // 离线也可手动
      songStore.current!.cover = 'data:image/jpeg;base64,AAA' // 封面已有（不缺失）
      const searchSongs = vi.fn(async () =>
        result([
          makeCand(),
          makeCand({ source: 'qqmusic', id: 'q1', cover_url: 'https://q/1.jpg' }),
        ]),
      )

      await manualSearch('lyrics', searchSongs)

      expect(searchSongs).toHaveBeenCalledWith('歌名', '作者')
      expect(songStore.lyricSearchState).toBe('done')
      expect(songStore.lyricCandidates).toHaveLength(2)
      expect(songStore.coverSearchState).toBe('idle') // 只刷歌词
    })

    it('手动搜封面：只刷 coverCandidates（过滤 cover_url），不动歌词候选', async () => {
      songStore.lyricCandidates = [makeCand()]
      songStore.lyricSearchState = 'done'
      const searchSongs = vi.fn(async () =>
        result([makeCand({ cover_url: 'https://x/1.jpg' }), makeCand({ source: 'qqmusic', id: 'q1', cover_url: null })]),
      )

      await manualSearch('cover', searchSongs)

      expect(songStore.coverSearchState).toBe('done')
      expect(songStore.coverCandidates).toHaveLength(1)
      expect(songStore.lyricCandidates).toEqual([makeCand()]) // 歌词候选不受影响
      expect(songStore.lyricSearchState).toBe('done')
    })

    it('手动搜索失败 → 空候选 + done（cand-empty 展示），不标离线（D3 仅自动搜索判定）', async () => {
      const searchSongs = vi.fn(async () => { throw new Error('down') })
      await manualSearch('lyrics', searchSongs)
      expect(songStore.lyricCandidates).toEqual([])
      expect(songStore.lyricSearchState).toBe('done')
      expect(songStore.isOffline).toBe(false) // 不标离线
    })

    it('搜歌词清 lyricFetchEmpty（CR C2）：新搜索作废上次 C2 全源失败空态，不遮蔽新候选', async () => {
      songStore.lyricFetchEmpty = true // 上次 C2 全源失败残留
      const searchSongs = vi.fn(async () => result([makeCand()]))

      await manualSearch('lyrics', searchSongs)

      expect(songStore.lyricFetchEmpty).toBe(false)
      expect(songStore.lyricCandidates).toHaveLength(1) // 新候选正常展示
    })

    it('搜封面不动 lyricFetchEmpty（只清对应 kind 的歌词空态）', async () => {
      songStore.lyricFetchEmpty = true
      const searchSongs = vi.fn(async () => result([makeCand({ cover_url: 'https://x/1.jpg' })]))
      await manualSearch('cover', searchSongs)
      expect(songStore.lyricFetchEmpty).toBe(true) // 封面搜索不影响歌词 C2 空态
      expect(songStore.coverCandidates).toHaveLength(1)
    })

    it('readonly → 不搜', async () => {
      songStore.readonly = true
      const searchSongs = vi.fn(async () => result([makeCand()]))
      await manualSearch('lyrics', searchSongs)
      expect(searchSongs).not.toHaveBeenCalled()
    })
  })

  describe('pickLyricCandidate — 点选歌词填入 + 换源（D4：C2）', () => {
    it('取词成功 → current.lyrics 填入 + lyricSourcePlatform=该源 + dirty 翻转', async () => {
      songStore.lyricCandidates = [makeCand()]
      const fetchLyric = vi.fn(async () => '[00:00.00] 歌词')
      expect(songStore.dirty).toBe(false)

      await pickLyricCandidate(makeCand(), fetchLyric)

      expect(fetchLyric).toHaveBeenCalledWith('netease', 'n1')
      expect(songStore.current!.lyrics).toBe('[00:00.00] 歌词')
      expect(songStore.lyricSourcePlatform).toBe('netease')
      expect(songStore.dirty).toBe(true) // 歌词在 DIRTY_FIELDS
    })

    it('C2 换源成功：原源 None → 按候选 title/artist 重搜 → 固定顺序取另一家成功 → 填 + badge=该源', async () => {
      const cand = makeCand() // netease
      const fetchLyric = vi.fn(async (source: MusicSourceId) =>
        source === 'netease' ? null : source === 'qqmusic' ? '[00:00.00] QQ词' : null,
      )
      const searchSongs = vi.fn(async () =>
        result([
          makeCand({ source: 'qqmusic', id: 'q1' }),
          makeCand({ source: 'migu', id: 'm1' }),
        ]),
      )

      await pickLyricCandidate(cand, fetchLyric, searchSongs)

      // 重搜以候选自身 title/artist 为身份（非可能被编辑的 current）
      expect(searchSongs).toHaveBeenCalledWith('歌名', '作者')
      expect(songStore.current!.lyrics).toBe('[00:00.00] QQ词')
      expect(songStore.lyricSourcePlatform).toBe('qqmusic') // badge = 换源成功的源
      expect(songStore.lyricFetchEmpty).toBe(false)
    })

    it('C2 全源失败 → lyricFetchEmpty=true（空态「未找到匹配的歌词，可手动粘贴」）', async () => {
      const fetchLyric = vi.fn(async () => null)
      const searchSongs = vi.fn(async () => result([makeCand({ source: 'qqmusic', id: 'q1' })]))

      await pickLyricCandidate(makeCand(), fetchLyric, searchSongs)

      expect(songStore.lyricFetchEmpty).toBe(true)
      expect(songStore.current!.lyrics).toBe('') // 不降级到低分候选
      expect(songStore.lyricSourcePlatform).toBeNull()
    })

    it('C2 跳过原源：固定顺序 netease→qqmusic→migu，不重复取原源', async () => {
      const cand = makeCand({ source: 'qqmusic', id: 'q1' }) // 原源 qqmusic
      const fetchCalls: MusicSourceId[] = []
      const fetchLyric = vi.fn(async (source: MusicSourceId) => {
        fetchCalls.push(source)
        return null
      })
      const searchSongs = vi.fn(async () =>
        result([
          makeCand({ source: 'netease', id: 'n1' }),
          makeCand({ source: 'qqmusic', id: 'q2' }),
          makeCand({ source: 'migu', id: 'm1' }),
        ]),
      )

      await pickLyricCandidate(cand, fetchLyric, searchSongs)

      // 首取原源 qqmusic（点选那一下）→ None 后 C2 重试只取 netease/migu（跳过原源 qqmusic）
      expect(fetchCalls).toEqual(['qqmusic', 'netease', 'migu'])
      expect(songStore.lyricFetchEmpty).toBe(true)
    })

    it('已切歌（searchSeq 变化）→ 取词结果丢弃不应用', async () => {
      let resolveFetch!: (t: string | null) => void
      const fetchLyric = vi.fn(() => new Promise<string | null>((res) => { resolveFetch = res }))
      const p = pickLyricCandidate(makeCand(), fetchLyric)
      // 等待 fetch 挂起后切歌
      await Promise.resolve()
      songStore.searchSeq++
      resolveFetch('[00:00.00] 迟到的歌词')
      await p
      expect(songStore.current!.lyrics).toBe('') // 未应用
    })
  })

  describe('pickCoverCandidate — 点选封面下载/解码/压缩（D6）', () => {
    it('成功：downloadCover → bytesToCoverInput → setCover（dirty 翻转）', async () => {
      songStore.coverCandidates = [makeCand({ cover_url: 'https://x/1.jpg' })]
      const downloadCover = vi.fn(async () => [0xff, 0xd8, 0xff, 0xe0])
      const bytesToCoverInput = vi.fn(async () => ({ data_url: 'data:image/jpeg;base64,AAA', mime: 'image/jpeg' }))

      await pickCoverCandidate(makeCand({ cover_url: 'https://x/1.jpg' }), downloadCover, bytesToCoverInput)

      expect(downloadCover).toHaveBeenCalledWith('https://x/1.jpg')
      expect(bytesToCoverInput).toHaveBeenCalledWith([0xff, 0xd8, 0xff, 0xe0])
      expect(songStore.current!.cover).toBe('data:image/jpeg;base64,AAA')
      expect(songStore.current!.cover_mime).toBe('image/jpeg')
      expect(songStore.dirty).toBe(true)
    })

    it('cover_url 为 null → 忽略（不下载）', async () => {
      const downloadCover = vi.fn(async () => [])
      await pickCoverCandidate(makeCand({ cover_url: null }), downloadCover)
      expect(downloadCover).not.toHaveBeenCalled()
    })

    it('下载失败 → 静默从 coverCandidates 移除该张，其余不受影响（验收 #12）', async () => {
      const keep = makeCand({ source: 'qqmusic', id: 'q1', cover_url: 'https://q/1.jpg' })
      songStore.coverCandidates = [makeCand({ cover_url: 'https://x/1.jpg' }), keep]
      const downloadCover = vi.fn(async () => { throw new Error('下载超时') })

      await pickCoverCandidate(makeCand({ cover_url: 'https://x/1.jpg' }), downloadCover)

      expect(songStore.coverCandidates).toEqual([keep]) // 该张被移除、其余保留
      expect(songStore.current!.cover).toBeNull() // 不写入
      expect(songStore.dirty).toBe(false)
    })

    it('解码/压缩失败 → 同样静默移除（bytesToCoverInput reject）', async () => {
      const keep = makeCand({ source: 'qqmusic', id: 'q1', cover_url: 'https://q/1.jpg' })
      songStore.coverCandidates = [makeCand({ cover_url: 'https://x/1.jpg' }), keep]
      const downloadCover = vi.fn(async () => [0xff, 0xd8, 0xff])
      const bytesToCoverInput = vi.fn(async () => { throw new Error('封面格式无法识别') })

      await pickCoverCandidate(makeCand({ cover_url: 'https://x/1.jpg' }), downloadCover, bytesToCoverInput)

      expect(songStore.coverCandidates).toEqual([keep])
    })

    it('已切歌（searchSeq 变化）→ 下载结果丢弃不应用、不移除', async () => {
      songStore.coverCandidates = [makeCand({ cover_url: 'https://x/1.jpg' })]
      let resolveDownload!: (b: number[]) => void
      const downloadCover = vi.fn(() => new Promise<number[]>((res) => { resolveDownload = res }))
      const p = pickCoverCandidate(makeCand({ cover_url: 'https://x/1.jpg' }), downloadCover)
      await Promise.resolve()
      songStore.searchSeq++
      resolveDownload([0xff, 0xd8, 0xff])
      await p
      expect(songStore.current!.cover).toBeNull()
      expect(songStore.coverCandidates).toHaveLength(1) // 不移除（已切歌）
    })

    it('readonly → 不下载', async () => {
      songStore.readonly = true
      const downloadCover = vi.fn(async () => [])
      await pickCoverCandidate(makeCand({ cover_url: 'https://x/1.jpg' }), downloadCover)
      expect(downloadCover).not.toHaveBeenCalled()
    })
  })
})
