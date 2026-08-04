import { beforeEach, describe, expect, it, vi } from 'vitest'

// mock @tauri-apps/api/core.invoke，验证 search.ts 类型化封装逐字透传 command 名与参数
// （api/client.ts 必须保留 `import { invoke } from '@tauri-apps/api/core'`，改源会静默失效 mock）。
const mockInvoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

import type { SearchResult } from './types'
import { downloadCover, fetchLyric, searchSongs } from './search'

const searchResult: SearchResult = {
  songs: [
    {
      source: 'netease',
      id: 'n1',
      title: '歌名',
      artist: '作者',
      album: '专辑',
      cover_url: 'https://p1.music.126.net/cover.jpg',
    },
  ],
  source_stats: [
    ['netease', 1],
    ['qqmusic', 0],
    ['kugou', 0],
    ['lrclib', 0],
    ['itunes', 0],
  ],
}

describe('api/search.ts — 类型化 command 封装（命令名/参数逐字对齐 Rust 契约）', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
  })

  it('searchSongs：透传 search_song + { title, artist }，返回 SearchResult（五源聚合）', async () => {
    mockInvoke.mockResolvedValue(searchResult)
    await expect(searchSongs('歌名', '作者')).resolves.toEqual(searchResult)
    expect(mockInvoke).toHaveBeenCalledWith('search_song', { title: '歌名', artist: '作者' })
  })

  it('searchSongs：空 title/artist 同样透传（后端 D3 空 title 守卫在 Rust 侧过滤）', async () => {
    mockInvoke.mockResolvedValue({
      songs: [],
      source_stats: [
        ['netease', 0],
        ['qqmusic', 0],
        ['kugou', 0],
        ['lrclib', 0],
        ['itunes', 0],
      ],
    })
    await searchSongs('', '')
    expect(mockInvoke).toHaveBeenCalledWith('search_song', { title: '', artist: '' })
  })

  it('fetchLyric：透传 fetch_lyric + { source, id }；取词成功返回文本、None 返回 null（C2 换源判定依据）', async () => {
    mockInvoke.mockResolvedValue('[00:00.00] 歌词')
    await expect(fetchLyric('netease', 'n1')).resolves.toBe('[00:00.00] 歌词')
    expect(mockInvoke).toHaveBeenCalledWith('fetch_lyric', { source: 'netease', id: 'n1' })

    mockInvoke.mockResolvedValue(null)
    await expect(fetchLyric('qqmusic', 'q1')).resolves.toBeNull()
    expect(mockInvoke).toHaveBeenCalledWith('fetch_lyric', { source: 'qqmusic', id: 'q1' })
  })

  it('downloadCover：透传 download_cover + { url }，返回裸 bytes（number[]，IPC JSON 序列化）', async () => {
    const bytes = [0xff, 0xd8, 0xff, 0xe0]
    mockInvoke.mockResolvedValue(bytes)
    await expect(downloadCover('https://p1.music.126.net/cover.jpg')).resolves.toEqual(bytes)
    expect(mockInvoke).toHaveBeenCalledWith('download_cover', { url: 'https://p1.music.126.net/cover.jpg' })
  })

  it('downloadCover：下载失败（reject）→ 中文原因透传', async () => {
    mockInvoke.mockRejectedValue(new Error('封面下载超时'))
    await expect(downloadCover('https://x/bad.jpg')).rejects.toThrow('封面下载超时')
  })
})
