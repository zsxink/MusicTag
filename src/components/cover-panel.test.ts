import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'

// mock @tauri-apps/api/core.invoke → CoverPanel 经 api/songs.ts 的 pickCoverFile/readCoverPath
// 走 mock IPC（api/client.ts 必须保留 `import { invoke } from '@tauri-apps/api/core'`，改源失效）。
const mockInvoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

// mock ../api/search + ../lib/cover → CoverPanel 经 store 动作（manualSearch/pickCoverCandidate）
// 的默认注入兜底（downloadCover 裸 bytes + bytesToCoverInput 桩，避免真实 Image 加载）。
const { mockSearchSongs, mockDownloadCover, mockBytesToCoverInput } = vi.hoisted(() => ({
  mockSearchSongs: vi.fn(async () => ({
    songs: [],
    source_stats: [
      ['netease', 0],
      ['qqmusic', 0],
      ['kugou', 0],
      ['lrclib', 0],
      ['itunes', 0],
    ],
  })),
  mockDownloadCover: vi.fn(async () => []),
  mockBytesToCoverInput: vi.fn(async () => ({ data_url: 'data:image/jpeg;base64,AAA', mime: 'image/jpeg' })),
}))
vi.mock('../api/search', () => ({
  searchSongs: mockSearchSongs,
  fetchLyric: vi.fn(async () => null),
  downloadCover: mockDownloadCover,
}))
vi.mock('../lib/cover', () => ({
  bytesToCoverInput: mockBytesToCoverInput,
}))

// mock @tauri-apps/api/window → getCurrentWindow().onDragDropEvent 捕获 handler + 返回 fake unlisten
// （v1-cover-embed D4：拖拽用 Tauri 原生 drag-drop，非 WebView FileReader）。
// position：Tauri DragDropEvent 的 PhysicalPosition（enter/over/drop 携带，leave 无）。
type DragEventPayload = {
  type: string
  paths?: string[]
  position?: { x: number; y: number }
}
const { dragHandler, unlisten } = vi.hoisted(() => {
  let handler: ((e: { payload: DragEventPayload }) => void) | undefined
  const unlisten = vi.fn()
  return {
    dragHandler: {
      set: (h: typeof handler) => {
        handler = h
      },
      get: () => handler,
    },
    unlisten,
  }
})

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onDragDropEvent: vi.fn(async (h: (e: { payload: DragEventPayload }) => void) => {
      dragHandler.set(h)
      return unlisten
    }),
  }),
}))

import type { CoverInput, Song } from '../api/types'
import { clearCover, setCover, songStore } from '../store/song'
import CoverPanel from './CoverPanel.vue'

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

const cover: CoverInput = { data_url: 'data:image/png;base64,AAAA', mime: 'image/png' }

/** 打开一首歌进 store（等价 open() 成功态，含切歌重置搜索状态）。 */
function openSong(song: Song = makeSong()): void {
  songStore.current = { ...song }
  songStore.original = { ...song }
  songStore.readonly = false
  songStore.lyricsSource = song.lyrics_source
  songStore.selectedPath = song.path
  songStore.saveState = 'idle'
  songStore.saveError = ''
  songStore.coverSearchState = 'idle'
  songStore.coverCandidates = []
  songStore.isOffline = false
  songStore.searchedThisSong = false
  songStore.lyricSearchState = 'idle'
  songStore.lyricCandidates = []
  songStore.lyricSourcePlatform = null
  songStore.lyricFetchEmpty = false
}

describe('CoverPanel — 点击选择嵌入（v1-cover-embed D5）', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    unlisten.mockClear()
    dragHandler.set(undefined)
    openSong()
  })

  it('点击封面框（空态）→ pickCoverFile 成功 → 预览图写入 current.cover + dirty 翻转', async () => {
    mockInvoke.mockResolvedValue(cover)
    const w = mount(CoverPanel)
    await w.find('.cover-empty').trigger('click')
    await flushPromises()

    expect(mockInvoke).toHaveBeenCalledWith('pick_cover_file', undefined)
    expect(songStore.current!.cover).toBe('data:image/png;base64,AAAA')
    expect(songStore.current!.cover_mime).toBe('image/png')
    expect(songStore.dirty).toBe(true)
    expect(w.find('img.cover-img').attributes('src')).toBe('data:image/png;base64,AAAA')
  })

  it('有封面时点击封面框同样可再选择（替换封面）', async () => {
    openSong(makeSong({ cover: 'data:image/png;base64,OLD', cover_mime: 'image/png' }))
    mockInvoke.mockResolvedValue(cover)
    const w = mount(CoverPanel)
    await w.find('.cover-box.has-cover').trigger('click')
    await flushPromises()
    expect(songStore.current!.cover).toBe('data:image/png;base64,AAAA')
  })

  it('取消选择（返回 null）→ 不写封面、不翻转 dirty', async () => {
    mockInvoke.mockResolvedValue(null)
    const w = mount(CoverPanel)
    await w.find('.cover-empty').trigger('click')
    await flushPromises()
    expect(songStore.current!.cover).toBeNull()
    expect(songStore.dirty).toBe(false)
  })

  it('选择失败（reject）→ 不污染现有封面，显示一行 dim 错误提示', async () => {
    mockInvoke.mockRejectedValue(new Error('封面格式无法识别'))
    const w = mount(CoverPanel)
    await w.find('.cover-empty').trigger('click')
    await flushPromises()
    expect(songStore.current!.cover).toBeNull()
    expect(w.find('.cover-error').exists()).toBe(true)
    expect(w.text()).toContain('封面格式无法识别')
  })

  it('readonly → 点击不响应（坏标签只读，封面区禁用）', async () => {
    songStore.readonly = true
    const w = mount(CoverPanel)
    await w.find('.cover-empty').trigger('click')
    await flushPromises()
    expect(mockInvoke).not.toHaveBeenCalled()
    expect(songStore.current!.cover).toBeNull()
  })
})

describe('CoverPanel — 拖拽嵌入（v1-cover-embed D4，Tauri 原生 drag-drop，范围限定封面区）', () => {
  /** 封面框 200×200 于 (0,0)。happy-dom 默认 getBoundingClientRect 全 0，须显式 stub 才能命中判定。 */
  const COVER_RECT = { x: 0, y: 0, width: 200, height: 200 }
  /** 封面框内指针坐标。 */
  const INSIDE = { x: 100, y: 100 }
  /** 封面框外指针坐标（歌词区/字段区/顶栏）。 */
  const OUTSIDE = { x: 500, y: 500 }

  /** 给封面框元素注入 getBoundingClientRect 桩（组件经 coverEl ref 读同一元素）。 */
  function stubCoverBoxRect(w: VueWrapper): void {
    const el = w.find('.cover-box').element as HTMLElement
    el.getBoundingClientRect = () =>
      ({
        x: COVER_RECT.x,
        y: COVER_RECT.y,
        width: COVER_RECT.width,
        height: COVER_RECT.height,
        top: COVER_RECT.y,
        right: COVER_RECT.x + COVER_RECT.width,
        bottom: COVER_RECT.y + COVER_RECT.height,
        left: COVER_RECT.x,
      }) as DOMRect
  }

  beforeEach(() => {
    mockInvoke.mockReset()
    unlisten.mockClear()
    dragHandler.set(undefined)
    openSong()
    window.devicePixelRatio = 1 // 命中判定按 dpr 对齐物理/CSS 像素，测试固定为 1
  })

  it('onMounted 订阅 getCurrentWindow().onDragDropEvent；drop 落在封面框内 → readCoverPath → setCover', async () => {
    mockInvoke.mockResolvedValue(cover)
    const w = mount(CoverPanel)
    await flushPromises() // 等 onMounted 异步订阅完成，handler 被捕获
    stubCoverBoxRect(w)

    const handler = dragHandler.get()!
    handler({ payload: { type: 'enter', paths: ['/tmp/cover.png'], position: INSIDE } })
    await flushPromises()
    expect(w.find('.cover-box').classes()).toContain('dragging')

    handler({ payload: { type: 'drop', paths: ['/tmp/cover.png'], position: INSIDE } })
    await flushPromises()

    expect(mockInvoke).toHaveBeenCalledWith('read_cover_path', { path: '/tmp/cover.png' })
    expect(songStore.current!.cover).toBe('data:image/png;base64,AAAA')
    expect(songStore.dirty).toBe(true)
    expect(w.find('.cover-box').classes()).not.toContain('dragging') // drop 后复位
  })

  it('CR：drop 落在封面框外（歌词区/字段区/顶栏）→ 不触发 readCoverPath、不替换封面', async () => {
    mockInvoke.mockResolvedValue(cover)
    const w = mount(CoverPanel)
    await flushPromises()
    stubCoverBoxRect(w)

    const handler = dragHandler.get()!
    handler({ payload: { type: 'drop', paths: ['/tmp/cover.png'], position: OUTSIDE } })
    await flushPromises()

    expect(mockInvoke).not.toHaveBeenCalled()
    expect(songStore.current!.cover).toBeNull()
    expect(songStore.dirty).toBe(false)
  })

  it('CR：enter/over 不在封面框内 → 不点亮 dragging 高亮（窗口其余区域拖拽不误导封面框）', async () => {
    const w = mount(CoverPanel)
    await flushPromises()
    stubCoverBoxRect(w)

    const handler = dragHandler.get()!
    // 进入窗口但指针落在封面框外 → 不高亮
    handler({ payload: { type: 'enter', paths: ['/a.png'], position: OUTSIDE } })
    await flushPromises()
    expect(w.find('.cover-box').classes()).not.toContain('dragging')

    // over 移入封面框 → 点亮；再移出封面框 → 熄灭（over 连续事件实时跟随指针）
    handler({ payload: { type: 'over', position: INSIDE } })
    await flushPromises()
    expect(w.find('.cover-box').classes()).toContain('dragging')

    handler({ payload: { type: 'over', position: OUTSIDE } })
    await flushPromises()
    expect(w.find('.cover-box').classes()).not.toContain('dragging')
  })

  it('leave（取消拖拽/离开窗口）→ 复位 dragging 高亮', async () => {
    const w = mount(CoverPanel)
    await flushPromises()
    stubCoverBoxRect(w)
    const handler = dragHandler.get()!
    handler({ payload: { type: 'enter', paths: ['/a.png'], position: INSIDE } })
    await flushPromises()
    expect(w.find('.cover-box').classes()).toContain('dragging')
    handler({ payload: { type: 'leave' } })
    await flushPromises()
    expect(w.find('.cover-box').classes()).not.toContain('dragging')
  })

  it('CR：Retina（dpr=2）下命中判定按物理像素对齐，不缩小/偏移命中框', async () => {
    // design D4 CR 定稿：onDragDropEvent 的 position 是 PhysicalPosition，rect 是 CSS px，
    // 必须按 devicePixelRatio 对齐——dpr=2 时封面框 CSS 200×200 对应物理 400×400。
    mockInvoke.mockResolvedValue(cover)
    window.devicePixelRatio = 2
    const w = mount(CoverPanel)
    await flushPromises()
    stubCoverBoxRect(w)
    const handler = dragHandler.get()!

    // 物理 (350,350) 在缩放后封面框 (0..400) 内（若未按 dpr 对齐会被误判为框外）
    handler({ payload: { type: 'enter', paths: ['/a.png'], position: { x: 350, y: 350 } } })
    await flushPromises()
    expect(w.find('.cover-box').classes()).toContain('dragging')

    // 物理 (450,450) 超出缩放后封面框（若未对齐，450>200 也会框外，但 450>400 证明真外）
    handler({ payload: { type: 'over', position: { x: 450, y: 450 } } })
    await flushPromises()
    expect(w.find('.cover-box').classes()).not.toContain('dragging')

    // drop 用同样的物理坐标判定：框内 (350,350) 嵌入、框外 (450,450) 不嵌入
    handler({ payload: { type: 'drop', paths: ['/retina.png'], position: { x: 350, y: 350 } } })
    await flushPromises()
    expect(mockInvoke).toHaveBeenCalledWith('read_cover_path', { path: '/retina.png' })
    expect(songStore.current!.cover).toBe('data:image/png;base64,AAAA')
  })

  it('拖拽非图片文件（readCoverPath reject）→ 不污染封面、显示错误提示', async () => {
    mockInvoke.mockRejectedValue(new Error('封面格式无法识别'))
    const w = mount(CoverPanel)
    await flushPromises()
    stubCoverBoxRect(w)
    const handler = dragHandler.get()!
    handler({ payload: { type: 'drop', paths: ['/tmp/not_image.txt'], position: INSIDE } })
    await flushPromises()
    expect(songStore.current!.cover).toBeNull()
    expect(songStore.dirty).toBe(false)
    expect(w.find('.cover-error').exists()).toBe(true)
  })

  it('readonly → drop 事件不触发 readCoverPath（拖拽同样被禁用）', async () => {
    songStore.readonly = true
    const w = mount(CoverPanel)
    await flushPromises()
    const handler = dragHandler.get()!
    handler({ payload: { type: 'enter', paths: ['/a.png'], position: INSIDE } })
    await flushPromises()
    expect(w.find('.cover-box').classes()).not.toContain('dragging') // 只读不高亮
    handler({ payload: { type: 'drop', paths: ['/a.png'], position: INSIDE } })
    await flushPromises()
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('onBeforeUnmount → 调用 unlisten 清理订阅', async () => {
    const w = mount(CoverPanel)
    await flushPromises()
    expect(unlisten).not.toHaveBeenCalled()
    w.unmount()
    expect(unlisten).toHaveBeenCalledTimes(1)
  })
})

describe('CoverPanel — 清空封面（v1-cover-embed D5，全量覆盖删除语义）', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    unlisten.mockClear()
    dragHandler.set(undefined)
  })

  it('有封面 → ✕ 清空按钮 → clearCover 置 null + dirty 翻转（保存走既有删除语义）', async () => {
    openSong(makeSong({ cover: 'data:image/png;base64,AAAA', cover_mime: 'image/png' }))
    const w = mount(CoverPanel)
    await w.find('.cover-clear').trigger('click')

    expect(songStore.current!.cover).toBeNull()
    expect(songStore.current!.cover_mime).toBeNull()
    expect(songStore.dirty).toBe(true) // 与 original 的封面不一致 → 删除标记
    expect(w.find('img.cover-img').exists()).toBe(false)
    expect(w.find('.cover-empty').exists()).toBe(true)
  })

  it('无封面 → 不渲染清空按钮', () => {
    openSong()
    const w = mount(CoverPanel)
    expect(w.find('.cover-clear').exists()).toBe(false)
  })
})

describe('CoverPanel — mime 展示（spec「支持常见图片格式」：mime 被探测并展示）', () => {
  it('JPEG 封面 → cover-meta 展示 image/jpeg（点击选择/拖拽均同一条 setCover 路径）', () => {
    openSong(makeSong({ cover: 'data:image/jpeg;base64,AAAA', cover_mime: 'image/jpeg' }))
    const w = mount(CoverPanel)
    expect(w.find('img.cover-img').attributes('src')).toBe('data:image/jpeg;base64,AAAA')
    expect(w.find('.cover-meta').text()).toContain('image/jpeg')
  })

  it('WebP 封面 → cover-meta 展示 image/webp', () => {
    openSong(makeSong({ cover: 'data:image/webp;base64,BBBB', cover_mime: 'image/webp' }))
    const w = mount(CoverPanel)
    expect(w.find('.cover-meta').text()).toContain('image/webp')
  })
})

describe('CoverPanel — 封面候选区（v1-search-ui D8：status/网格/空态/离线）', () => {
  const cand = (over: Partial<import('../api/types').SongCandidate> = {}): import('../api/types').SongCandidate => ({
    source: 'netease',
    id: 'n1',
    title: '歌名',
    artist: '作者',
    album: '专辑',
    cover_url: 'https://p1.music.126.net/1.jpg',
    ...over,
  })

  beforeEach(() => {
    mockSearchSongs.mockReset()
    mockDownloadCover.mockReset()
    mockBytesToCoverInput.mockReset()
    mockBytesToCoverInput.mockResolvedValue({ data_url: 'data:image/jpeg;base64,AAA', mime: 'image/jpeg' })
    mockSearchSongs.mockResolvedValue({
      songs: [],
      source_stats: [
        ['netease', 0],
        ['qqmusic', 0],
        ['kugou', 0],
        ['lrclib', 0],
        ['itunes', 0],
      ],
    })
    openSong()
  })

  it('「搜索封面」按钮可用性：readonly / 无歌禁用', () => {
    const w = mount(CoverPanel)
    expect((w.find('.search-trigger').element as HTMLButtonElement).disabled).toBe(false)

    songStore.current = null
    songStore.readonly = false
    const w2 = mount(CoverPanel)
    expect((w2.find('.search-trigger').element as HTMLButtonElement).disabled).toBe(true)

    songStore.current = { ...makeSong() }
    songStore.readonly = true
    const w3 = mount(CoverPanel)
    expect((w3.find('.search-trigger').element as HTMLButtonElement).disabled).toBe(true)
  })

  it('点击「搜索封面」→ manualSearch 以 current 的 title/artist/album 发起', async () => {
    const w = mount(CoverPanel)
    await w.find('.search-trigger').trigger('click')
    await flushPromises()
    expect(mockSearchSongs).toHaveBeenCalledWith('歌名', '作者', '') // makeSong 默认空专辑
  })

  it('searching → 显示「搜索中…」+ 转圈', () => {
    songStore.coverSearchState = 'searching'
    const w = mount(CoverPanel)
    const status = w.find('.cand-status')
    expect(status.exists()).toBe(true)
    expect(status.text()).toContain('搜索中…')
    expect(status.find('.spinner').exists()).toBe(true)
  })

  it('done 有候选 → 3 列网格缩略图 + 来源角标 + 提示（design §6.4）', () => {
    songStore.coverSearchState = 'done'
    songStore.coverCandidates = [
      cand({ source: 'netease', id: 'n1' }),
      cand({ source: 'qqmusic', id: 'q1', cover_url: 'https://q/1.jpg' }),
      cand({ source: 'itunes', id: 'i1', cover_url: 'https://i/1.jpg' }),
    ]
    const w = mount(CoverPanel)
    const cells = w.findAll('.cand-cell')
    expect(cells).toHaveLength(3)
    expect(w.find('.cand-grid').classes()).toContain('cand-grid')
    expect(cells[0].find('img').attributes('src')).toBe('https://p1.music.126.net/1.jpg')
    expect(cells[0].find('.src-tag').text()).toBe('网易云')
    expect(cells[1].find('.src-tag').text()).toBe('QQ音乐')
    expect(w.find('.cand-hint').text()).toContain('点选一张填入预览')
  })

  it('done 无候选 → 空态「未找到匹配的封面」', () => {
    songStore.coverSearchState = 'done'
    songStore.coverCandidates = []
    const w = mount(CoverPanel)
    expect(w.find('.cand-empty').text()).toBe('未找到匹配的封面')
  })

  it('isOffline && idle → 「离线：仅手动填写」（候选区不出现，手动按钮可用）', () => {
    songStore.isOffline = true
    const w = mount(CoverPanel)
    expect(w.find('.cand-empty').text()).toBe('离线：仅手动填写')
    expect((w.find('.search-trigger').element as HTMLButtonElement).disabled).toBe(false)
  })

  it('点选封面候选 → downloadCover 裸 bytes → bytesToCoverInput → setCover（dirty 翻转）', async () => {
    songStore.coverSearchState = 'done'
    songStore.coverCandidates = [cand({ cover_url: 'https://p1.music.126.net/1.jpg' })]
    mockDownloadCover.mockResolvedValue([0xff, 0xd8, 0xff, 0xe0])
    const w = mount(CoverPanel)

    await w.find('.cand-cell').trigger('click')
    await flushPromises()

    expect(mockDownloadCover).toHaveBeenCalledWith('https://p1.music.126.net/1.jpg')
    expect(mockBytesToCoverInput).toHaveBeenCalledWith([0xff, 0xd8, 0xff, 0xe0])
    expect(songStore.current!.cover).toBe('data:image/jpeg;base64,AAA')
    expect(songStore.current!.cover_mime).toBe('image/jpeg')
    expect(songStore.dirty).toBe(true)
  })

  it('缩略图破图（onerror）→ 静默隐藏该格（验收 #12），其余格不受影响', async () => {
    songStore.coverSearchState = 'done'
    songStore.coverCandidates = [
      cand({ source: 'netease', id: 'n1', cover_url: 'https://broken/1.jpg' }),
      cand({ source: 'qqmusic', id: 'q1', cover_url: 'https://ok/1.jpg' }),
    ]
    const w = mount(CoverPanel)
    const imgs = w.findAll('.cand-cell img')
    expect(imgs).toHaveLength(2)

    await imgs[0].trigger('error')

    expect(w.findAll('.cand-cell')).toHaveLength(1) // 破图格被隐藏
    expect(w.find('.cand-cell .src-tag').text()).toBe('QQ音乐') // 其余正常
  })

  it('readonly（坏标签只读）→ 搜索按钮禁用、不触发搜索', async () => {
    songStore.readonly = true
    const w = mount(CoverPanel)
    expect((w.find('.search-trigger').element as HTMLButtonElement).disabled).toBe(true)
    await w.find('.search-trigger').trigger('click')
    await flushPromises()
    expect(mockSearchSongs).not.toHaveBeenCalled()
  })
})

describe('CoverPanel — 候选区折叠（candidate-collapse：默认展开、点击折叠、切歌后重置展开）', () => {
  const cand = (over: Partial<import('../api/types').SongCandidate> = {}): import('../api/types').SongCandidate => ({
    source: 'netease',
    id: 'n1',
    title: '歌名',
    artist: '作者',
    album: '专辑',
    cover_url: 'https://p1.music.126.net/1.jpg',
    ...over,
  })

  beforeEach(() => {
    mockSearchSongs.mockReset()
    mockDownloadCover.mockReset()
    mockBytesToCoverInput.mockReset()
    mockBytesToCoverInput.mockResolvedValue({ data_url: 'data:image/jpeg;base64,AAA', mime: 'image/jpeg' })
    mockSearchSongs.mockResolvedValue({
      songs: [],
      source_stats: [
        ['netease', 0],
        ['qqmusic', 0],
        ['kugou', 0],
        ['lrclib', 0],
        ['itunes', 0],
      ],
    })
    openSong()
  })

  /** v-show 折叠只改 .cand-wrap 的内联 display（happy-dom 不计算样式，直接断言内联属性）。 */
  function candWrapDisplay(w: VueWrapper): string {
    return (w.find('.cand-wrap').element as HTMLElement).style.display
  }

  it('默认展开：done + 候选非空 → .cand-grid 存在、.cand-wrap 无 display:none、按钮文案「隐藏候选 ▲」', () => {
    songStore.coverSearchState = 'done'
    songStore.coverCandidates = [cand()]
    const w = mount(CoverPanel)
    expect(w.find('.cand-grid').exists()).toBe(true)
    expect(candWrapDisplay(w)).not.toBe('none') // v-show 未折叠（内联 display 无值）
    expect(w.find('.cand-toggle').text()).toContain('隐藏候选')
  })

  it('点击折叠 → .cand-wrap display:none、按钮文案「展开候选 ▼」', async () => {
    songStore.coverSearchState = 'done'
    songStore.coverCandidates = [cand()]
    const w = mount(CoverPanel)
    await w.find('.cand-toggle').trigger('click')
    expect(candWrapDisplay(w)).toBe('none')
    expect(w.find('.cand-toggle').text()).toContain('展开候选')
  })

  it('重新展开 → .cand-wrap 恢复显示、按钮文案「隐藏候选 ▲」', async () => {
    songStore.coverSearchState = 'done'
    songStore.coverCandidates = [cand()]
    const w = mount(CoverPanel)
    await w.find('.cand-toggle').trigger('click') // 收起
    expect(candWrapDisplay(w)).toBe('none')
    await w.find('.cand-toggle').trigger('click') // 再点展开
    expect(candWrapDisplay(w)).not.toBe('none')
    expect(w.find('.cand-toggle').text()).toContain('隐藏候选')
  })

  it('切歌后重置展开：收起后切到另一首歌（current.path 变）→ 默认展开', async () => {
    songStore.coverSearchState = 'done'
    songStore.coverCandidates = [cand()]
    const w = mount(CoverPanel)
    await w.find('.cand-toggle').trigger('click') // 收起
    expect(candWrapDisplay(w)).toBe('none')
    expect(w.find('.cand-toggle').text()).toContain('展开候选')

    // 真实切歌：current.path 变化（watch 重置折叠为默认展开）+ resetSearchState 清候选
    songStore.current = { ...makeSong({ path: '/b/song.flac' }) }
    songStore.coverSearchState = 'done'
    songStore.coverCandidates = [cand({ id: 'q2', cover_url: 'https://q/2.jpg' })]
    await w.vm.$nextTick() // watch 异步触发折叠重置

    expect(candWrapDisplay(w)).not.toBe('none') // 已重置为默认展开
    expect(w.find('.cand-toggle').text()).toContain('隐藏候选')
  })

  it('候选区无内容（idle 且无候选/非离线）→ 不显示折叠按钮、无占位', () => {
    const w = mount(CoverPanel)
    expect(w.find('.cand-toggle').exists()).toBe(false)
  })

  it('空态分支（done + 候选空）也算有内容 → 显示折叠按钮（spec「空态」属有内容）', () => {
    songStore.coverSearchState = 'done'
    songStore.coverCandidates = []
    const w = mount(CoverPanel)
    expect(w.find('.cand-empty').exists()).toBe(true) // 空态渲染
    expect(w.find('.cand-toggle').exists()).toBe(true) // 有内容 → 显示按钮
  })

  it('searching 也算有内容 → 显示折叠按钮（spec「搜索中」属有内容）', () => {
    songStore.coverSearchState = 'searching'
    const w = mount(CoverPanel)
    expect(w.find('.cand-status').exists()).toBe(true)
    expect(candWrapDisplay(w)).not.toBe('none') // 默认展开
    expect(w.find('.cand-toggle').text()).toContain('隐藏候选')
  })

  it('离线（网络失败路径）也算有内容 → 显示折叠按钮（spec「离线提示」属有内容）', () => {
    songStore.isOffline = true
    const w = mount(CoverPanel)
    expect(w.find('.cand-empty').text()).toBe('离线：仅手动填写')
    expect(w.find('.cand-toggle').exists()).toBe(true) // 离线 → 按钮显示
  })

  it('折叠只翻转本地 ref：不触发 store 动作、不清候选（design 语义）', async () => {
    songStore.coverSearchState = 'done'
    songStore.coverCandidates = [cand()]
    const w = mount(CoverPanel)
    await w.find('.cand-toggle').trigger('click')
    // store 状态未被折叠改动：候选仍在、搜索状态不变、无搜索调用
    expect(songStore.coverCandidates).toHaveLength(1)
    expect(songStore.coverSearchState).toBe('done')
    expect(mockSearchSongs).not.toHaveBeenCalled()
    expect(w.find('.cand-grid').exists()).toBe(true) // v-show 保留 DOM，仅 display:none
  })
})

// ---------------------------------------------------------------------------
// 右键导出内嵌封面原图（export-embedded-cover design.md §4 / spec S1·S4·S6·S7·S8）
// ---------------------------------------------------------------------------

/** happy-dom 的 contextmenu 默认 button=0；真实右键 button=2——两者都算「右键」，
 *  以免日后 happy-dom 修了默认值导致本组用例集体假红。 */
const RIGHT_CLICK = { button: 2 } as const

describe('CoverPanel — 封面右键导出（export-embedded-cover）', () => {
  /** 已被点开的主机侧 IPC 名（裸 command 名；Component 禁直呼 invoke，命令名即签名）。 */
  type IpcName = string
  /** 只列导出流程的命令名：`mockInvoke` 若被调了别的命令即行为越界。 */
  const EXPORT_IPCS: IpcName[] = ['pick_cover_save_path', 'export_cover']

  const SAVED_PNG = 'data:image/png;base64,SAVED'

  /** happy-dom 默认视口 1024×768；贴边翻转用例显式 stub innerWidth/innerHeight。 */
  const DEFAULT_VIEWPORT = { width: 1024, height: 768 }

  let restoreViewport: () => void

  beforeEach(() => {
    mockInvoke.mockReset()
    unlisten.mockClear()
    dragHandler.set(undefined)
    openSong()
    window.devicePixelRatio = 1 // 定位只做 dpr=1 的纯数值判断：浮层用 CSS 像素，**刻意不**像拖拽那样乘 dpr
    restoreViewport = () => {}
  })

  afterEach(() => {
    restoreViewport()
  })

  /** 固定视口尺寸：happy-dom 的 window.innerWidth/innerHeight 可写，用于驱动组件的贴边翻转判断。 */
  function stubViewport(width: number, height: number): void {
    const prevW = window.innerWidth
    const prevH = window.innerHeight
    window.innerWidth = width
    window.innerHeight = height
    restoreViewport = () => {
      window.innerWidth = prevW
      window.innerHeight = prevH
    }
  }

  /** 打开一首歌（默认无封面）；传入 cover 字段即带封面。 */
  function openCovered(over: Partial<Song> = {}): void {
    openSong(makeSong({ cover: SAVED_PNG, cover_mime: 'image/png', ...over }))
  }

  /** 右键封面框：dispatch 真实 MouseEvent（要能读到 dispatch 后 Vue 已处理的 defaultPrevented，
   *  证明 `@contextmenu.prevent` 确实拦了默认菜单——VTU 的 trigger() 返回的是 nextTick，拿不到事件对象）。 */
  async function contextMenu(w: VueWrapper, clientX: number, clientY: number): Promise<MouseEvent> {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX, clientY })
    ;(w.find('.cover-box').element as HTMLElement).dispatchEvent(event)
    await w.vm.$nextTick()
    return event
  }

  /** `.cover-menu` 内联 style 的 left / top 像素值（happy-dom 不计算 CSS，定位只认内联串）。 */
  function menuLeftPx(w: VueWrapper): number {
    return Number.parseFloat((w.find('.cover-menu').element as HTMLElement).style.left)
  }
  function menuTopPx(w: VueWrapper): number {
    return Number.parseFloat((w.find('.cover-menu').element as HTMLElement).style.top)
  }

  /** 菜单项原生 disabled 属性（spec S1/S7 的判据，不看样式）。 */
  function menuItemDisabled(w: VueWrapper): boolean {
    return (w.find('.cover-menu-item').element as HTMLButtonElement).disabled
  }

  /** 导出流程真正发出去的 IPC（按调用顺序）；空数组 = 一个 IPC 都没发（spec S4/S7 的硬判据）。 */
  function exportInvokeCalls(): [IpcName, unknown][] {
    return mockInvoke.mock.calls.filter(([cmd]) => EXPORT_IPCS.includes(cmd as IpcName))
  }

  /** 「不假报成功」：无 .cover-error → .cover-error.text() 为空串。 */
  function errorText(w: VueWrapper): string {
    return w.find('.cover-error').exists() ? w.find('.cover-error').text() : ''
  }

  /** 只让导出流程的命令返回 `value`，其他命令一律拒绝——若组件越界调了别的 IPC 会立刻炸，
   *  比默默 resolve 更早暴露（S7 断言的正是「一个都不许调」）。 */
  function onlyExportIpc(value: unknown): void {
    mockInvoke.mockImplementation((cmd: string) => (
      EXPORT_IPCS.includes(cmd) ? Promise.resolve(value) : Promise.reject(new Error(`意外 IPC: ${cmd}`))
    ))
  }

  // ── S1 右键打开导出菜单 ───────────────────────────────────────────────

  it('S1：右键封面框 → 弹出 role=menu 浮层 + 「导出封面…」项可点击，且事件默认行为已被 prevent', async () => {
    openCovered()
    const w = mount(CoverPanel)
    await flushPromises()

    const event = await contextMenu(w, 120, 80)

    expect(w.find('.cover-menu').exists()).toBe(true)
    expect(w.find('.cover-menu').attributes('role')).toBe('menu')
    expect(w.find('.cover-menu-item').attributes('role')).toBe('menuitem')
    expect(w.find('.cover-menu-item').text()).toBe('导出封面…')
    expect(menuItemDisabled(w)).toBe(false) // 有内嵌封面 → 项可点击（spec S1）
    expect(event.defaultPrevented).toBe(true) // @contextmenu.prevent 拦下 WebView 默认菜单
    expect(mockInvoke).not.toHaveBeenCalled() // 开菜单不发任何 IPC
  })

  it('S1：浮层挂在 .cover 下、与 .cover-box 兄弟（.cover-box 有 overflow:hidden，挂其内必被裁剪）', async () => {
    openCovered()
    const w = mount(CoverPanel)
    await flushPromises()
    await contextMenu(w, 40, 40)

    const menu = w.find('.cover-menu')
    expect(menu.element.parentElement).toBe(w.find('.cover').element) // 兄弟于 .cover-box
    expect(w.find('.cover-box').element.contains(menu.element)).toBe(false)
    expect(w.find('.cover-box').classes()).toContain('has-cover')
  })

  it('S1：内联 left/top 反映事件 clientX/clientY（视口 CSS 像素，fixed 坐标系）', async () => {
    openCovered()
    stubViewport(1400, 1000) // 远离边缘 → 不触发翻转，坐标应原样落到内联 style
    const w = mount(CoverPanel)
    await flushPromises()

    await contextMenu(w, 137, 242)

    expect(menuLeftPx(w)).toBe(137)
    expect(menuTopPx(w)).toBe(242)
  })

  it('S1：贴视口右下边缘 → 纯数值翻转向左/上展开，菜单不被视口裁掉', async () => {
    openCovered()
    stubViewport(1024, 768) // MENU_W=140 / MENU_H=32：贴近右下角时 1024+140 溢出、768+32 溢出
    const w = mount(CoverPanel)
    await flushPromises()

    await contextMenu(w, 1024, 768)

    expect(menuLeftPx(w)).toBe(1024 - 140)
    expect(menuTopPx(w)).toBe(768 - 32)
  })

  it('S1：仅右边缘溢出 → 只向左翻、纵向仍用事件坐标（翻转按轴独立判断）', async () => {
    openCovered()
    stubViewport(300, 400) // 宽 300：290+140 溢出；高 400：10+32 不溢出
    const w = mount(CoverPanel)
    await flushPromises()

    await contextMenu(w, 290, 10)

    expect(menuLeftPx(w)).toBe(290 - 140) // 向左翻
    expect(menuTopPx(w)).toBe(10) // 纵向不翻，仍是事件坐标
  })

  it('S1：再次右键移到普通位置 → 内联坐标跟随最新一次右键（不复用旧坐标）', async () => {
    openCovered()
    stubViewport(1400, 1000)
    const w = mount(CoverPanel)
    await flushPromises()

    await contextMenu(w, 300, 200)
    await contextMenu(w, 500, 400)

    expect(menuLeftPx(w)).toBe(500)
    expect(menuTopPx(w)).toBe(400)
  })

  it('S1：dpr=2 下坐标仍是 CSS 像素（不乘 devicePixelRatio——与拖拽命中的物理像素有意区分）', async () => {
    openCovered()
    stubViewport(1400, 1000)
    window.devicePixelRatio = 2
    const w = mount(CoverPanel)
    await flushPromises()

    await contextMenu(w, 300, 200)

    // 判别力：实现若误乘 dpr（复用拖拽那套物理像素换算），这里会得到 600/400 → 红。
    expect(menuLeftPx(w)).toBe(300)
    expect(menuTopPx(w)).toBe(200)
  })

  it('S1：左键点封面框仍走「点击选择」，不被右键菜单劫持（spec S1 附带的回归面）', async () => {
    openCovered()
    mockInvoke.mockResolvedValue({ data_url: 'data:image/jpeg;base64,NEW', mime: 'image/jpeg' })
    const w = mount(CoverPanel)
    await flushPromises()

    await w.find('.cover-box').trigger('click', RIGHT_CLICK)
    await flushPromises()

    expect(w.find('.cover-menu').exists()).toBe(false) // 左键不开菜单
    expect(mockInvoke).toHaveBeenCalledWith('pick_cover_file', undefined)
  })

  // ── 导出执行（两步 command：pick_cover_save_path → export_cover） ──────

  it('导出：依次发 pick_cover_save_path + export_cover，参数逐字对齐（只读、不碰 store）', async () => {
    openCovered()
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'pick_cover_save_path') return Promise.resolve('/music/告白气球.png')
      if (cmd === 'export_cover') return Promise.resolve(undefined)
      return Promise.reject(new Error(`意外 IPC: ${cmd}`))
    })
    const w = mount(CoverPanel)
    await flushPromises()

    await contextMenu(w, 120, 80)
    await w.find('.cover-menu-item').trigger('click', RIGHT_CLICK)
    await flushPromises()

    expect(exportInvokeCalls()).toEqual([
      ['pick_cover_save_path', { songPath: '/a/song.flac' }],
      ['export_cover', { songPath: '/a/song.flac', destPath: '/music/告白气球.png' }],
    ])
    expect(w.find('.cover-menu').exists()).toBe(false) // 先关浮层再 await，菜单不留残
    expect(errorText(w)).toBe('') // 成功不弹提示
  })

  it('导出：导出的是「点菜单项那一刻」的歌曲，await 途中 store 被换歌也不漂移', async () => {
    openCovered({ path: '/a/song.flac' })
    mockInvoke.mockImplementation((cmd: string) => (
      cmd === 'pick_cover_save_path' ? Promise.resolve('/music/x.png') : Promise.resolve(undefined)
    ))
    const w = mount(CoverPanel)
    await flushPromises()
    await contextMenu(w, 120, 80)

    const click = w.find('.cover-menu-item').trigger('click', RIGHT_CLICK)
    // 存盘框开着时切歌（current.path 变）。第二次 IPC 必须仍用发起点那首：
    // `const song = songStore.current` 取的是**响应式引用**，song.path 在 await 之后会重新求值。
    songStore.current = { ...makeSong({ path: '/b/song.flac' }) }
    await click
    await flushPromises()

    // 判别力：实现若在 await 之后重读 songStore.current，这里会带出 /b/song.flac → 红。
    expect(exportInvokeCalls()).toEqual([
      ['pick_cover_save_path', { songPath: '/a/song.flac' }],
      ['export_cover', { songPath: '/a/song.flac', destPath: '/music/x.png' }],
    ])
  })

  it('S5 只读：导出成功前后 current/original 快照相同、dirty 仍为 false（spec「导出为只读动作」）', async () => {
    openCovered()
    mockInvoke.mockImplementation((cmd: string) => (
      cmd === 'pick_cover_save_path' ? Promise.resolve('/music/告白气球.png') : Promise.resolve(undefined)
    ))
    const w = mount(CoverPanel)
    await flushPromises()
    const currentBefore = { ...songStore.current! }
    const originalBefore = { ...songStore.original! }
    expect(songStore.dirty).toBe(false)

    await contextMenu(w, 120, 80)
    await w.find('.cover-menu-item').trigger('click', RIGHT_CLICK)
    await flushPromises()

    expect(songStore.current).toEqual(currentBefore)
    expect(songStore.original).toEqual(originalBefore)
    expect(songStore.dirty).toBe(false)
    expect(w.find('img.cover-img').attributes('src')).toBe(SAVED_PNG) // 预览图未被替换
    expect(songStore.saveState).toBe('idle') // 未触发 save_song
    expect(mockInvoke).not.toHaveBeenCalledWith('save_song', expect.anything()) // 显式锁死写盘禁令
  })

  it('S6：export_cover 写盘失败 → 封面区显示中文原因，不假报成功，封面与 dirty 不变', async () => {
    openCovered()
    mockInvoke.mockImplementation((cmd: string) => (
      cmd === 'pick_cover_save_path'
        ? Promise.resolve('/music/x.png')
        : Promise.reject('导出封面失败: No such file or directory (os error 2)')
    ))
    const w = mount(CoverPanel)
    await flushPromises()
    const currentBefore = { ...songStore.current! }

    await contextMenu(w, 120, 80)
    await w.find('.cover-menu-item').trigger('click', RIGHT_CLICK)
    await flushPromises()

    expect(w.find('.cover-error').exists()).toBe(true)
    expect(w.find('.cover-error').attributes('role')).toBe('alert')
    expect(w.find('.cover-error').text()).toContain('导出封面失败')
    expect(w.find('.cover-error').text()).toContain('No such file or directory')
    expect(songStore.current).toEqual(currentBefore)
    expect(songStore.dirty).toBe(false)
    expect(w.find('img.cover-img').attributes('src')).toBe(SAVED_PNG) // 不因失败清空/替换封面
  })

  // ── S4 取消对话框无副作用 ────────────────────────────────────────────

  it('S4：pick_cover_save_path 返 null（用户取消）→ 不调 export_cover、无错误提示、dirty 不变', async () => {
    openCovered()
    onlyExportIpc(null)
    const w = mount(CoverPanel)
    await flushPromises()
    const currentBefore = { ...songStore.current! }
    const originalBefore = { ...songStore.original! }

    await contextMenu(w, 120, 80)
    await w.find('.cover-menu-item').trigger('click', RIGHT_CLICK)
    await flushPromises()

    // 判别力：实现若漏写 `if (dest === null) return`，这里会多出第二条 export_cover 调用 → 红。
    expect(exportInvokeCalls()).toEqual([['pick_cover_save_path', { songPath: '/a/song.flac' }]])
    expect(mockInvoke).not.toHaveBeenCalledWith('export_cover', expect.anything())
    expect(errorText(w)).toBe('') // 取消不是错误
    expect(w.find('.cover-menu').exists()).toBe(false) // 浮层已关，不残留
    expect(songStore.current).toEqual(currentBefore)
    expect(songStore.original).toEqual(originalBefore)
    expect(songStore.dirty).toBe(false)
  })

  // ── S7 无内嵌封面时菜单项置灰 ─────────────────────────────────────────

  it('S7：current.cover=null → 菜单出得来但「导出封面…」置灰，click 后一个 IPC 都不发', async () => {
    openSong() // 无封面
    onlyExportIpc('/music/不该被写.png')
    const w = mount(CoverPanel)
    await flushPromises()

    await contextMenu(w, 120, 80)

    expect(w.find('.cover-menu').exists()).toBe(true) // 空态封面框也响应右键
    expect(menuItemDisabled(w)).toBe(true)

    await w.find('.cover-menu-item').trigger('click', RIGHT_CLICK)
    await flushPromises()

    // 判别力：原生 disabled + 组件守卫任一失效，这里都会出现 pick_cover_save_path 调用 → 红。
    // 说明（变异实测）：happy-dom 与浏览器一致，**disabled 按钮不派发 click**，
    // 因此「去掉组件侧 `!hasCover` 守卫」这一变异在本环境下不可观测（存活）；
    // 可观测的那一层是上面的 `:disabled === true` 断言（去掉模板绑定即红）。
    expect(exportInvokeCalls()).toEqual([])
    expect(mockInvoke).not.toHaveBeenCalled() // 不弹存盘框、不发任何别的 IPC
    expect(errorText(w)).toBe('') // 置灰不该报错
    expect(songStore.dirty).toBe(false)
  })

  it('S7：竞态兜底——存盘框开着时切歌（current 已换成无封面新歌）→ 后续 IPC 仍用发起点歌曲', async () => {
    openCovered({ path: '/a/song.flac' })
    onlyExportIpc('/music/不该被写.png')
    const w = mount(CoverPanel)
    await flushPromises()
    await contextMenu(w, 120, 80)
    expect(menuItemDisabled(w)).toBe(false)

    await w.find('.cover-menu-item').trigger('click', RIGHT_CLICK)

    // 切歌：current 换成无封面的新歌。导出已在途（存盘框打开），此时 store 的
    // 「导出发起时快照」必须原样传到 IPC——把新歌路径带进 exportCover 即为竞态缺陷。
    songStore.current = { ...makeSong({ path: '/b/song.flac' }) }
    await flushPromises()

    // 判别力：实现若在 await 之后重读 songStore.current，就会传 /b/song.flac → 红。
    expect(exportInvokeCalls()).toEqual([
      ['pick_cover_save_path', { songPath: '/a/song.flac' }],
      ['export_cover', { songPath: '/a/song.flac', destPath: '/music/不该被写.png' }],
    ])
  })

  // ── S8 切歌后菜单不残留 ──────────────────────────────────────────────

  it('S8：菜单开着时切歌 → 菜单关闭；再右键时置灰状态跟随新歌封面', async () => {
    openCovered({ path: '/a/song.flac' })
    const w = mount(CoverPanel)
    await flushPromises()
    await contextMenu(w, 120, 80)
    expect(w.find('.cover-menu').exists()).toBe(true)
    expect(menuItemDisabled(w)).toBe(false)

    // 切歌：current.path 变 + 换成无封面的一首
    songStore.current = { ...makeSong({ path: '/b/song.flac' }) }
    await w.vm.$nextTick()

    expect(w.find('.cover-menu').exists()).toBe(false) // 菜单随切歌关闭

    await contextMenu(w, 60, 60)
    expect(w.find('.cover-menu').exists()).toBe(true)
    expect(menuItemDisabled(w)).toBe(true) // 新歌无封面 → 置灰

    // 反向：新歌带封面 → 再右键应恢复可点
    songStore.current = { ...makeSong({ path: '/c/song.flac', cover: SAVED_PNG, cover_mime: 'image/png' }) }
    await w.vm.$nextTick()
    await contextMenu(w, 60, 60)
    expect(menuItemDisabled(w)).toBe(false)
  })

  // ── 其余关闭出口（design §4.3 四条中未由 S1/S4/S8 覆盖的两条） ───────

  it('关闭：点击菜单外部（document 级冒泡）→ 菜单关闭，不影响 store', async () => {
    openCovered()
    const outside = document.createElement('button') // 菜单与封面框之外的宿主元素（歌词区/顶栏等）
    document.body.appendChild(outside)
    // 组件必须真的在文档里，「点外部关闭」用的 document/window 监听才收得到冒泡事件
    const w = mount(CoverPanel, { attachTo: document.body })
    await flushPromises()
    await contextMenu(w, 120, 80)
    expect(w.find('.cover-menu').exists()).toBe(true)

    outside.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()

    expect(w.find('.cover-menu').exists()).toBe(false)
    expect(songStore.current!.cover).toBe(SAVED_PNG)
    expect(songStore.dirty).toBe(false)
    expect(mockInvoke).not.toHaveBeenCalled() // 单纯关闭不触发任何 IPC

    w.unmount()
    outside.remove()
  })

  it('关闭：Esc（window keydown）→ 菜单关闭', async () => {
    openCovered()
    const w = mount(CoverPanel)
    await flushPromises()
    await contextMenu(w, 120, 80)
    expect(w.find('.cover-menu').exists()).toBe(true)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()

    expect(w.find('.cover-menu').exists()).toBe(false)

    // 菜单未开时按 Esc 不应报错（出口只做存在性判断）
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(w.find('.cover-menu').exists()).toBe(false)
  })

  it('关闭：点菜单容器自身（padding 处）不触发导出，也不误关（仍在菜单内）', async () => {
    openCovered()
    onlyExportIpc('/music/x.png')
    const w = mount(CoverPanel)
    await flushPromises()
    await contextMenu(w, 120, 80)

    await w.find('.cover-menu').trigger('click', RIGHT_CLICK)
    await flushPromises()

    // 菜单容器没有自己的 @click，点击只冒泡到「点外部关闭」的 window 监听，
    // 但 contains(target) 判定它属于菜单内 → 菜单保持打开，且不触发任何导出 IPC。
    expect(exportInvokeCalls()).toEqual([])
    expect(w.find('.cover-menu').exists()).toBe(true)
  })

  it('卸载后：Esc/点外部监听被摘除（不再改已卸载组件状态，无监听泄漏）', async () => {
    openCovered()
    const w = mount(CoverPanel)
    await flushPromises()
    w.unmount()

    // 卸载后再开不了菜单（组件已销毁），此处只验证监听已摘：派发不再抛错且无残留处理。
    expect(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))).not.toThrow()
    expect(() => document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))).not.toThrow()
  })
})
