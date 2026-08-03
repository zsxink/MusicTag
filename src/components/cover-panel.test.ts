import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

// mock @tauri-apps/api/core.invoke → CoverPanel 经 api/songs.ts 的 pickCoverFile/readCoverPath
// 走 mock IPC（api/client.ts 必须保留 `import { invoke } from '@tauri-apps/api/core'`，改源失效）。
const mockInvoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

// mock @tauri-apps/api/window → getCurrentWindow().onDragDropEvent 捕获 handler + 返回 fake unlisten
// （v1-cover-embed D4：拖拽用 Tauri 原生 drag-drop，非 WebView FileReader）。
const { dragHandler, unlisten } = vi.hoisted(() => {
  let handler: ((e: { payload: { type: string; paths?: string[] } }) => void) | undefined
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
    onDragDropEvent: vi.fn(async (h: (e: { payload: { type: string; paths?: string[] } }) => void) => {
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

describe('CoverPanel — 拖拽嵌入（v1-cover-embed D4，Tauri 原生 drag-drop）', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    unlisten.mockClear()
    dragHandler.set(undefined)
    openSong()
  })

  it('onMounted 订阅 getCurrentWindow().onDragDropEvent；drop 取 paths[0] → readCoverPath → setCover', async () => {
    mockInvoke.mockResolvedValue(cover)
    const w = mount(CoverPanel)
    await flushPromises() // 等 onMounted 异步订阅完成，handler 被捕获

    const handler = dragHandler.get()!
    handler({ payload: { type: 'enter', paths: ['/tmp/cover.png'] } })
    await flushPromises()
    expect(w.find('.cover-box').classes()).toContain('dragging')

    handler({ payload: { type: 'drop', paths: ['/tmp/cover.png'] } })
    await flushPromises()

    expect(mockInvoke).toHaveBeenCalledWith('read_cover_path', { path: '/tmp/cover.png' })
    expect(songStore.current!.cover).toBe('data:image/png;base64,AAAA')
    expect(songStore.dirty).toBe(true)
    expect(w.find('.cover-box').classes()).not.toContain('dragging') // drop 后复位
  })

  it('leave（取消拖拽）→ 复位 dragging 高亮', async () => {
    const w = mount(CoverPanel)
    await flushPromises()
    const handler = dragHandler.get()!
    handler({ payload: { type: 'enter', paths: ['/a.png'] } })
    await flushPromises()
    expect(w.find('.cover-box').classes()).toContain('dragging')
    handler({ payload: { type: 'leave' } })
    await flushPromises()
    expect(w.find('.cover-box').classes()).not.toContain('dragging')
  })

  it('拖拽非图片文件（readCoverPath reject）→ 不污染封面、显示错误提示', async () => {
    mockInvoke.mockRejectedValue(new Error('封面格式无法识别'))
    const w = mount(CoverPanel)
    await flushPromises()
    const handler = dragHandler.get()!
    handler({ payload: { type: 'drop', paths: ['/tmp/not_image.txt'] } })
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
    handler({ payload: { type: 'enter', paths: ['/a.png'] } })
    await flushPromises()
    expect(w.find('.cover-box').classes()).not.toContain('dragging') // 只读不高亮
    handler({ payload: { type: 'drop', paths: ['/a.png'] } })
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
