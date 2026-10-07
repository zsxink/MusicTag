import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invoke, listen, getVersion } = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), getVersion: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen }))
vi.mock('@tauri-apps/api/app', () => ({ getVersion }))

import { checkForUpdate, getAppVersion, listenUpdateMenuAction, openReleasePage } from './updates'

describe('更新 API 契约', () => {
  beforeEach(() => vi.clearAllMocks())

  it('检查与打开详情透传自有 command；读取应用版本使用 Tauri 元数据', async () => {
    const result = { current_version: '0.1.3', latest_version: '0.2.0', update_available: true, release_url: 'https://github.com/zsxink/MusicTag/releases/tag/v0.2.0' }
    invoke.mockResolvedValueOnce(result).mockResolvedValueOnce(undefined)
    getVersion.mockResolvedValue('0.1.3')
    await expect(checkForUpdate()).resolves.toEqual(result)
    expect(invoke).toHaveBeenNthCalledWith(1, 'check_for_update', undefined)
    await openReleasePage(result.release_url)
    expect(invoke).toHaveBeenNthCalledWith(2, 'open_release_page', { url: result.release_url })
    await expect(getAppVersion()).resolves.toBe('0.1.3')
  })

  it('菜单事件解包 payload，返回原有释放函数', async () => {
    const stop = vi.fn()
    const handler = vi.fn()
    listen.mockResolvedValue(stop)
    const unlisten = await listenUpdateMenuAction(handler)
    expect(listen.mock.calls[0][0]).toBe('update-menu-action')
    const callback = listen.mock.calls[0][1]
    callback({ payload: 'check-for-update' })
    callback({ payload: 'show-about' })
    expect(handler.mock.calls).toEqual([['check-for-update'], ['show-about']])
    expect(unlisten).toBe(stop)
    unlisten()
    expect(stop).toHaveBeenCalledOnce()
  })
})
