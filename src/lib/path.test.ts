import { describe, expect, it } from 'vitest'

import { fileName, fileNameStem, replaceFileName } from './path'

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

describe('lib/path — replaceFileName（v1-rename-sync 改名成功后同步 path）', () => {
  it('跨 / 替换路径末段 → 新路径', () => {
    expect(replaceFileName('/a/b/old.flac', 'new.mp3')).toBe('/a/b/new.mp3')
    expect(replaceFileName('/a/old.mp3', '新歌.flac')).toBe('/a/新歌.flac')
  })

  it('跨 \\ 替换（Windows 路径）', () => {
    expect(replaceFileName('C:\\music\\old.flac', '新歌.flac')).toBe('C:\\music\\新歌.flac')
  })

  it('无路径前缀（纯文件名）→ 直接返回新名', () => {
    expect(replaceFileName('old.flac', 'new.flac')).toBe('new.flac')
  })

  it('保留目录部分不变（只替换末段）', () => {
    expect(replaceFileName('/dir1/dir2/歌.mp3', '新歌.mp3')).toBe('/dir1/dir2/新歌.mp3')
  })
})
