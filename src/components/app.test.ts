// App 壳集成测试（v1-ux-settings 2.4：SwitchDialog 由 store.pendingAction 驱动，App 级挂载）。
// spec FR-6.3「模态，覆盖全窗口」：pendingAction 非 null → 渲染弹窗；cancel 后消失。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

// mock invoke：App 树内组件（SongList/CoverPanel/EditorBar 等）不发 IPC，保持无副作用挂载。
const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}))

import App from '../App.vue'
import type { Song } from '../api/types'
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
