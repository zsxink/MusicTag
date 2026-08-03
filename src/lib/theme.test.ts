// 主题纯逻辑单测（design.md §10.4 co-located；spec：双主题的解析与合成）。
import { describe, expect, it } from 'vitest'

import { parseTheme, resolveTheme } from './theme'

describe('lib/theme — parseTheme（校验 localStorage 持久化值）', () => {
  it("精确 'dark' / 'light' → 对应主题", () => {
    expect(parseTheme('dark')).toBe('dark')
    expect(parseTheme('light')).toBe('light')
  })

  it('非法 / 缺失值 → null（跟随系统）：null、undefined、空串、大小写不符、乱码', () => {
    expect(parseTheme(null)).toBeNull()
    expect(parseTheme(undefined)).toBeNull()
    expect(parseTheme('')).toBeNull()
    expect(parseTheme('Dark')).toBeNull()
    expect(parseTheme('blue')).toBeNull()
    expect(parseTheme('  light  ')).toBeNull()
  })
})

describe('lib/theme — resolveTheme（手动优先，否则跟随系统）', () => {
  it('manual 为 dark → 恒深色（系统浅色也保持深色，D5 手动优先）', () => {
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('dark', true)).toBe('dark')
  })

  it('manual 为 light → 恒浅色（系统深色也保持浅色）', () => {
    expect(resolveTheme('light', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
  })

  it('manual=null → 跟随系统 prefers-color-scheme（深色默认 / 浅色跟随）', () => {
    expect(resolveTheme(null, false)).toBe('dark')
    expect(resolveTheme(null, true)).toBe('light')
  })
})
