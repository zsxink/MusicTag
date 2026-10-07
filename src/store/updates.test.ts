import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import type { UpdateCheckResult } from '../api/updates'

const { getAppVersion } = vi.hoisted(() => ({ getAppVersion: vi.fn() }))
vi.mock('../api/updates', () => ({
  checkForUpdate: vi.fn(), getAppVersion, openReleasePage: vi.fn(), listenUpdateMenuAction: vi.fn(),
}))

import { checkUpdates, dismissUpdate, DISMISSED_UPDATE_STORAGE_KEY, initUpdates, recentUpdateText, updatesStore, viewUpdateDetails } from './updates'

const result = (version = '0.2.0', available = true): UpdateCheckResult => ({
  current_version: '0.1.3', latest_version: version, update_available: available,
  release_url: `https://github.com/zsxink/MusicTag/releases/tag/v${version}`,
})
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('更新状态与提示记忆', () => {
  beforeEach(() => {
    window.localStorage.clear()
    getAppVersion.mockResolvedValue('0.1.3')
    Object.assign(updatesStore, { status: 'idle', currentVersion: '', recentOutcome: null, dismissedVersion: null, noticeVisible: false, openingDetails: false, detailError: '' })
  })

  it('检查中保留最近结果，随后区分可用更新、最新和失败', async () => {
    await checkUpdates(async () => result())
    expect(updatesStore.status).toBe('update-available')
    expect(recentUpdateText()).toContain('0.2.0')
    const pending = deferred<UpdateCheckResult>()
    const check = checkUpdates(() => pending.promise)
    expect(updatesStore.status).toBe('checking')
    expect(updatesStore.noticeVisible).toBe(true)
    expect(recentUpdateText()).toContain('0.2.0')
    pending.resolve(result('0.1.3', false))
    await check
    expect(updatesStore.status).toBe('up-to-date')
    expect(recentUpdateText()).toBe('已是最新版本')
    await checkUpdates(async () => { throw new Error('网络不可用') })
    expect(updatesStore.status).toBe('error')
    expect(recentUpdateText()).toContain('检查更新失败：网络不可用')
  })

  it.each(['resolve', 'reject'] as const)('旧请求 %s 不覆盖后发请求结果', async (completion) => {
    const old = deferred<UpdateCheckResult>()
    const first = checkUpdates(() => old.promise)
    await checkUpdates(async () => result('0.3.0'))
    if (completion === 'resolve') old.resolve(result('0.2.0'))
    else old.reject('旧网络错误')
    await first
    expect(updatesStore.status).toBe('update-available')
    expect(updatesStore.recentOutcome?.result?.latest_version).toBe('0.3.0')
  })

  it('最新失败也不被旧成功覆盖', async () => {
    const old = deferred<UpdateCheckResult>()
    const first = checkUpdates(() => old.promise)
    await checkUpdates(async () => { throw '最新检查失败' })
    old.resolve(result())
    await first
    expect(updatesStore.status).toBe('error')
    expect(updatesStore.recentOutcome?.error).toBe('最新检查失败')
  })

  it('稍后写入持久化；重新初始化后同版不提示、更高版仍提示', async () => {
    await checkUpdates(async () => result())
    dismissUpdate()
    expect(window.localStorage.getItem(DISMISSED_UPDATE_STORAGE_KEY)).toBe('0.2.0')
    expect(updatesStore.noticeVisible).toBe(false)
    updatesStore.dismissedVersion = null
    initUpdates()
    await checkUpdates(async () => result())
    expect(updatesStore.noticeVisible).toBe(false)
    expect(recentUpdateText()).toContain('0.2.0')
    await checkUpdates(async () => result('0.3.0'))
    expect(updatesStore.noticeVisible).toBe(true)
    expect(recentUpdateText()).toContain('0.3.0')
  })

  it('存储不可用仍可在会话内稍后并检查', async () => {
    const write = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('禁止存储') })
    await checkUpdates(async () => result())
    dismissUpdate()
    await checkUpdates(async () => result())
    expect(updatesStore.noticeVisible).toBe(false)
    write.mockRestore()
  })

  it('网络失败时独立读取当前版本', async () => {
    initUpdates()
    await checkUpdates(async () => { throw '离线' })
    await flushPromises()
    expect(updatesStore.currentVersion).toBe('0.1.3')
    expect(recentUpdateText()).toContain('离线')
  })

  it('后端中文错误前缀不重复，旧详情操作错误不污染新检查结果', async () => {
    await checkUpdates(async () => { throw '检查更新失败：网络请求失败' })
    expect(recentUpdateText()).toBe('检查更新失败：网络请求失败')
    await checkUpdates(async () => result())
    const pending = deferred<void>()
    const opened = viewUpdateDetails(() => pending.promise)
    await checkUpdates(async () => result('0.3.0'))
    pending.reject('旧版本详情打开失败')
    await opened
    expect(updatesStore.detailError).toBe('')
    expect(recentUpdateText()).toContain('0.3.0')
  })

  it('显式详情操作调用外链 API，防止重复打开并显示失败', async () => {
    const open = vi.fn()
    await viewUpdateDetails(open)
    expect(open).not.toHaveBeenCalled()
    await checkUpdates(async () => result())
    expect(open).not.toHaveBeenCalled()
    const pending = deferred<void>()
    open.mockReturnValue(pending.promise)
    const first = viewUpdateDetails(open)
    await viewUpdateDetails(open)
    expect(open).toHaveBeenCalledOnce()
    expect(open).toHaveBeenCalledWith(result().release_url)
    pending.reject('系统浏览器不可用')
    await first
    expect(updatesStore.detailError).toContain('系统浏览器不可用')
    expect(updatesStore.openingDetails).toBe(false)
  })
})
