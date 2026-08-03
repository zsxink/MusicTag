// 主题状态 store（design.md D4：与歌曲编辑完全正交，独立 reactive 单例）。
// 与 song.ts 并列，遵守同一「单 store 不用 Pinia」模式（非物理单文件）：
// localStorage / matchMedia / document 等 Web API 允许在本层触碰（lib 层禁止）。
// 浏览器环境以 ThemeEnv 注入（仿 song.ts loader 注入模式），测试传桩不依赖真实 DOM。
import { reactive } from 'vue'

import { parseTheme, resolveTheme } from '../lib/theme'
import type { ThemeChoice, ThemeEffective } from '../lib/theme'

/** localStorage 持久化 key（PRD §7：localStorage 与 tauri-plugin-store 二选一 → 取 localStorage）。 */
export const THEME_STORAGE_KEY = 'music-tag-theme'

/** 主题依赖的浏览器环境（注入桩便于单测，默认实现用 Tauri WebView 的 window/document）。 */
export interface ThemeEnv {
  /** 读持久化选择：localStorage.getItem 原始值，缺失 null。 */
  readChoice: () => string | null
  /** 写/删持久化选择（null = 删 key → 跟随系统）。 */
  writeChoice: (choice: ThemeChoice) => void
  /** 系统当前是否偏好浅色（matchMedia('(prefers-color-scheme: light)').matches）。 */
  systemPrefersLight: () => boolean
  /** 注册系统偏好 change 监听，返回解除函数。 */
  onSystemChange: (cb: () => void) => () => void
  /** 应用 data-theme 到根元素（null = 移除属性 → 回落到 CSS media 跟随系统）。 */
  applyDataTheme: (choice: ThemeChoice) => void
}

/** 默认环境：Tauri WebView 的 window/document（store 允许触碰 Web API）。
 *  localStorage 读写失败（隐私模式等）时静默降级：会话内仍生效，重启不记忆。 */
function defaultEnv(): ThemeEnv {
  const media = window.matchMedia('(prefers-color-scheme: light)')
  return {
    readChoice: () => {
      try {
        return window.localStorage.getItem(THEME_STORAGE_KEY)
      } catch {
        return null
      }
    },
    writeChoice: (choice) => {
      try {
        if (choice === null) window.localStorage.removeItem(THEME_STORAGE_KEY)
        else window.localStorage.setItem(THEME_STORAGE_KEY, choice)
      } catch {
        /* 存储不可用：静默降级，不阻断主题切换 */
      }
    },
    systemPrefersLight: () => media.matches,
    onSystemChange: (cb) => {
      media.addEventListener('change', cb)
      return () => media.removeEventListener('change', cb)
    },
    applyDataTheme: (choice) => {
      const el = document.documentElement
      if (choice === null) el.removeAttribute('data-theme')
      else el.setAttribute('data-theme', choice)
    },
  }
}

interface ThemeState {
  /** 手动选择（null = 跟随系统）。 */
  manualChoice: ThemeChoice
  /** 当前生效主题（合成结果，AppBar 图标消费）。 */
  effective: ThemeEffective
}

const raw = reactive<ThemeState>({
  manualChoice: null,
  effective: 'dark', // 深色缺省（防启动闪白，与 CSS :root 默认一致）
})

let currentEnv: ThemeEnv | null = null
let unsubscribe: (() => void) | null = null

/**
 * 初始化主题（main.ts 在 app.mount() 前同步调用，防启动闪深/闪白）：
 * 1. 读 localStorage 持久化选择 → manualChoice（浅色手动用户启动不闪深）；
 * 2. 合成 effective（手动优先，否则跟随系统）+ 应用 data-theme；
 * 3. 注册 matchMedia change 监听（D7：仅 manualChoice===null 时系统偏好切换生效）。
 */
export function initTheme(env: ThemeEnv = defaultEnv()): void {
  currentEnv = env
  unsubscribe?.() // 重复初始化先解除旧监听（测试多次调用场景）
  const manual = parseTheme(env.readChoice())
  raw.manualChoice = manual
  raw.effective = resolveTheme(manual, env.systemPrefersLight())
  env.applyDataTheme(manual)
  unsubscribe = env.onSystemChange(() => {
    // D7：手动选择后系统偏好不再漂移（钉住 + 重启记忆语义的反向保证）
    if (raw.manualChoice !== null) return
    const eff = resolveTheme(null, currentEnv!.systemPrefersLight())
    raw.effective = eff
    currentEnv!.applyDataTheme(null)
  })
}

/**
 * 手动切换主题（AppBar 主题按钮）：写/删 localStorage + 更新 effective + 应用 data-theme。
 * choice=null 表示取消手动选择（回到跟随系统）——当前 UI 仅提供深/浅切换，保留该能力。
 */
export function setTheme(choice: ThemeChoice): void {
  const env = currentEnv ?? defaultEnv()
  raw.manualChoice = choice
  raw.effective = resolveTheme(choice, env.systemPrefersLight())
  env.writeChoice(choice)
  env.applyDataTheme(choice)
}

/** 只读封装 store（AppBar 读 effective/manualChoice）。 */
export const themeStore = raw
