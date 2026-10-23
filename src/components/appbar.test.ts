// AppBar 主题按钮组件测试（v1-ux-settings D8：图标 = 目标主题，点击调 setTheme）。
// 注入 theme store 桩环境（仿 store/theme.test.ts），不触碰真实 DOM。
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import { initTheme, themeStore } from '../store/theme'
import { updatesStore, restoreUpdateNotice } from '../store/updates'
import type { ThemeEnv } from '../store/theme'
import AppBar from './AppBar.vue'

/** 构造主题 store 测试环境桩（localStorage + matchMedia 轻量替身）。 */
function makeEnv(opts: { stored?: string | null; systemLight?: boolean } = {}): ThemeEnv {
  const { stored = null, systemLight = false } = opts
  let storedValue: string | null = stored
  let systemLightNow = systemLight
  return {
    readChoice: () => storedValue,
    writeChoice: (c) => {
      storedValue = c
    },
    systemPrefersLight: () => systemLightNow,
    onSystemChange: () => () => {
      /* no-op */
    },
    applyDataTheme: () => {
      /* no-op */
    },
  }
}

describe('AppBar — 主题按钮（spec: 顶栏最右主题按钮手动切换 ☀️/🌙，图标 = 目标主题）', () => {
  beforeEach(() => {
    initTheme(makeEnv()) // 干净状态：无手动选择、系统深色 → effective=dark
  })

  const themeBtn = (w: ReturnType<typeof mount>) => w.get('button.theme-btn')

  it('effective=dark → 显示 ☀️（图标指向目标主题：点击后去浅色）', () => {
    expect(themeStore.effective).toBe('dark')
    const w = mount(AppBar)
    expect(themeBtn(w).text()).toBe('☀️')
    expect(themeBtn(w).attributes('aria-label')).toBe('切换到浅色')
  })

  it('effective=light → 显示 🌙（点击后去深色）', () => {
    initTheme(makeEnv({ stored: 'light' }))
    expect(themeStore.effective).toBe('light')
    const w = mount(AppBar)
    expect(themeBtn(w).text()).toBe('🌙')
    expect(themeBtn(w).attributes('aria-label')).toBe('切换到深色')
  })

  it('可用更新显示品牌与路径之间的无障碍红点，并可恢复提示', async () => {
    Object.assign(updatesStore, {
      status: 'update-available',
      recentOutcome: { result: { current_version: '0.1.3', latest_version: '0.2.0', update_available: true, release_url: 'https://example.com' }, error: null },
      dismissedVersion: '0.2.0',
      noticeVisible: false,
    })
    const w = mount(AppBar)
    const indicator = w.get('button.update-indicator')
    expect(indicator.attributes('aria-label')).toContain('有可用更新')
    expect(w.find('.brand').element.nextElementSibling).toBe(indicator.element)
    await indicator.trigger('click')
    expect(updatesStore.noticeVisible).toBe(true)
    restoreUpdateNotice()
  })

  it('点击主题按钮 → setTheme 在深浅间切换，图标跟随 effective', async () => {
    const w = mount(AppBar)
    expect(themeBtn(w).text()).toBe('☀️')

    await themeBtn(w).trigger('click')
    expect(themeStore.effective).toBe('light') // 手动切到浅色
    expect(themeBtn(w).text()).toBe('🌙') // 图标翻转

    await themeBtn(w).trigger('click')
    expect(themeStore.effective).toBe('dark') // 再点回深色
    expect(themeBtn(w).text()).toBe('☀️')
  })
})
