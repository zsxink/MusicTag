// EulaDialog 组件测试（pre-release-check T1.2）：vi.mock('../store/eula') 桩（仿 store 注入模式），
// 覆盖 spec 场景：首次启动渲染授权遮罩、同意 → 写持久化 + 关遮罩、拒绝 → 调 closeWindow、
// 已同意 → 不渲染（二次启动不弹）。零 Tauri 模块依赖（组件不 import @tauri-apps/api/*）。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

// 桩 store/eula 三个函数：isEulaAccepted（自门禁）由用例设置，acceptEula/rejectEula 记录调用。
const { mockIsAccepted, mockAccept, mockReject } = vi.hoisted(() => ({
  mockIsAccepted: vi.fn(),
  mockAccept: vi.fn(),
  mockReject: vi.fn(),
}))
vi.mock('../store/eula', () => ({
  isEulaAccepted: mockIsAccepted,
  acceptEula: mockAccept,
  rejectEula: mockReject,
}))

import EulaDialog from './EulaDialog.vue'

beforeEach(() => {
  mockIsAccepted.mockReset()
  mockAccept.mockReset()
  mockReject.mockReset()
})

describe('EulaDialog — 首次启动（未同意）渲染授权遮罩（spec「首次启动弹出授权窗口」）', () => {
  beforeEach(() => mockIsAccepted.mockReturnValue(false))

  it('渲染全窗口模态遮罩：role="dialog" + aria-modal + 标题', () => {
    const w = mount(EulaDialog)
    const dialog = w.get('[role="dialog"]')
    expect(dialog.attributes('aria-modal')).toBe('true')
    expect(dialog.attributes('aria-labelledby')).toBe('eula-dialog-title')
    expect(w.get('#eula-dialog-title').exists()).toBe(true)
    expect(w.get('[data-testid="eula-dialog"]').exists()).toBe(true)
  })

  it('展示协议要点（个人学习 / 禁商用 / 禁转卖 / 禁 AI 转写 / 外部 API 免责）', () => {
    const w = mount(EulaDialog)
    const text = w.text()
    expect(text).toContain('个人学习')
    expect(text).toContain('禁止商用')
    expect(text).toContain('销售')
    expect(text).toContain('AI 转写')
    expect(text).toContain('外部 API')
  })

  it('提供「同意并继续 / 拒绝」两按钮', () => {
    const w = mount(EulaDialog)
    const buttons = w.findAll('button')
    const texts = buttons.map((b) => b.text())
    expect(texts).toContain('同意并继续')
    expect(texts).toContain('拒绝')
  })
})

describe('EulaDialog — 同意 → 写持久化 + 关闭遮罩进入主界面（spec「同意后进入主界面并持久化」）', () => {
  beforeEach(() => mockIsAccepted.mockReturnValue(false))

  it('点「同意并继续」→ acceptEula() 被调 + 遮罩消失', async () => {
    const w = mount(EulaDialog)
    expect(w.find('[data-testid="eula-dialog"]').exists()).toBe(true)

    const acceptBtn = w.findAll('button').find((b) => b.text() === '同意并继续')!
    await acceptBtn.trigger('click')

    expect(mockAccept).toHaveBeenCalledTimes(1)
    expect(w.find('[data-testid="eula-dialog"]').exists()).toBe(false) // 遮罩关闭，主界面可交互
  })
})

describe('EulaDialog — 拒绝 → 退出应用（spec「拒绝则退出应用」，Tauri closeWindow）', () => {
  beforeEach(() => mockIsAccepted.mockReturnValue(false))

  it('点「拒绝」→ rejectEula() 被调（store 默认 env 关窗退出），遮罩不清空', async () => {
    const w = mount(EulaDialog)
    const rejectBtn = w.findAll('button').find((b) => b.text() === '拒绝')!
    await rejectBtn.trigger('click')

    expect(mockReject).toHaveBeenCalledTimes(1)
    // rejectEula 关闭窗口，应用退出；组件侧不写持久化、不清门禁
    expect(mockAccept).not.toHaveBeenCalled()
  })
})

describe('EulaDialog — 键盘隔离（CR：遮罩期间主界面 inert + 初始焦点落「同意并继续」）', () => {
  // 包装父容器模拟 `.app`：主界面按钮 + EulaDialog 遮罩为兄弟节点
  const mountWithMain = () =>
    mount({
      render: () => h('div', [h('button', { class: 'main-ui', type: 'button' }, '主界面按钮'), h(EulaDialog)]),
    })

  it('遮罩渲染时对主界面兄弟节点置 inert（Tab 不可聚焦遮罩下方控件）', () => {
    const w = mountWithMain()
    const mainBtn = w.find('button.main-ui')
    expect(mainBtn.exists()).toBe(true)
    expect(mainBtn.element.hasAttribute('inert')).toBe(true)
    // 遮罩自身不可 inert——「同意并继续 / 拒绝」按钮须可聚焦
    const overlay = w.get('[data-testid="eula-dialog"]').element.parentElement!
    expect(overlay.className).toContain('overlay')
    expect(overlay.hasAttribute('inert')).toBe(false)
  })

  it('同意关闭后移除主界面 inert（恢复可交互）', async () => {
    const w = mountWithMain()
    expect(w.find('button.main-ui').element.hasAttribute('inert')).toBe(true)

    const acceptBtn = w.findAll('button').find((b) => b.text() === '同意并继续')!
    await acceptBtn.trigger('click')

    expect(mockAccept).toHaveBeenCalledTimes(1)
    expect(w.find('button.main-ui').element.hasAttribute('inert')).toBe(false)
  })

  it('初始焦点落「同意并继续」（安全默认，回车即同意）', async () => {
    const w = mount(EulaDialog, { attachTo: document.body })
    await flushPromises() // 等 onMounted 的 nextTick 聚焦微任务
    expect(document.activeElement?.textContent).toBe('同意并继续')
    w.unmount()
  })
})

describe('EulaDialog — 已同意 → 不渲染（spec「已同意后二次启动不弹窗」）', () => {
  it('isEulaAccepted()=true → 组件不渲染任何遮罩/内容', () => {
    mockIsAccepted.mockReturnValue(true)
    const w = mount(EulaDialog)
    expect(w.find('[data-testid="eula-dialog"]').exists()).toBe(false)
    expect(w.find('[role="dialog"]').exists()).toBe(false)
    expect(w.find('.overlay').exists()).toBe(false)
    expect(w.text()).toBe('') // 自渲染空（仅 v-if 注释）
  })
})
