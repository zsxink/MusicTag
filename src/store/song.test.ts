import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Song } from '../lib/tauri'
import { open, selectSong, songStore } from './song'

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

describe('songStore 骨架（SongEditor 形态占位）', () => {
  it('初始为空状态：无选中歌曲', () => {
    expect(songStore.current).toBeNull()
    expect(songStore.original).toBeNull()
    expect(songStore.dirty).toBe(false)
    expect(songStore.lyricsSource).toBe('none')
  })
})

describe('songStore — v1-song-read 编辑状态模型', () => {
  beforeEach(() => {
    songStore.selectedPath = null
    songStore.current = null
    songStore.original = null
    songStore.readonly = false
    songStore.lyricsSource = 'none'
  })

  it('open 成功：current=original 快照、dirty=false、readonly=false', async () => {
    const song = makeSong()
    await open('/a/song.flac', vi.fn(async () => song))

    expect(songStore.current).toEqual(song)
    expect(songStore.original).toEqual(song)
    expect(songStore.current).not.toBe(songStore.original) // 快照必须独立，编辑不污染原始值
    expect(songStore.dirty).toBe(false)
    expect(songStore.readonly).toBe(false)
    expect(songStore.lyricsSource).toBe(song.lyrics_source)
  })

  it('编辑任一字段 → dirty=true', async () => {
    await open('/a/song.flac', vi.fn(async () => makeSong()))

    songStore.current!.title = '新歌名'
    expect(songStore.dirty).toBe(true)

    // 编辑歌词同样触发
    songStore.current!.lyrics = '[00:00.00] 一行'
    expect(songStore.dirty).toBe(true)
  })

  it('改回原值 → dirty=false（逐字段对比）', async () => {
    await open('/a/song.flac', vi.fn(async () => makeSong()))

    songStore.current!.title = '新歌名'
    expect(songStore.dirty).toBe(true)
    songStore.current!.title = '歌名'
    expect(songStore.dirty).toBe(false)
  })

  it('open_song Err → readonly=true、current/original=null、dirty=false', async () => {
    await open('/bad/broken.mp3', vi.fn(async () => { throw new Error('读取标签失败') }))

    expect(songStore.readonly).toBe(true)
    expect(songStore.current).toBeNull()
    expect(songStore.original).toBeNull()
    expect(songStore.dirty).toBe(false)
  })

  it('切歌：再 open 另一首 → current 替换、dirty 归零', async () => {
    await open('/a/one.flac', vi.fn(async () => makeSong({ path: '/a/one.flac', title: 'One' })))
    songStore.current!.title = '改过'
    expect(songStore.dirty).toBe(true)

    await open('/a/two.flac', vi.fn(async () => makeSong({ path: '/a/two.flac', title: 'Two' })))

    expect(songStore.current?.path).toBe('/a/two.flac')
    expect(songStore.current?.title).toBe('Two')
    expect(songStore.dirty).toBe(false)
  })

  it('selectSong 带 loader：选中并触发 open 读取', async () => {
    const loadSong = vi.fn(async (p: string) => makeSong({ path: p, title: 'T' }))

    await selectSong('/a/s.flac', loadSong)

    expect(songStore.selectedPath).toBe('/a/s.flac')
    expect(loadSong).toHaveBeenCalledWith('/a/s.flac')
    expect(songStore.current?.title).toBe('T')
  })

  it('selectSong 无 loader（纯选中）：只设 selectedPath，不读全量', async () => {
    await selectSong('/a/s.flac')
    expect(songStore.selectedPath).toBe('/a/s.flac')
    expect(songStore.current).toBeNull()
  })
})
