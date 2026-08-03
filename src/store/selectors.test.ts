import { beforeEach, describe, expect, it } from 'vitest'

import type { SongSummary } from '../api/types'
import { fileName } from '../lib/path'
import { artistText, filteredSongs, sourceLabel, titleText } from './selectors'
import { songStore } from './song'

const s = (path: string, title = '', artist = ''): SongSummary => ({ path, title, artist })

describe('store/selectors — 纯展示派生（spec: 搜索过滤 + 文件名升序 + 空标签回退）', () => {
  beforeEach(() => {
    songStore.songs = []
    songStore.searchQuery = ''
  })

  describe('filteredSongs — 搜索过滤 + 文件名升序（computed 从 songStore 派生）', () => {
    beforeEach(() => {
      songStore.songs = [
        s('/a/zz.mp3', 'Bohemian Rhapsody', 'Queen'),
        s('/b/alpha.flac', '', ''),
        s('/c/mid.mp3', 'Candle in Wind', 'Elton'),
        s('/d/queen.flac', 'Bohemian Ideology', 'Queen'),
      ]
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

  describe('sourceLabel — 音乐来源平台展示文案（候选来源标签 / badge 平台来源，design §6.4/6.5）', () => {
    it('netease → 网易云', () => {
      expect(sourceLabel('netease')).toBe('网易云')
    })
    it('qqmusic → QQ音乐', () => {
      expect(sourceLabel('qqmusic')).toBe('QQ音乐')
    })
    it('migu → 咪咕', () => {
      expect(sourceLabel('migu')).toBe('咪咕')
    })
  })
})
