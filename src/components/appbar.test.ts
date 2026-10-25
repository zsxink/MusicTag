// AppBar 主题按钮组件测试（v1-ux-settings D8：图标 = 目标主题，点击调 setTheme）。
// 注入 theme store 桩环境（仿 store/theme.test.ts），不触碰真实 DOM。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'

import { initTheme, themeStore } from '../store/theme'
import { updatesStore, restoreUpdateNotice } from '../store/updates'
import { songStore } from '../store/song'
import type { ThemeEnv } from '../store/theme'
import AppBar from './AppBar.vue'
import SongList from './SongList.vue'

enableAutoUnmount(afterEach)

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn(async () => undefined) }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => vi.fn()) }))

/** 构造主题 store 测试环境桩（localStorage + matchMedia 轻量替身）。 */
function makeEnv(opts: { stored?: string | null; systemLight?: boolean } = {}): ThemeEnv {
  const { stored = null, systemLight = false } = opts
  let storedValue: string | null = stored
  let systemLightNow = systemLight
  return {
    readChoice: () => storedValue,
    writeChoice: (c) => {
      storedValue = c
    },
    systemPrefersLight: () => systemLightNow,
    onSystemChange: () => () => {
      /* no-op */
    },
    applyDataTheme: () => {
      /* no-op */
    },
  }
}

describe('AppBar — 主题按钮（spec: 顶栏最右主题按钮手动切换 ☀️/🌙，图标 = 目标主题）', () => {
  beforeEach(() => {
    initTheme(makeEnv()) // 干净状态：无手动选择、系统深色 → effective=dark
    mockInvoke.mockReset()
    songStore.folderPath = null
    songStore.songs = []
    songStore.selectedPath = null
    songStore.current = null
    songStore.original = null
    songStore.pendingAction = null
    songStore.saveState = 'idle'
    songStore.readonly = false
  })

  const themeBtn = (w: ReturnType<typeof mount>) => w.get('button.theme-btn')

  it('提供带无障碍名称和悬停提示的紧凑文件夹图标入口，不展示当前路径', () => {
    const w = mount(AppBar)
    const folderButton = w.get('button.open-folder-btn')
    expect(w.findAll('button.open-folder-btn')).toHaveLength(1)
    expect(folderButton.attributes('aria-label')).toBe('打开文件夹')
    expect(folderButton.attributes('title')).toBe('打开文件夹')
    expect(folderButton.find('svg[aria-hidden="true"]').exists()).toBe(true)
    expect(folderButton.text()).toBe('')
    expect(w.text()).not.toContain('路径:')
    expect(w.text()).not.toContain('/Users/')
  })

  it('选中目录后经现有目录转场加载歌曲', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'pick_folder') return '/new/dir'
      if (cmd === 'list_songs') return [{ path: '/new/dir/a.flac', title: 'A', artist: 'AA' }]
      if (cmd === 'watch_folder') return undefined
      return undefined
    })
    const w = mount(AppBar)
    await w.get('button.open-folder-btn').trigger('click')
    await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('list_songs', { dir: '/new/dir' }))
  })

  it('取消选择时不更改当前目录', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => cmd === 'pick_folder' ? null : undefined)
    const w = mount(AppBar)
    await w.get('button.open-folder-btn').trigger('click')
    await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('pick_folder', undefined))
    expect(mockInvoke).not.toHaveBeenCalledWith('list_songs', expect.anything())
  })

  it.each([
    ['⌘O', { metaKey: true }],
    ['Ctrl+O', { ctrlKey: true }],
  ] as const)('%s 快捷键打开文件夹选择器', async (_label, modifiers) => {
    mockInvoke.mockImplementation(async (cmd: string) => cmd === 'pick_folder' ? null : undefined)
    const w = mount(AppBar)
    const event = new KeyboardEvent('keydown', { key: 'o', ...modifiers, cancelable: true })
    window.dispatchEvent(event)
    await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('pick_folder', undefined))
    expect(mockInvoke).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
    w.unmount()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', ...modifiers, cancelable: true }))
    expect(mockInvoke).toHaveBeenCalledTimes(1)
  })

  it('选择器抛错后在歌曲列表中显示文件夹错误', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'pick_folder') throw new Error('dialog unavailable')
      return undefined
    })
    const list = mount(SongList)
    const bar = mount(AppBar)
    await bar.get('button.open-folder-btn').trigger('click')
    await vi.waitFor(() => expect(list.get('[role="status"]').text()).toContain('打开文件夹失败：dialog unavailable'))
    expect(songStore.folderRefreshError).toBe('打开文件夹失败：dialog unavailable')
    bar.unmount()
    list.unmount()
  })

  it('存在未保存修改时仍经过目录切换拦截门', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => cmd === 'pick_folder' ? '/new/dir' : undefined)
    songStore.folderPath = '/old'
    songStore.selectedPath = '/old/a.flac'
    songStore.current = { path: '/old/a.flac', title: '改过', artist: '', album: '', album_artist: '', track: '', track_total: '', year: '', genre: '', lyrics: '', lyrics_source: 'none', cover: null, cover_mime: null }
    songStore.original = { ...songStore.current, title: '原始' }
    songStore.readonly = false
    songStore.saveState = 'idle'
    songStore.pendingAction = null
    const w = mount(AppBar)
    await w.get('button.open-folder-btn').trigger('click')
    await vi.waitFor(() => expect(songStore.pendingAction).toMatchObject({ kind: 'folder', dir: '/new/dir' }))
    expect(songStore.folderPath).toBe('/old')
    expect(mockInvoke).not.toHaveBeenCalledWith('list_songs', { dir: '/new/dir' })
    songStore.pendingAction = null
  })

  it('effective=dark → 显示 ☀️（图标指向目标主题：点击后去浅色）', () => {
    expect(themeStore.effective).toBe('dark')
    const w = mount(AppBar)
    expect(themeBtn(w).text()).toBe('☀️')
    expect(themeBtn(w).attributes('aria-label')).toBe('切换到浅色')
  })

  it('effective=light → 显示 🌙（点击后去深色）', () => {
    initTheme(makeEnv({ stored: 'light' }))
    expect(themeStore.effective).toBe('light')
    const w = mount(AppBar)
    expect(themeBtn(w).text()).toBe('🌙')
    expect(themeBtn(w).attributes('aria-label')).toBe('切换到深色')
  })

  it('可用更新显示品牌与路径之间的无障碍红点，并可恢复提示', async () => {
    Object.assign(updatesStore, {
      status: 'update-available',
      recentOutcome: { result: { current_version: '0.1.3', latest_version: '0.2.0', update_available: true, release_url: 'https://example.com' }, error: null },
      dismissedVersion: '0.2.0',
      noticeVisible: false,
    })
    const w = mount(AppBar)
    const indicator = w.get('button.update-indicator')
    expect(indicator.attributes('aria-label')).toBe('有可用更新，重新显示更新提示')
    expect(indicator.attributes('title')).toBe('重新显示更新提示')
    expect(indicator.text()).toBe('')
    expect(w.find('.brand').element.nextElementSibling).toBe(indicator.element)
    await indicator.trigger('click')
    expect(updatesStore.noticeVisible).toBe(true)
    restoreUpdateNotice()
  })

  it('没有可用更新时隐藏更新标记', () => {
    Object.assign(updatesStore, {
      status: 'up-to-date',
      recentOutcome: { result: { current_version: '0.2.1', latest_version: '0.2.1', update_available: false, release_url: 'https://example.com' }, error: null },
      dismissedVersion: null,
      noticeVisible: false,
    })
    const w = mount(AppBar)
    expect(w.find('button.update-indicator').exists()).toBe(false)
  })

  it('点击主题按钮 → setTheme 在深浅间切换，图标跟随 effective', async () => {
    const w = mount(AppBar)
    expect(themeBtn(w).text()).toBe('☀️')

    await themeBtn(w).trigger('click')
    expect(themeStore.effective).toBe('light') // 手动切到浅色
    expect(themeBtn(w).text()).toBe('🌙') // 图标翻转

    await themeBtn(w).trigger('click')
    expect(themeStore.effective).toBe('dark') // 再点回深色
    expect(themeBtn(w).text()).toBe('☀️')
  })
})
