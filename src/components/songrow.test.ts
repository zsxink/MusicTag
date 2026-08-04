// SongRow 组件测试（v1-ux-settings 2.3 补充）：select() 走 requestSwitch dirty 拦截门。
// 用户主路径「点击歌曲行」必须真正到达拦截门——否则若回归为直连 selectSong，
// 「有未保存修改时切歌弹三选一」的用户入口即失效，而 store 单测仍全绿（测不到接线）。
// 本测试锁接线：干净态点击直接切歌；dirty 态点击其它行 → pendingAction（弹窗触发）；
// dirty 态点击已选中行 → no-op（不弹窗、不重读、不丢编辑）。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

// mock invoke：SongRow 经 api/songs.ts 的 openSong（invoke('open_song'))，干净态点击才发 IPC。
const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}))

import type { Song, SongSummary } from '../api/types'
import { songStore } from '../store/song'
import SongRow from './SongRow.vue'

const makeSong = (path: string, title = '歌名'): Song => ({
  path,
  title,
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
})

const makeSummary = (path: string): SongSummary => ({ path, title: '歌名', artist: '作者' })

/** 构造 dirty 编辑态：当前打开 one.flac 且已改标题。 */
function setupDirty(): void {
  songStore.selectedPath = '/a/one.flac'
  songStore.current = { ...makeSong('/a/one.flac') }
  songStore.original = { ...makeSong('/a/one.flac') }
  songStore.current!.title = '改过'
  songStore.readonly = false
  songStore.saveState = 'idle'
  songStore.saveError = ''
  songStore.pendingAction = null
}

beforeEach(() => {
  mockInvoke.mockReset()
  songStore.selectedPath = null
  songStore.current = null
  songStore.original = null
  songStore.readonly = false
  songStore.saveState = 'idle'
  songStore.saveError = ''
  songStore.pendingAction = null
})

describe('SongRow — select 走 dirty 拦截门（spec: 无修改直接切 / 有修改弹三选一）', () => {
  it('干净态点击行 → 直接切歌并 open_song 读全量，不弹窗（spec「无修改直接切」）', async () => {
    mockInvoke.mockImplementation(async (cmd: string, args: unknown) => {
      if (cmd === 'open_song') return makeSong((args as { path: string }).path, '第二首')
      // 选中行触发 autoSearch（v1-search-ui D1）：补 search_song 返回（不阻塞选中）
      if (cmd === 'search_song') {
        return { songs: [], source_stats: [['netease', 0], ['qqmusic', 0], ['kugou', 0], ['lrclib', 0], ['itunes', 0]], all_failed: false }
      }
      throw new Error(`unexpected cmd: ${cmd}`)
    })

    const w = mount(SongRow, { props: { song: makeSummary('/a/two.flac') } })
    await w.get('.song-row').trigger('click')
    await flushPromises()

    expect(songStore.pendingAction).toBeNull() // 不弹窗
    expect(songStore.selectedPath).toBe('/a/two.flac') // 直接切换
    expect(songStore.current?.title).toBe('第二首')
    expect(mockInvoke).toHaveBeenCalledWith('open_song', { path: '/a/two.flac' })
  })

  it('dirty 态点击其它行 → 进入 pending（弹窗触发），不立即切歌、编辑保留', async () => {
    setupDirty()
    mockInvoke.mockResolvedValue(undefined)

    const w = mount(SongRow, { props: { song: makeSummary('/a/two.flac') } })
    await w.get('.song-row').trigger('click')
    await flushPromises()

    expect(songStore.pendingAction).toMatchObject({ kind: 'switch', path: '/a/two.flac' })
    expect(songStore.selectedPath).toBe('/a/one.flac') // 未切歌
    expect(songStore.current?.title).toBe('改过') // 编辑保留
    expect(mockInvoke).not.toHaveBeenCalled() // 未触发 open_song
  })

  it('dirty 态点击已选中行 → no-op：不弹窗、不重读、不丢编辑', async () => {
    setupDirty()
    mockInvoke.mockResolvedValue(undefined)

    const w = mount(SongRow, { props: { song: makeSummary('/a/one.flac') } })
    await w.get('.song-row').trigger('click')
    await flushPromises()

    expect(songStore.pendingAction).toBeNull() // 不弹窗（同 mockup onRowClick）
    expect(songStore.current?.title).toBe('改过') // 不重读不丢编辑
    expect(mockInvoke).not.toHaveBeenCalled()
  })
})
