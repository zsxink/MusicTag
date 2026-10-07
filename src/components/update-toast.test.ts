import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'

const { openReleasePage } = vi.hoisted(() => ({ openReleasePage: vi.fn() }))
vi.mock('../api/updates', () => ({ checkForUpdate: vi.fn(), getAppVersion: vi.fn(), listenUpdateMenuAction: vi.fn(), openReleasePage }))

import UpdateToast from './UpdateToast.vue'
import AboutDialog from './AboutDialog.vue'
import { checkUpdates, updatesStore } from '../store/updates'
import type { UpdateCheckResult } from '../api/updates'

enableAutoUnmount(afterEach)
const result: UpdateCheckResult = {
  current_version: '0.1.3', latest_version: '0.2.0', update_available: true,
  release_url: 'https://github.com/zsxink/MusicTag/releases/tag/v0.2.0',
}
beforeEach(() => {
  window.localStorage.clear()
  openReleasePage.mockReset().mockResolvedValue(undefined)
  Object.assign(updatesStore, { status: 'idle', currentVersion: '0.1.3', recentOutcome: null, dismissedVersion: null, noticeVisible: false, openingDetails: false, detailError: '' })
})

describe('非模态更新提示', () => {
  it('显示版本与操作，挂载不抢焦点且不使用遮罩或模态语义', async () => {
    const input = document.createElement('input')
    document.body.append(input)
    input.focus()
    await checkUpdates(async () => result)
    const w = mount(UpdateToast, { attachTo: document.body })
    expect(w.text()).toContain('发现新版本 0.2.0')
    expect(w.findAll('button').map((button) => button.text())).toEqual(['查看详情', '稍后'])
    expect(w.find('[aria-modal], [role="dialog"], .overlay').exists()).toBe(false)
    expect(w.get('[role="status"]').attributes('aria-modal')).toBeUndefined()
    expect(document.activeElement).toBe(input)
    expect(input.hasAttribute('inert')).toBe(false)
    expect(openReleasePage).not.toHaveBeenCalled()
    input.remove()
  })

  it('点击查看详情才打开对应 Release 页面，稍后隐藏提示', async () => {
    await checkUpdates(async () => result)
    const w = mount(UpdateToast)
    await w.findAll('button')[0].trigger('click')
    await flushPromises()
    expect(openReleasePage).toHaveBeenCalledWith(result.release_url)
    await w.findAll('button')[1].trigger('click')
    expect(w.find('[data-testid="update-toast"]').exists()).toBe(false)
  })

  it('检查中、最新、失败均有明确提示', async () => {
    let resolve!: (result: UpdateCheckResult) => void
    const pending = checkUpdates(() => new Promise((done) => { resolve = done }))
    const w = mount(UpdateToast)
    expect(w.text()).toContain('正在检查更新…')
    resolve({ ...result, update_available: false })
    await pending
    await nextTick()
    expect(w.text()).toContain('已是最新版本')
    await checkUpdates(async () => { throw '网络不可用' })
    await nextTick()
    expect(w.text()).toContain('检查更新失败：网络不可用')
  })

  it('打开浏览器失败保留提示并允许重试', async () => {
    await checkUpdates(async () => result)
    openReleasePage.mockRejectedValueOnce('浏览器不可用')
    const w = mount(UpdateToast)
    await w.findAll('button')[0].trigger('click')
    await flushPromises()
    expect(w.text()).toContain('打开详情失败：浏览器不可用')
    expect(w.findAll('button')[0].attributes('disabled')).toBeUndefined()
  })
})

describe('关于界面最近结果', () => {
  it('展示当前版本、尚未检查和检查中状态', async () => {
    const w = mount(AboutDialog)
    expect(w.text()).toContain('当前版本：0.1.3')
    expect(w.text()).toContain('尚未完成更新检查')
    updatesStore.status = 'checking'
    await nextTick()
    expect(w.text()).toContain('正在检查更新…')
  })

  it('展示可用更新、最新与失败；关闭按钮发出关闭事件', async () => {
    const w = mount(AboutDialog)
    await checkUpdates(async () => result)
    await nextTick()
    expect(w.text()).toContain('最近检查：发现新版本 0.2.0')
    await checkUpdates(async () => ({ ...result, update_available: false }))
    await nextTick()
    expect(w.text()).toContain('最近检查：已是最新版本')
    await checkUpdates(async () => { throw 'GitHub 暂不可用' })
    await nextTick()
    expect(w.text()).toContain('最近检查：检查更新失败：GitHub 暂不可用')
    await w.get('button').trigger('click')
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('Escape 关闭，卸载后释放键盘监听并还原焦点', () => {
    const input = document.createElement('input')
    document.body.append(input)
    input.focus()
    const onClose = vi.fn()
    const w = mount(AboutDialog, { attachTo: document.body, attrs: { onClose } })
    expect(document.activeElement).toBe(w.get('button').element)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onClose).toHaveBeenCalledOnce()
    w.unmount()
    expect(document.activeElement).toBe(input)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onClose).toHaveBeenCalledOnce()
    input.remove()
  })
})
