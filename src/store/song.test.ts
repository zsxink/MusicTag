import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CoverInput, Song, SongSummary } from '../api/types'
import { activateFolder, clearCover, open, save, selectSong, setCover, songStore, undo } from './song'

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
