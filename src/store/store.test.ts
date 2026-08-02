import { describe, expect, it, beforeEach } from 'vitest'

import { describe, expect, it, beforeEach, vi } from 'vitest'

import type { SongSummary } from '../lib/tauri'
import { songStore, filteredSongs, fileName, titleText, artistText, activateFolder, selectSong } from './song'

const s = (path: string, title = '', artist = ''): SongSummary => ({ path, title, artist })

describe('songStore — v1-folder-list 状态', () => {
  beforeEach(() => {
    songStore.folderPath = null
    songStore.songs = []
    songStore.searchQuery = ''
    songStore.selectedPath = null
  })

  it('初始为空状态：无目录、无列表、无搜索、无选中', () => {
    expect(songStore.folderPath).toBeNull()
    expect(songStore.songs).toEqual([])
    expect(songStore.searchQuery).toBe('')
    expect(songStore.selectedPath).toBeNull()
  })

  describe('selectSong — 点击选中（spec: 点击行选中高亮）', () => {
    it('传入 path 即选中该行', () => {
      selectSong('/a/song.flac')
      expect(songStore.selectedPath).toBe('/a/song.flac')
    })

    it('传入 null 清除选中（换目录后无选中）', () => {
      selectSong('/a/song.flac')
      selectSong(null)
      expect(songStore.selectedPath).toBeNull()
    })
  })

  describe('activateFolder — 换目录整体替换列表 + 顶栏路径（spec: 重新打开整体替换）', () => {
    it('目录非空：设 folderPath、加载并整体替换 songs、重置 selectedPath', async () => {
      const dir = '/music/other'
      const fresh = [s('/music/other/a.flac', 'A', 'AA'), s('/music/other/b.mp3', 'B', 'BB')]
      const loadSongs = vi.fn(async () => fresh)

      await activateFolder(dir, loadSongs)

      expect(loadSongs).toHaveBeenCalledWith(dir)
      expect(songStore.folderPath).toBe(dir) // 顶栏展示路径
      expect(songStore.songs).toEqual(fresh)
      expect(songStore.selectedPath).toBeNull() // 换目录重置选中
    })

    it('换目录前已有旧列表：结果被整体替换而非追加', async () => {
      songStore.songs = [s('/old/zz.flac', 'Old', 'O')]
      const fresh = [s('/new/a.flac', 'New', 'N')]
      await activateFolder('/new', async () => fresh)
      expect(songStore.songs).toEqual(fresh)
      expect(songStore.folderPath).toBe('/new')
    })

    it('取消（dir 为空/null）→ 不改动任何状态、不调 loader', async () => {
      const loader = vi.fn(async () => [])
      await activateFolder(null, loader)
      await activateFolder('', loader)
      expect(songStore.folderPath).toBeNull()
      expect(songStore.songs).toEqual([])
      expect(loader).not.toHaveBeenCalled()
    })
  })
})

describe('fileName — 取路径最后一段', () => {
  it('带扩展名正规路径', () => {
    expect(fileName('/a/b/song.mp3')).toBe('song.mp3')
  })
  it('Windows 反斜杠路径', () => {
    expect(fileName('C:\\music\\中\\song.flac')).toBe('song.flac')
  })
  it('无分隔符路径', () => {
    expect(fileName('song.mp3')).toBe('song.mp3')
  })
})

describe('titleText / artistText — 空标签回退文件名（去扩展名）', () => {
  it('有非空 title 用 title', () => {
    expect(titleText(s('/a/x.mp3', '歌名', 'artist'))).toBe('歌名')
  })
  it('title 空白用文件名去扩展名', () => {
    expect(titleText(s('/a/x.mp3', '  ', 'artist'))).toBe('x')
    expect(titleText(s('/a/y.flac', '', 'artist'))).toBe('y')
  })
  it('artist 空白回退文件名去扩展名', () => {
    expect(artistText(s('/a/z.mp3', 't', ' '))).toBe('z')
    expect(artistText(s('/a/z.mp3', 't', ''))).toBe('z')
  })
})

describe('filteredSongs.value — 搜索过滤 + 文件名升序', () => {
  beforeEach(() => {
    songStore.songs = [
      s('/a/zz.mp3', 'Bohemian Rhapsody', 'Queen'),
      s('/b/alpha.flac', '', ''),
      s('/c/mid.mp3', 'Candle in Wind', 'Elton'),
      s('/d/queen.flac', 'Bohemian Ideology', 'Queen'),
    ]
    songStore.searchQuery = ''
  })

  it('空搜索返回全部且按文件名升序', () => {
    const names = filteredSongs.value.map((x) => fileName(x.path))
    expect(names).toEqual(['alpha.flac', 'mid.mp3', 'queen.flac', 'zz.mp3'])
  })

  it('搜索歌名包含、忽略大小写', () => {
    songStore.searchQuery = 'bohemian'
    expect(filteredSongs.value.map((x) => x.path)).toEqual([
      '/d/queen.flac',
      '/a/zz.mp3',
    ])
  })

  it('搜索作者包含', () => {
    songStore.searchQuery = 'queen'
    const paths = filteredSongs.value.map((x) => x.path).sort()
    expect(paths).toEqual(['/a/zz.mp3', '/d/queen.flac'])
  })

  it('无匹配返回空数组', () => {
    songStore.searchQuery = 'zzz-no-match'
    expect(filteredSongs.value).toEqual([])
  })
})