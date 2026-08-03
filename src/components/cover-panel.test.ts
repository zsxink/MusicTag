import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'

// mock @tauri-apps/api/core.invoke → CoverPanel 经 api/songs.ts 的 pickCoverFile/readCoverPath
// 走 mock IPC（api/client.ts 必须保留 `import { invoke } from '@tauri-apps/api/core'`，改源失效）。
const mockInvoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
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

/** 打开一首歌进 store（等价 open() 成功态）。 */
function openSong(song: Song = makeSong()): void {
  songStore.current = { ...song }
  songStore.original = { ...song }
  songStore.readonly = false
  songStore.lyricsSource = song.lyrics_source
  songStore.selectedPath = song.path
  songStore.saveState = 'idle'
  songStore.saveError = ''
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
