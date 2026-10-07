// App 壳集成测试（v1-ux-settings 2.4：SwitchDialog 由 store.pendingAction 驱动，App 级挂载）。
// spec FR-6.3「模态，覆盖全窗口」：pendingAction 非 null → 渲染弹窗；cancel 后消失。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'

// mock invoke：App 树内组件（SongList/CoverPanel/EditorBar 等）不发 IPC，保持无副作用挂载。
const { mockInvoke, mockListen, mockGetVersion } = vi.hoisted(() => ({ mockInvoke: vi.fn(), mockListen: vi.fn(), mockGetVersion: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: mockListen }))
vi.mock('@tauri-apps/api/app', () => ({ getVersion: mockGetVersion }))

import App from '../App.vue'
import type { Song } from '../api/types'
import { EULA_STORAGE_KEY } from '../store/eula'
import { songStore } from '../store/song'
import { DISMISSED_UPDATE_STORAGE_KEY, updatesStore } from '../store/updates'
import type { UpdateCheckResult } from '../api/updates'

enableAutoUnmount(afterEach)
beforeEach(() => {
  mockListen.mockReset().mockResolvedValue(vi.fn())
  mockGetVersion.mockReset().mockResolvedValue('0.1.3')
  window.localStorage.removeItem(DISMISSED_UPDATE_STORAGE_KEY)
  Object.assign(updatesStore, { status: 'idle', currentVersion: '', recentOutcome: null, recentCheckOrigin: null, dismissedVersion: null, noticeVisible: false, openingDetails: false, detailError: '' })
})

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

describe('App — 启动检查与原生更新菜单', () => {
  const release: UpdateCheckResult = {
    current_version: '0.1.3', latest_version: '0.2.0', update_available: true,
    release_url: 'https://github.com/zsxink/MusicTag/releases/tag/v0.2.0',
  }
  const menuHandler = () => mockListen.mock.calls.find(([event]) => event === 'update-menu-action')![1] as (event: { payload: string }) => void
  beforeEach(() => {
    window.localStorage.setItem(EULA_STORAGE_KEY, '1')
    mockInvoke.mockReset().mockImplementation(async (command: string) => {
      if (command === 'check_for_update') return release
      if (command === 'list_songs') return [...songStore.songs]
      if (command === 'get_last_dir') return null
      return undefined
    })
    songStore.folderPath = '/a'
    songStore.songs = [{ path: '/a/song.flac', title: '歌名', artist: '作者' }]
    songStore.searchQuery = ''
    songStore.selectedPath = '/a/song.flac'
    songStore.current = makeSong()
    songStore.original = makeSong()
    songStore.readonly = false
    songStore.saveState = 'idle'
    songStore.saveError = ''
    songStore.pendingAction = null
  })

  it('启动发起一次异步检查；等待或显示更新期间仍可编辑、不自动打开浏览器', async () => {
    let resolve!: (result: UpdateCheckResult) => void
    mockInvoke.mockImplementation((command: string) => {
      if (command === 'check_for_update') return new Promise((done) => { resolve = done })
      if (command === 'list_songs') return Promise.resolve([...songStore.songs])
      return Promise.resolve(undefined)
    })
    const w = mount(App, { attachTo: document.body })
    expect(mockInvoke.mock.calls.filter(([command]) => command === 'check_for_update')).toHaveLength(1)
    expect(w.find('.workspace').exists()).toBe(true)
    await nextTick()
    expect(w.text()).toContain('正在检查更新…')
    const input = w.findAll('.field').find((field) => field.get('.field-label').text() === '歌名')!.get('input')
    ;(input.element as HTMLInputElement).focus()
    await input.setValue('检查中仍可编辑')
    expect(songStore.current?.title).toBe('检查中仍可编辑')
    resolve(release)
    await flushPromises()
    expect(w.text()).toContain('发现新版本 0.2.0')
    expect(document.activeElement).toBe(input.element)
    expect(w.get('.workspace').attributes('inert')).toBeUndefined()
    await input.setValue('提示期间仍可编辑')
    expect(songStore.current?.title).toBe('提示期间仍可编辑')
    expect(mockInvoke.mock.calls.some(([command]) => command === 'open_release_page')).toBe(false)
  })

  it('原生菜单触发手动检查和关于界面；卸载释放订阅且不再处理动作', async () => {
    const stop = vi.fn()
    mockListen.mockImplementation(async (event: string) => event === 'update-menu-action' ? stop : vi.fn())
    const w = mount(App)
    await flushPromises()
    expect(w.find('[data-testid="about-dialog"]').exists()).toBe(false)
    const handler = menuHandler()
    handler({ payload: 'show-about' })
    await nextTick()
    const about = w.get('[data-testid="about-dialog"]')
    expect(about.text()).toContain('当前版本：0.1.3')
    expect(about.text()).toContain('最近检查：发现新版本 0.2.0')
    await about.get('button').trigger('click')
    expect(w.find('[data-testid="about-dialog"]').exists()).toBe(false)
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === 'check_for_update') return { ...release, update_available: false }
      if (command === 'list_songs') return [...songStore.songs]
      return undefined
    })
    handler({ payload: 'check-for-update' })
    expect(updatesStore.status).toBe('checking')
    await flushPromises()
    expect(w.text()).toContain('已是最新版本')
    expect(mockInvoke.mock.calls.filter(([command]) => command === 'check_for_update')).toHaveLength(2)
    w.unmount()
    expect(stop).toHaveBeenCalledOnce()
    handler({ payload: 'check-for-update' })
    expect(mockInvoke.mock.calls.filter(([command]) => command === 'check_for_update')).toHaveLength(2)
  })

  it('订阅晚于卸载完成仍立即释放监听', async () => {
    let resolve!: (stop: () => void) => void
    mockListen.mockImplementation((event: string) => event === 'update-menu-action'
      ? new Promise((done) => { resolve = done }) : Promise.resolve(vi.fn()))
    const w = mount(App)
    w.unmount()
    const stop = vi.fn()
    resolve(stop)
    await flushPromises()
    expect(stop).toHaveBeenCalledOnce()
  })

  it('同版稍后后原生菜单手动检查仍显示结果，抑制重复更新操作', async () => {
    const w = mount(App)
    await flushPromises()
    const toast = w.get('[data-testid="update-toast"]')
    await toast.findAll('button').find((button) => button.text() === '稍后')!.trigger('click')
    expect(w.find('[data-testid="update-toast"]').exists()).toBe(false)
    menuHandler()({ payload: 'check-for-update' })
    await flushPromises()
    const resultNotice = w.get('[data-testid="update-toast"]')
    expect(resultNotice.text()).toContain('发现新版本 0.2.0')
    expect(resultNotice.findAll('button').map((button) => button.text())).toEqual(['查看详情', '关闭'])
    expect(updatesStore.recentCheckOrigin).toBe('manual')
    await resultNotice.findAll('button')[0].trigger('click')
    await flushPromises()
    expect(mockInvoke).toHaveBeenCalledWith('open_release_page', { url: release.release_url })
    expect(window.localStorage.getItem(DISMISSED_UPDATE_STORAGE_KEY)).toBe('0.2.0')
  })

  it('未同意 EULA 时关于菜单不挂载隐藏对话框、不移走协议焦点；同意后可打开', async () => {
    window.localStorage.removeItem(EULA_STORAGE_KEY)
    const w = mount(App, { attachTo: document.body })
    await flushPromises()
    const accept = w.get('[data-testid="eula-dialog"]').findAll('button').find((button) => button.text() === '同意并继续')!
    expect(document.activeElement).toBe(accept.element)
    menuHandler()({ payload: 'show-about' })
    await nextTick()
    expect(w.find('[data-testid="about-dialog"]').exists()).toBe(false)
    expect(document.activeElement).toBe(accept.element)
    expect(w.get('.workspace').attributes('inert')).toBe('')
    await accept.trigger('click')
    menuHandler()({ payload: 'show-about' })
    await nextTick()
    expect(w.find('[data-testid="eula-dialog"]').exists()).toBe(false)
    const about = w.get('[data-testid="about-dialog"]')
    expect(document.activeElement).toBe(about.get('button').element)
  })

  it('启动失败在提示和关于界面显示错误，工作区保留', async () => {
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === 'check_for_update') throw '网络请求失败'
      if (command === 'list_songs') return [...songStore.songs]
      return undefined
    })
    const w = mount(App)
    await flushPromises()
    expect(w.get('[data-testid="update-toast"]').text()).toContain('检查更新失败：网络请求失败')
    menuHandler()({ payload: 'show-about' })
    await nextTick()
    expect(w.get('[data-testid="about-dialog"]').text()).toContain('当前版本：0.1.3')
    expect(w.get('[data-testid="about-dialog"]').text()).toContain('网络请求失败')
    expect(w.find('[data-testid="editor"]').exists()).toBe(true)
  })
})
