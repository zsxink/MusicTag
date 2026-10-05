import { beforeEach, describe, expect, it, vi } from 'vitest'

// mock @tauri-apps/api/core.invoke，验证 songs.ts 类型化封装逐字透传 command 名与参数
// （api/client.ts 必须保留 `import { invoke } from '@tauri-apps/api/core'`，改源会静默失效 mock）。
const mockInvoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

import type { CoverInput, MissingScanResult, Song } from './types'
import {
  exportCover,
  getLastDir,
  listSongs,
  openSong,
  pickCoverFile,
  pickCoverSavePath,
  pickFolder,
  readCoverPath,
  renameSong,
  saveLastDir,
  saveSong,
  scanMissing,
} from './songs'

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

  it('getLastDir：透传 get_last_dir 无参数；有记忆返回目录、无记忆/目录已删返回 null', async () => {
    mockInvoke.mockResolvedValue('/music')
    await expect(getLastDir()).resolves.toBe('/music')
    expect(mockInvoke).toHaveBeenCalledWith('get_last_dir', undefined)

    mockInvoke.mockResolvedValue(null)
    await expect(getLastDir()).resolves.toBeNull()
  })

  it('saveLastDir：透传 save_last_dir + { dir }（fire-and-forget，返回 void）', async () => {
    mockInvoke.mockResolvedValue(undefined)
    await expect(saveLastDir('/music')).resolves.toBeUndefined()
    expect(mockInvoke).toHaveBeenCalledWith('save_last_dir', { dir: '/music' })
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

  it('saveSong：透传 save_song + { song, exportLrc } 整个 current 对象（design.md D3 扩参）', async () => {
    const song = makeSong({ title: '改过' })
    mockInvoke.mockResolvedValue(undefined)
    await saveSong(song, true)
    expect(mockInvoke).toHaveBeenCalledWith('save_song', { song, exportLrc: true })

    await saveSong(song, false)
    expect(mockInvoke).toHaveBeenCalledWith('save_song', { song, exportLrc: false })
  })

  it('pickCoverFile：透传 pick_cover_file 无参数；取消返回 null、选中返回 CoverInput', async () => {
    const cover: CoverInput = {
      data_url: 'data:image/png;base64,AAAA',
      mime: 'image/png',
    }
    mockInvoke.mockResolvedValue(cover)
    await expect(pickCoverFile()).resolves.toEqual(cover)
    expect(mockInvoke).toHaveBeenCalledWith('pick_cover_file', undefined)

    mockInvoke.mockResolvedValue(null)
    await expect(pickCoverFile()).resolves.toBeNull()
  })

  it('readCoverPath：透传 read_cover_path + { path }，返回 CoverInput', async () => {
    const cover: CoverInput = {
      data_url: 'data:image/webp;base64,BBBB',
      mime: 'image/webp',
    }
    mockInvoke.mockResolvedValue(cover)
    await expect(readCoverPath('/tmp/cover.webp')).resolves.toEqual(cover)
    expect(mockInvoke).toHaveBeenCalledWith('read_cover_path', { path: '/tmp/cover.webp' })
  })

  it('readCoverPath：读失败/非图片 → reject（中文原因透传）', async () => {
    mockInvoke.mockRejectedValue(new Error('封面格式无法识别'))
    await expect(readCoverPath('/tmp/not_image.txt')).rejects.toThrow('封面格式无法识别')
  })

  it('renameSong：透传 rename_song + { path, newName }（Tauri camelCase→snake_case 自动映射 newName→new_name）', async () => {
    mockInvoke.mockResolvedValue(undefined)
    await renameSong('/a/old.flac', '新歌.mp3')
    expect(mockInvoke).toHaveBeenCalledWith('rename_song', { path: '/a/old.flac', newName: '新歌.mp3' })
  })

  it('renameSong：改名被拒（撞名）→ reject（Rust「目标已存在」中文原因透传）', async () => {
    mockInvoke.mockRejectedValue(new Error('目标已存在'))
    await expect(renameSong('/a/old.flac', '新歌.mp3')).rejects.toThrow('目标已存在')
  })

  it('scanMissing：透传 scan_missing + { dir, checks } 和结果', async () => {
    const result: MissingScanResult = {
      songs: [{ path: '/music/a.flac', missing: ['title', 'cover'] }],
      errors: [],
    }
    mockInvoke.mockResolvedValue(result)

    await expect(scanMissing('/music', ['cover', 'title'])).resolves.toEqual(result)
    expect(mockInvoke).toHaveBeenCalledWith('scan_missing', {
      dir: '/music',
      checks: ['cover', 'title'],
    })
  })

  it('pickCoverSavePath：透传 pick_cover_save_path + { songPath }；取消返回 null（不是错误）', async () => {
    mockInvoke.mockResolvedValue('/music/告白气球.jpg')
    await expect(pickCoverSavePath('/a/song.flac')).resolves.toBe('/music/告白气球.jpg')
    expect(mockInvoke).toHaveBeenCalledWith('pick_cover_save_path', { songPath: '/a/song.flac' })

    // 取消 = 用户正常选择 → 返 null（调用方据此不调 export_cover），不得 reject
    mockInvoke.mockResolvedValue(null)
    await expect(pickCoverSavePath('/a/song.flac')).resolves.toBeNull()
  })

  it('exportCover：透传 export_cover + { songPath, destPath }（Tauri camelCase→snake_case 映射 dest_path）', async () => {
    mockInvoke.mockResolvedValue(undefined)
    await expect(exportCover('/a/song.flac', '/music/告白气球.png')).resolves.toBeUndefined()
    expect(mockInvoke).toHaveBeenCalledWith('export_cover', {
      songPath: '/a/song.flac',
      destPath: '/music/告白气球.png',
    })
  })

  it('导出两步链路：失败如实 reject 中文原因，不吞错（spec「导出失败如实报错」）', async () => {
    mockInvoke.mockRejectedValue('导出封面失败: No such file or directory (os error 2)')
    await expect(pickCoverSavePath('/a/song.flac')).rejects.toBe('导出封面失败: No such file or directory (os error 2)')

    mockInvoke.mockRejectedValue('该歌曲没有内嵌封面')
    await expect(exportCover('/a/song.flac', '/music/x.png')).rejects.toBe('该歌曲没有内嵌封面')
  })
})

const mockListen = vi.fn()
vi.mock('@tauri-apps/api/event', () => ({ listen: (...args: unknown[]) => mockListen(...args) }))
import { watchFolder, listenFolderChanged } from './songs'

it('watch_folder 使用 camelCase watchId，null 同接口停止', async () => {
  mockInvoke.mockResolvedValue(undefined)
  await watchFolder('/music', 42)
  expect(mockInvoke).toHaveBeenLastCalledWith('watch_folder', { dir: '/music', watchId: 42 })
  await watchFolder(null, 43)
  expect(mockInvoke).toHaveBeenLastCalledWith('watch_folder', { dir: null, watchId: 43 })
})

it('folder-changed 只传 payload，并透传 unlisten', async () => {
  const unlisten = vi.fn()
  mockListen.mockResolvedValue(unlisten)
  const handler = vi.fn()
  expect(await listenFolderChanged(handler)).toBe(unlisten)
  const payload = { dir: '/music', watchId: 42, error: null }
  mockListen.mock.calls[0]![1]({ payload, id: 1, event: 'folder-changed' })
  expect(handler).toHaveBeenCalledWith(payload)
})
