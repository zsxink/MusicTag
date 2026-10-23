import { getAppVersion as readAppVersion, invokeCommand, listenEvent } from './client'

/** 与 Rust UpdateCheckResult 的 snake_case 序列化契约一致。 */
export interface UpdateCheckResult {
  current_version: string
  latest_version: string
  update_available: boolean
  release_url: string
}

export type UpdateMenuAction = 'open-folder' | 'save' | 'rescan-folder' | 'toggle-theme' | 'reload' | 'check-for-update' | 'show-about'

export function checkForUpdate(): Promise<UpdateCheckResult> {
  return invokeCommand<UpdateCheckResult>('check_for_update')
}

export function openReleasePage(url: string): Promise<void> {
  return invokeCommand<void>('open_release_page', { url })
}

/** 使用 Tauri 应用元数据，即使网络检查失败也能显示当前版本。 */
export function getAppVersion(): Promise<string> {
  return readAppVersion()
}

export function listenUpdateMenuAction(handler: (action: UpdateMenuAction) => void) {
  return listenEvent<UpdateMenuAction>('app-menu-action', (event) => handler(event.payload))
}

export function getLastUpdateCheckAt(now: string): Promise<string | null> {
  return invokeCommand<string | null>('get_last_update_check_at', { now })
}

export function saveLastUpdateCheckAt(value: string): Promise<void> {
  return invokeCommand<void>('save_last_update_check_at', { value })
}

export interface MenuItemSnapshot {
  id: string
  enabled: boolean
  visible: boolean
}

export function syncMenuState(items: MenuItemSnapshot[]): Promise<void> {
  return invokeCommand<void>('sync_menu_state', { snapshot: { items } })
}
