import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import type { Song } from '../api/types'
import { songStore } from '../store/song'
import LyricPanel from './LyricPanel.vue'

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

/** 打开一首歌进 store（等价 open() 成功态，含 D7 切歌重置 exportLrc）。 */
function openSong(song: Song = makeSong()): void {
  songStore.current = { ...song }
  songStore.original = { ...song }
  songStore.readonly = false
  songStore.lyricsSource = song.lyrics_source
  songStore.selectedPath = song.path
  songStore.exportLrc = false
  songStore.saveState = 'idle'
  songStore.saveError = ''
}

describe('LyricPanel — 来源 badge 三态（design.md D8 文案定稿）', () => {
  beforeEach(() => openSong())

  it('lyrics_source=embedded → 「来源: 内嵌标签」', () => {
    openSong(makeSong({ lyrics_source: 'embedded', lyrics: '[00:00.00] 内嵌' }))
    const w = mount(LyricPanel)
    expect(w.find('.badge').text()).toBe('来源: 内嵌标签')
  })

  it('lyrics_source=sidecar → 「来源: 侧载 .lrc」（D8：同名 .lrc 统一改文案）', () => {
    openSong(makeSong({ lyrics_source: 'sidecar', lyrics: '[00:00.00] 侧载' }))
    const w = mount(LyricPanel)
    expect(w.find('.badge').text()).toBe('来源: 侧载 .lrc')
    expect(w.text()).not.toContain('同名 .lrc') // 旧文案不得残留
  })

  it('lyrics_source=none → 「来源: 无」', () => {
    openSong(makeSong({ lyrics_source: 'none', lyrics: '' }))
    const w = mount(LyricPanel)
    expect(w.find('.badge').text()).toBe('来源: 无')
  })
})

describe('LyricPanel — 「同时保存为 .lrc」复选框（design.md D7）', () => {
  beforeEach(() => openSong())

  it('默认不勾选（opt-in）：checkbox.checked=false 且 store.exportLrc=false', () => {
    const w = mount(LyricPanel)
    const cb = w.find('input[type="checkbox"]').element as HTMLInputElement
    expect(cb.checked).toBe(false)
    expect(songStore.exportLrc).toBe(false)
  })

  it('勾选 → 写入 songStore.exportLrc=true（v-model 绑 store，EditorBar 保存时读它）', async () => {
    const w = mount(LyricPanel)
    await w.find('input[type="checkbox"]').setValue(true)
    expect(songStore.exportLrc).toBe(true)
  })

  it('readonly → 复选框禁用（坏标签只读，无法 opt-in 导出）', () => {
    songStore.readonly = true
    const w = mount(LyricPanel)
    expect((w.find('input[type="checkbox"]').element as HTMLInputElement).disabled).toBe(true)
  })

  it('textarea 绑 current.lyrics（等宽 mono 正文，design.md §5）', () => {
    openSong(makeSong({ lyrics_source: 'embedded', lyrics: '[00:12.34] 你说你有点难追' }))
    const w = mount(LyricPanel)
    const ta = w.find('textarea.lyrics-box')
    expect((ta.element as HTMLTextAreaElement).value).toBe('[00:12.34] 你说你有点难追')
    // mono 等宽由 .lyrics-box 样式承载（design 原则 3：歌词正文 mono）
    expect(ta.classes()).toContain('lyrics-box')
  })
})
