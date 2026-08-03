import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import type { Song } from '../api/types'
import { songStore } from '../store/song'
import FieldRow from './FieldRow.vue'

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

function openSong(song: Song = makeSong()): void {
  songStore.current = { ...song }
  songStore.original = { ...song }
  songStore.readonly = false
  songStore.lyricsSource = song.lyrics_source
  songStore.selectedPath = song.path
  songStore.saveState = 'idle'
  songStore.saveError = ''
  songStore.pendingRename = null
  songStore.renameRejected = false
}

/** 挂载 file 形态的 FieldRow。 */
const mountFileRow = () => mount(FieldRow, { props: { label: '文件名', kind: 'file' } })

describe('FieldRow — 文件名行可编辑（v1-rename-sync：pendingRename 独立状态，非 Song 字段）', () => {
  beforeEach(() => openSong())

  it('file 形态渲染可编辑 input，显示值 = fileName(selectedPath)', () => {
    const w = mountFileRow()
    const input = w.find('input.field-input')
    expect(input.exists()).toBe(true)
    expect((input.element as HTMLInputElement).value).toBe('song.flac')
    expect(input.attributes('disabled')).toBeUndefined()
  })

  it('输入 → setPendingRename（store.pendingRename 更新，显示值跟随）', async () => {
    const w = mountFileRow()
    await w.find('input').setValue('新歌.mp3')
    expect(songStore.pendingRename).toBe('新歌.mp3')
    // 重新挂载后显示值 = pendingRename
    const w2 = mountFileRow()
    expect((w2.find('input').element as HTMLInputElement).value).toBe('新歌.mp3')
  })

  it('清空输入 → pendingRename 归 null（回到原文件名显示）', async () => {
    const w = mountFileRow()
    await w.find('input').setValue('')
    expect(songStore.pendingRename).toBeNull()
    const w2 = mountFileRow()
    expect((w2.find('input').element as HTMLInputElement).value).toBe('song.flac')
  })

  it('readonly（坏标签只读）→ input 禁用', () => {
    songStore.readonly = true
    const w = mountFileRow()
    expect(w.find('input').attributes('disabled')).toBeDefined()
  })

  it('renameRejected → 行内 danger 提示「目标已存在」（撞名行内提示）', () => {
    songStore.pendingRename = '撞名.flac'
    songStore.renameRejected = true
    const w = mountFileRow()
    expect(w.find('.file-rejected').exists()).toBe(true)
    expect(w.text()).toContain('目标已存在')
  })

  it('renameRejected=false → 无行内提示', () => {
    const w = mountFileRow()
    expect(w.find('.file-rejected').exists()).toBe(false)
  })
})
