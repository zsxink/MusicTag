import { beforeEach, describe, expect, it, vi } from 'vitest'

// mock @tauri-apps/api/core.invoke，验证 songs.ts 类型化封装逐字透传 command 名与参数
// （api/client.ts 必须保留 `import { invoke } from '@tauri-apps/api/core'`，改源会静默失效 mock）。
const mockInvoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

import type { Song } from './types'
import { listSongs, openSong, pickFolder, saveSong } from './songs'

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

describe('api/songs.ts — 类型化 command 封装（命令名/参数逐字对齐 Rust 契约）', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
  })

  it('pickFolder：透传 pick_folder 无参数；取消返回 null', async () => {
    mockInvoke.mockResolvedValue('/music')
    await expect(pickFolder()).resolves.toBe('/music')
    expect(mockInvoke).toHaveBeenCalledWith('pick_folder', undefined)

    mockInvoke.mockResolvedValue(null)
    await expect(pickFolder()).resolves.toBeNull()
  })

  it('listSongs：透传 list_songs + { dir }', async () => {
    const songs = [{ path: '/m/a.flac', title: 'A', artist: 'AA' }]
    mockInvoke.mockResolvedValue(songs)
    await expect(listSongs('/music')).resolves.toEqual(songs)
    expect(mockInvoke).toHaveBeenCalledWith('list_songs', { dir: '/music' })
  })

  it('openSong：透传 open_song + { path }，返回完整 Song', async () => {
    const song = makeSong()
    mockInvoke.mockResolvedValue(song)
    await expect(openSong('/a/song.flac')).resolves.toEqual(song)
    expect(mockInvoke).toHaveBeenCalledWith('open_song', { path: '/a/song.flac' })
  })

  it('saveSong：透传 save_song + { song } 整个 current 对象', async () => {
    const song = makeSong({ title: '改过' })
    mockInvoke.mockResolvedValue(undefined)
    await saveSong(song)
    expect(mockInvoke).toHaveBeenCalledWith('save_song', { song })
  })
})
