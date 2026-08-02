import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Song } from '../lib/tauri'
import { activateFolder, open, selectSong, songStore } from './song'

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
    // 生产路径 selectSong 先设 selectedPath 再 open（并发守卫依赖该不变量）
    songStore.selectedPath = song.path
    await open('/a/song.flac', vi.fn(async () => song))

    expect(songStore.current).toEqual(song)
    expect(songStore.original).toEqual(song)
    expect(songStore.current).not.toBe(songStore.original) // 快照必须独立，编辑不污染原始值
    expect(songStore.dirty).toBe(false)
    expect(songStore.readonly).toBe(false)
    expect(songStore.lyricsSource).toBe(song.lyrics_source)
  })

  it('编辑任一字段 → dirty=true', async () => {
    songStore.selectedPath = '/a/song.flac'
    await open('/a/song.flac', vi.fn(async () => makeSong()))

    songStore.current!.title = '新歌名'
    expect(songStore.dirty).toBe(true)

    // 编辑歌词同样触发
    songStore.current!.lyrics = '[00:00.00] 一行'
    expect(songStore.dirty).toBe(true)
  })

  it('改回原值 → dirty=false（逐字段对比）', async () => {
    songStore.selectedPath = '/a/song.flac'
    await open('/a/song.flac', vi.fn(async () => makeSong()))

    songStore.current!.title = '新歌名'
    expect(songStore.dirty).toBe(true)
    songStore.current!.title = '歌名'
    expect(songStore.dirty).toBe(false)
  })

  it('open_song Err → readonly=true、current/original=null、dirty=false', async () => {
    songStore.selectedPath = '/bad/broken.mp3'
    await open('/bad/broken.mp3', vi.fn(async () => { throw new Error('读取标签失败') }))

    expect(songStore.readonly).toBe(true)
    expect(songStore.current).toBeNull()
    expect(songStore.original).toBeNull()
    expect(songStore.dirty).toBe(false)
  })

  it('切歌：再 open 另一首 → current 替换、dirty 归零', async () => {
    songStore.selectedPath = '/a/one.flac'
    await open('/a/one.flac', vi.fn(async () => makeSong({ path: '/a/one.flac', title: 'One' })))
    songStore.current!.title = '改过'
    expect(songStore.dirty).toBe(true)

    songStore.selectedPath = '/a/two.flac'
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

  it('并发守卫：慢的旧响应后到 → 丢弃，不覆盖新选中（防表单/列表错位）', async () => {
    // A 请求慢、B 请求快：B 先返回并设 current，A 后返回必须被丢弃
    let resolveA!: (s: Song) => void
    const loadA = vi.fn(() => new Promise<Song>((res) => { resolveA = res }))
    const loadB = vi.fn(async () => makeSong({ path: '/a/b.flac', title: 'B' }))

    // 模拟点击 A → 点击 B（B 先完成，selectedPath 已是 B）
    const pA = selectSong('/a/a.flac', loadA)
    await selectSong('/a/b.flac', loadB)

    expect(songStore.selectedPath).toBe('/a/b.flac')
    expect(songStore.current?.title).toBe('B')

    // A 的慢响应此刻才到 → 已过期，丢弃
    resolveA(makeSong({ path: '/a/a.flac', title: 'A' }))
    await pA

    expect(songStore.current?.title).toBe('B') // 未被旧歌覆盖
    expect(songStore.current?.path).toBe('/a/b.flac')
  })

  it('并发守卫：过期错误同样丢弃，不误设只读', async () => {
    // A 请求将失败但后到，B 已成功打开 → A 的错误不得把 readonly 置 true
    let rejectA!: (e: Error) => void
    const loadA = vi.fn(() => new Promise<Song>((_, rej) => { rejectA = rej }))
    const loadB = vi.fn(async () => makeSong({ path: '/a/b.flac', title: 'B' }))

    const pA = selectSong('/a/broken.flac', loadA)
    await selectSong('/a/b.flac', loadB)
    expect(songStore.readonly).toBe(false)

    rejectA(new Error('读取标签失败'))
    await pA

    expect(songStore.readonly).toBe(false) // 旧错误不误设只读
    expect(songStore.current?.path).toBe('/a/b.flac')
  })

  it('换目录（activateFolder）：重置编辑状态，不残留上一首', async () => {
    songStore.selectedPath = '/a/old.flac'
    await open('/a/old.flac', vi.fn(async () => makeSong({ path: '/a/old.flac' })))
    songStore.current!.title = '改过'
    expect(songStore.dirty).toBe(true)

    await activateFolder('/newdir', vi.fn(async () => []))

    expect(songStore.selectedPath).toBeNull()
    expect(songStore.current).toBeNull()
    expect(songStore.original).toBeNull()
    expect(songStore.dirty).toBe(false)
    expect(songStore.readonly).toBe(false)
  })
})
