import { describe, expect, it } from 'vitest'

import { songStore } from './song'

describe('songStore 骨架（SongEditor 形态占位）', () => {
  it('初始为空状态：无选中歌曲', () => {
    expect(songStore.current).toBeNull()
    expect(songStore.original).toBeNull()
    expect(songStore.dirty).toBe(false)
    expect(songStore.lyricsSource).toBe('none')
  })
})