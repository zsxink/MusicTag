import { describe, expect, it } from 'vitest'

import { fileName, fileNameStem } from './path'

describe('lib/path — 纯路径工具（组件/selectors 共用）', () => {
  it('fileName 取路径最后一段（跨平台 / 与 \\）', () => {
    expect(fileName('/a/b/song.mp3')).toBe('song.mp3')
    expect(fileName('C:\\music\\中\\song.flac')).toBe('song.flac')
    expect(fileName('song.mp3')).toBe('song.mp3')
  })

  it('fileNameStem 去扩展名', () => {
    expect(fileNameStem('/a/b/song.mp3')).toBe('song')
    expect(fileNameStem('/a/b/无扩展名')).toBe('无扩展名')
    expect(fileNameStem('a.flac')).toBe('a')
  })
})
