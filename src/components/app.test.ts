// App 壳集成测试（v1-ux-settings 2.4：SwitchDialog 由 store.pendingAction 驱动，App 级挂载）。
// spec FR-6.3「模态，覆盖全窗口」：pendingAction 非 null → 渲染弹窗；cancel 后消失。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

// mock invoke：App 树内组件（SongList/CoverPanel/EditorBar 等）不发 IPC，保持无副作用挂载。
const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}))

import App from '../App.vue'
import type { Song } from '../api/types'
import { EULA_STORAGE_KEY } from '../store/eula'
import { songStore } from '../store/song'

const makeSong = (over: Partial<Song> = {}): Song => ({
  path: '/a/song.flac',
  title: '歌名',
  artist: '作者',
  album: '',
  album_artist: '',
  track: '1',
  track_total: '',
  year: '',
  genre: '',
  lyrics: '',
  lyrics_source: 'none',
  cover: null,
  cover_mime: null,
  ...over,
})

describe('App — SwitchDialog 挂载（spec: 未保存切歌/换目录 → 全窗口模态弹窗）', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    mockInvoke.mockResolvedValue(undefined)
    songStore.folderPath = null
    songStore.songs = []
    songStore.searchQuery = ''
    songStore.selectedPath = null
    songStore.current = null
    songStore.original = null
    songStore.readonly = false
    songStore.saveState = 'idle'
    songStore.saveError = ''
    songStore.pendingAction = null
    // pre-release-check：默认视为已同意 → EulaDialog 不渲染，避免其 role=dialog 与 SwitchDialog 重复干扰既有断言
    window.localStorage.setItem(EULA_STORAGE_KEY, '1')
  })

  it('pendingAction=null → 不渲染弹窗', () => {
    const w = mount(App)
    expect(w.find('[data-testid="switch-dialog"]').exists()).toBe(false)
  })

  it('dirty 切歌（pendingAction 非 null）→ 渲染 SwitchDialog 模态', () => {
    songStore.current = { ...makeSong() }
    songStore.original = { ...makeSong() }
    songStore.current!.title = '改过'
    songStore.selectedPath = '/a/song.flac'
    songStore.pendingAction = {
      kind: 'switch',
      path: '/a/next.flac',
      loadSong: async () => makeSong({ path: '/a/next.flac' }),
    }

    const w = mount(App)
    const dialog = w.get('[role="dialog"]')
    expect(dialog.attributes('aria-modal')).toBe('true')
    expect(w.text()).toContain('保存对')
  })

  it('cancelPending 后 → 弹窗消失（v-if 由 pendingAction 驱动）', async () => {
    songStore.current = { ...makeSong() }
    songStore.original = { ...makeSong() }
    songStore.current!.title = '改过'
    songStore.selectedPath = '/a/song.flac'
    songStore.pendingAction = { kind: 'switch', path: '/a/next.flac', loadSong: async () => makeSong() }

    const w = mount(App)
    expect(w.find('[data-testid="switch-dialog"]').exists()).toBe(true)

    // 限定弹窗内的「取消」（整树存在 EditorBar 的 ghost 撤销按钮，避免误命中）
    const dialog = w.get('[data-testid="switch-dialog"]')
    await dialog.get('button.btn-ghost').trigger('click')
    expect(songStore.pendingAction).toBeNull()
    expect(w.find('[data-testid="switch-dialog"]').exists()).toBe(false)
  })
})

describe('App — 端到端冒烟：列表→编辑→脏切歌弹窗→保存→切歌（v1-ux-settings 核心链路）', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    songStore.folderPath = '/a'
    songStore.songs = [
      { path: '/a/one.flac', title: 'One', artist: 'A' },
      { path: '/a/two.flac', title: 'Two', artist: 'B' },
    ]
    songStore.searchQuery = ''
    songStore.selectedPath = '/a/one.flac'
    songStore.current = { ...makeSong('/a/one.flac') }
    songStore.original = { ...makeSong('/a/one.flac') }
    songStore.readonly = false
    songStore.saveState = 'idle'
    songStore.saveError = ''
    songStore.pendingAction = null
    // pre-release-check：已同意 → EulaDialog 不渲染，避免其 role=dialog 干扰 SwitchDialog 断言
    window.localStorage.setItem(EULA_STORAGE_KEY, '1')
  })

  it('dirty 编辑态点其它行 → 弹窗出现 → 点「保存」→ 保存后关闭弹窗并切到目标歌', async () => {
    mockInvoke.mockImplementation(async (cmd: string, args: unknown) => {
      if (cmd === 'open_song') {
        return makeSong({ path: (args as { path: string }).path, title: '第二首' })
      }
      if (cmd === 'save_song') return undefined
      throw new Error(`unexpected cmd: ${cmd}`)
    })

    songStore.current!.title = '改过' // 制造 dirty
    const w = mount(App)

    // 点击第二首 → dirty 拦截门 → 弹窗出现（未切歌）
    await w.findAll('.song-row')[1].trigger('click')
    expect(w.find('[data-testid="switch-dialog"]').exists()).toBe(true)
    expect(w.text()).toContain('保存对')
    expect(songStore.selectedPath).toBe('/a/one.flac') // 未切歌、编辑保留

    // 点「保存」→ save_song 写盘成功 → 关闭弹窗、切到第二首
    const dialog = w.get('[data-testid="switch-dialog"]')
    await dialog.get('button.btn-primary').trigger('click')
    await flushPromises()

    expect(songStore.pendingAction).toBeNull()
    expect(w.find('[data-testid="switch-dialog"]').exists()).toBe(false)
    expect(songStore.selectedPath).toBe('/a/two.flac')
    expect(songStore.current?.title).toBe('第二首')
    expect(songStore.dirty).toBe(false)
  })

  it('dirty 编辑态点其它行 → 点「不保存」→ 丢弃编辑直接切歌、弹窗关闭', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'open_song') return makeSong({ path: '/a/two.flac', title: '第二首' })
      throw new Error(`unexpected cmd: ${cmd}`)
    })

    songStore.current!.title = '改过'
    const w = mount(App)
    await w.findAll('.song-row')[1].trigger('click')
    expect(w.find('[data-testid="switch-dialog"]').exists()).toBe(true)

    const dialog = w.get('[data-testid="switch-dialog"]')
    await dialog.get('button.btn-danger').trigger('click')
    await flushPromises()

    expect(songStore.pendingAction).toBeNull()
    expect(w.find('[data-testid="switch-dialog"]').exists()).toBe(false)
    expect(songStore.selectedPath).toBe('/a/two.flac')
    expect(songStore.current?.title).toBe('第二首') // 已切歌，编辑丢弃
    expect(mockInvoke).not.toHaveBeenCalledWith('save_song') // 未写盘
  })

  it('干净态点其它行 → 不弹窗直接切（spec「无修改直接切」端到端）', async () => {
    mockInvoke.mockImplementation(async (cmd: string, args: unknown) => {
      if (cmd === 'open_song') {
        return makeSong({ path: (args as { path: string }).path, title: '第二首' })
      }
      throw new Error(`unexpected cmd: ${cmd}`)
    })

    const w = mount(App)
    await w.findAll('.song-row')[1].trigger('click')
    await flushPromises()

    expect(w.find('[data-testid="switch-dialog"]').exists()).toBe(false) // 不弹窗
    expect(songStore.selectedPath).toBe('/a/two.flac') // 直接切
    expect(songStore.current?.title).toBe('第二首')
  })
})

describe('App — EulaDialog 授权门禁（pre-release-check：首次启动弹授权、同意后关遮罩）', () => {
  beforeEach(() => {
    window.localStorage.removeItem(EULA_STORAGE_KEY) // 默认未同意 → 弹授权
    mockInvoke.mockReset()
    mockInvoke.mockResolvedValue(undefined)
    songStore.folderPath = null
    songStore.songs = []
    songStore.searchQuery = ''
    songStore.selectedPath = null
    songStore.current = null
    songStore.original = null
    songStore.readonly = false
    songStore.saveState = 'idle'
    songStore.saveError = ''
    songStore.pendingAction = null
  })

  // CR(pre-release-check)：overlay 只拦指针不拦键盘——遮罩期间 `.app` 内主界面兄弟节点须 `inert`（键盘+指针均不可交互）
  const mainSiblingsOf = (w: ReturnType<typeof mount<typeof App>>) => {
    const overlay = w.get('[data-testid="eula-dialog"]').element.parentElement! // div.overlay，`.app` 直属子节点
    return Array.from(w.get('.app').element.children).filter(
      (el) => el !== overlay && el.nodeType === 1,
    )
  }

  it('默认未同意 → EulaDialog 全窗口模态遮罩存在（主界面不可交互，spec 场景）', () => {
    const w = mount(App)
    const dialog = w.get('[data-testid="eula-dialog"]')
    expect(dialog.attributes('role')).toBe('dialog')
    expect(dialog.attributes('aria-modal')).toBe('true')

    // 主界面（AppBar/workspace 等 `.app` 内除遮罩外的兄弟）置 inert——Tab 不可聚焦到下方控件
    const siblings = mainSiblingsOf(w)
    expect(siblings.length).toBeGreaterThan(0)
    for (const el of siblings) expect(el.hasAttribute('inert')).toBe(true)
  })

  it('已同意（localStorage=\'1\'）→ EulaDialog 不渲染（二次启动不弹窗，spec 场景）', () => {
    window.localStorage.setItem(EULA_STORAGE_KEY, '1')
    const w = mount(App)
    expect(w.find('[data-testid="eula-dialog"]').exists()).toBe(false)
    // 不弹窗 → 不残留 inert（主界面正常可交互）
    const siblings = Array.from(w.get('.app').element.children).filter((el) => el.nodeType === 1)
    for (const el of siblings) expect(el.hasAttribute('inert')).toBe(false)
  })

  it('点「同意并继续」→ 写 localStorage + 遮罩消失（进入主界面）', async () => {
    const w = mount(App)
    expect(w.find('[data-testid="eula-dialog"]').exists()).toBe(true)
    const siblings = mainSiblingsOf(w)
    expect(siblings[0].hasAttribute('inert')).toBe(true)

    const acceptBtn = w.findAll('button').find((b) => b.text() === '同意并继续')!
    await acceptBtn.trigger('click')

    expect(window.localStorage.getItem(EULA_STORAGE_KEY)).toBe('1')
    expect(w.find('[data-testid="eula-dialog"]').exists()).toBe(false)
    // 关闭后 inert 移除——主界面恢复可交互
    for (const el of siblings) expect(el.hasAttribute('inert')).toBe(false)
  })
})
