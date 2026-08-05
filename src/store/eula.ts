// 首次启动授权门禁 store（pre-release-check T1.1）：同意状态 localStorage 持久化。
// 仿 theme.ts env 注入模式：localStorage / window 关闭经 EulaEnv 注入（测试传桩零依赖真实 DOM/Tauri）。
// §10.0 规定 localStorage 属 Web API，只允许在 store/ 层触碰（lib/ 禁止）——故授权状态读写不落 lib/。
// 分层：组件只依赖本 store（组件→store 方向合法）；`@tauri-apps/api/window` 的关闭经 env 注入而非组件直引。
import { getCurrentWindow } from '@tauri-apps/api/window'

/** localStorage 持久化 key（对齐既有 `music-tag-` 前缀，参照 THEME_STORAGE_KEY='music-tag-theme'）。 */
export const EULA_STORAGE_KEY = 'music-tag-eula-accepted'

/** 已同意标记值：仅 '1' = 已同意；缺失 = 未同意。不存在「拒绝后记忆」——拒绝即退出，二次启动仍弹。 */
export const EULA_ACCEPTED_VALUE = '1'

/** 授权门禁依赖的环境（注入桩便于单测，默认实现用 Tauri WebView 的 window.localStorage + getCurrentWindow）。 */
export interface EulaEnv {
  /** 读持久化同意状态：原始值，缺失 null。 */
  readAccepted: () => string | null
  /** 写同意标记（'1'）。 */
  writeAccepted: () => void
  /** 关闭窗口（拒绝 → 退出应用）。 */
  closeWindow: () => void
}

/** 默认环境：Tauri WebView 的 window.localStorage（store 允许触碰 Web API）。
 *  localStorage 读写失败（隐私模式等）时静默降级：本轮不弹、重启后重弹（可接受）。 */
function defaultEnv(): EulaEnv {
  return {
    readAccepted: () => {
      try {
        return window.localStorage.getItem(EULA_STORAGE_KEY)
      } catch {
        return null
      }
    },
    writeAccepted: () => {
      try {
        window.localStorage.setItem(EULA_STORAGE_KEY, EULA_ACCEPTED_VALUE)
      } catch {
        /* 存储不可用：静默降级，不阻断同意（重启后重弹，可接受） */
      }
    },
    closeWindow: () => {
      void getCurrentWindow().close()
    },
  }
}

/** 是否已同意授权（true 当且仅当持久化值为 '1'，同步读）。 */
export function isEulaAccepted(env: EulaEnv = defaultEnv()): boolean {
  return env.readAccepted() === EULA_ACCEPTED_VALUE
}

/** 同意授权：写持久化 '1'（二次启动不再弹窗）。 */
export function acceptEula(env: EulaEnv = defaultEnv()): void {
  env.writeAccepted()
}

/** 拒绝授权：关闭窗口退出应用（不写任何持久化——二次启动仍弹）。 */
export function rejectEula(env: EulaEnv = defaultEnv()): void {
  env.closeWindow()
}
