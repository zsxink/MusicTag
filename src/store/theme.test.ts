// 主题 store 单测（design.md D4–D7）：注入 localStorage + matchMedia 桩（仿 song.test.ts loader 注入模式）。
// 覆盖：持久化读写、data-theme 应用、手动优先于系统、系统监听仅 manualChoice===null 时生效。
import { beforeEach, describe, expect, it } from 'vitest'

import type { ThemeEnv } from './theme'
import { initTheme, setTheme, themeStore } from './theme'

/** 构造可注入的主题环境桩（localStorage + matchMedia + document 的轻量替身）。 */
function makeEnv(opts: { stored?: string | null; systemLight?: boolean } = {}) {
  const { stored = null, systemLight = false } = opts
  let storedValue: string | null = stored
  let systemLightNow = systemLight
  const listeners: Array<() => void> = []
  const applied: Array<string | null> = []

  const env: ThemeEnv = {
    readChoice: () => storedValue,
    writeChoice: (c) => {
      storedValue = c
    },
    systemPrefersLight: () => systemLightNow,
    onSystemChange: (cb) => {
      listeners.push(cb)
      return () => {
        /* 测试桩：解除忽略 */
      }
    },
    applyDataTheme: (c) => {
      applied.push(c)
    },
  }

  return {
    env,
    applied,
    listeners,
    getStored: () => storedValue,
    setSystemLight(v: boolean) {
      systemLightNow = v
    },
    triggerChange() {
      listeners.forEach((cb) => cb())
    },
  }
}

describe('store/theme — initTheme（main.ts 在 mount 前同步调用）', () => {
  beforeEach(() => {
    // 重置共享状态，避免用例间串扰
    themeStore.manualChoice = null
    themeStore.effective = 'dark'
  })

  it('无持久化 + 系统深色 → manualChoice=null、effective=dark、data-theme 移除（跟随系统）', () => {
    const { env, applied } = makeEnv()
    initTheme(env)
    expect(themeStore.manualChoice).toBeNull()
    expect(themeStore.effective).toBe('dark')
    expect(applied).toEqual([null]) // 移除 data-theme 属性 → 回落到 CSS 深色默认
  })

  it('无持久化 + 系统浅色 → effective=light（浅色跟随系统，spec 场景）', () => {
    const { env } = makeEnv({ systemLight: true })
    initTheme(env)
    expect(themeStore.manualChoice).toBeNull()
    expect(themeStore.effective).toBe('light')
  })

  it('持久化 light → manualChoice=light、effective=light、data-theme="light"（启动不闪深）', () => {
    const { env, applied } = makeEnv({ stored: 'light' })
    initTheme(env)
    expect(themeStore.manualChoice).toBe('light')
    expect(themeStore.effective).toBe('light')
    expect(applied).toEqual(['light'])
  })

  it('非法持久化值 → manualChoice=null（跟随系统）', () => {
    const { env } = makeEnv({ stored: 'blue' })
    initTheme(env)
    expect(themeStore.manualChoice).toBeNull()
    expect(themeStore.effective).toBe('dark')
  })
})

describe('store/theme — setTheme（手动切换 + 持久记忆，spec FR-7.3/7.4）', () => {
  it('setTheme("light")：manualChoice/effective=light、写 localStorage、data-theme="light"', () => {
    const { env, applied, getStored } = makeEnv()
    initTheme(env)
    setTheme('light')
    expect(themeStore.manualChoice).toBe('light')
    expect(themeStore.effective).toBe('light')
    expect(getStored()).toBe('light') // 持久记忆（重启保持）
    expect(applied).toEqual([null, 'light'])
  })

  it('手动深色覆盖系统浅色（D5 手动优先于系统）', () => {
    const { env } = makeEnv({ systemLight: true })
    initTheme(env)
    expect(themeStore.effective).toBe('light') // 初始跟随系统浅色
    setTheme('dark')
    expect(themeStore.manualChoice).toBe('dark')
    expect(themeStore.effective).toBe('dark') // 系统浅色仍显深
  })

  it('手动浅色覆盖系统深色', () => {
    const { env } = makeEnv()
    initTheme(env)
    setTheme('light')
    expect(themeStore.effective).toBe('light')
  })

  it('setTheme(null)：删 localStorage key、移除 data-theme、回落到跟随系统', () => {
    const { env, applied, getStored } = makeEnv({ stored: 'light', systemLight: true })
    initTheme(env)
    setTheme(null)
    expect(themeStore.manualChoice).toBeNull()
    expect(themeStore.effective).toBe('light') // 跟随系统浅色
    expect(getStored()).toBeNull() // key 已删
    expect(applied).toEqual(['light', null])
  })
})

describe('store/theme — matchMedia 监听条件化（D7：仅未手动选择时系统偏好切换生效）', () => {
  it('manualChoice=null：系统偏好变化 → effective 跟随更新', () => {
    const { env, setSystemLight, triggerChange } = makeEnv()
    initTheme(env)
    expect(themeStore.effective).toBe('dark')

    setSystemLight(true)
    triggerChange()
    expect(themeStore.effective).toBe('light') // 未手动选择 → 跟随系统

    setSystemLight(false)
    triggerChange()
    expect(themeStore.effective).toBe('dark')
  })

  it('manualChoice 非空：系统偏好变化 → 主题钉住不漂移（D7 反向保证）', () => {
    const { env, setSystemLight, triggerChange } = makeEnv()
    initTheme(env)
    setTheme('light') // 手动浅色
    expect(themeStore.effective).toBe('light')

    setSystemLight(true)
    triggerChange()
    expect(themeStore.effective).toBe('light') // 系统浅色不漂移（本就浅）

    setSystemLight(false)
    triggerChange()
    expect(themeStore.effective).toBe('light') // 系统切深色也不漂移（手动钉住）
  })
})
