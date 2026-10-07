import { reactive } from 'vue'
import { checkForUpdate, getAppVersion, openReleasePage } from '../api/updates'
import type { UpdateCheckResult } from '../api/updates'

export { listenUpdateMenuAction } from '../api/updates'

export const DISMISSED_UPDATE_STORAGE_KEY = 'music-tag-dismissed-update-version'
export type UpdateStatus = 'idle' | 'checking' | 'up-to-date' | 'update-available' | 'error'
export type UpdateCheckOrigin = 'startup' | 'manual'
export type UpdateOutcome = { result: UpdateCheckResult; error: null } | { result: null; error: string }

export const updatesStore = reactive({
  status: 'idle' as UpdateStatus,
  currentVersion: '',
  recentOutcome: null as UpdateOutcome | null,
  recentCheckOrigin: null as UpdateCheckOrigin | null,
  dismissedVersion: null as string | null,
  noticeVisible: false,
  openingDetails: false,
  detailError: '',
})

let requestSequence = 0
let initializationSequence = 0

/** 同步读取提示记忆，版本查询与网络检查均不阻塞工作区挂载。 */
export function initUpdates(): void {
  const initialization = ++initializationSequence
  try {
    updatesStore.dismissedVersion = window.localStorage.getItem(DISMISSED_UPDATE_STORAGE_KEY)
  } catch {
    updatesStore.dismissedVersion = null
  }
  void getAppVersion().then((version) => {
    if (initialization === initializationSequence) updatesStore.currentVersion = version
  }).catch(() => { /* 非 Tauri 预览环境没有应用元数据。 */ })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 仅最后发出的请求可以发布结果，旧请求成功或失败都不覆盖新状态。 */
export async function checkUpdates(check = checkForUpdate, origin: UpdateCheckOrigin = 'startup'): Promise<void> {
  const request = ++requestSequence
  updatesStore.status = 'checking'
  updatesStore.noticeVisible = true
  updatesStore.detailError = ''
  try {
    const result = await check()
    if (request !== requestSequence) return
    updatesStore.currentVersion = result.current_version
    updatesStore.recentOutcome = { result, error: null }
    updatesStore.recentCheckOrigin = origin
    updatesStore.status = result.update_available ? 'update-available' : 'up-to-date'
    updatesStore.noticeVisible = origin === 'manual' || !result.update_available || result.latest_version !== updatesStore.dismissedVersion
  } catch (error) {
    if (request !== requestSequence) return
    updatesStore.recentOutcome = { result: null, error: errorMessage(error) }
    updatesStore.recentCheckOrigin = origin
    updatesStore.status = 'error'
    updatesStore.noticeVisible = true
  }
}

/** 已稍后的同版仍可展示手动检查结果，但不再次展示更新操作提示。 */
export function shouldPromptUpdate(): boolean {
  const result = updatesStore.recentOutcome?.result
  return updatesStore.status === 'update-available' && !!result && result.latest_version !== updatesStore.dismissedVersion
}

/** 手动检查结果始终保留详情入口；稍后只抑制自动更新操作提示。 */
export function canViewUpdateDetails(): boolean {
  return shouldPromptUpdate() || (updatesStore.status === 'update-available' && updatesStore.recentCheckOrigin === 'manual')
}

/** 只抑制提示，保留最近检查结果供关于界面展示。 */
export function dismissUpdate(): void {
  const result = updatesStore.recentOutcome?.result
  if (updatesStore.status === 'update-available' && result) {
    updatesStore.dismissedVersion = result.latest_version
    try {
      window.localStorage.setItem(DISMISSED_UPDATE_STORAGE_KEY, result.latest_version)
    } catch { /* 存储不可用时保留会话内记忆。 */ }
  }
  updatesStore.noticeVisible = false
}

/** 仅由查看详情按钮调用；失败保留提示，允许再次尝试。 */
export async function viewUpdateDetails(open = openReleasePage): Promise<void> {
  const result = updatesStore.recentOutcome?.result
  if (!result?.update_available || updatesStore.openingDetails) return
  const request = requestSequence
  updatesStore.openingDetails = true
  updatesStore.detailError = ''
  try {
    await open(result.release_url)
  } catch (error) {
    if (request === requestSequence) updatesStore.detailError = `打开详情失败：${errorMessage(error)}`
  } finally {
    updatesStore.openingDetails = false
  }
}

export function recentUpdateText(): string {
  const outcome = updatesStore.recentOutcome
  if (!outcome) return '尚未完成更新检查'
  if (outcome.error !== null) return outcome.error.startsWith('检查更新失败') ? outcome.error : `检查更新失败：${outcome.error}`
  return outcome.result.update_available
    ? `发现新版本 ${outcome.result.latest_version}`
    : '已是最新版本'
}
