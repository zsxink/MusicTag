// SwitchDialog 组件测试（v1-ux-settings D1–D3）：三按钮行为、Esc 取消、
// role="dialog" aria-modal、消息文案（文件名）、保存中禁用「保存」按钮。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

// mock invoke：弹窗「保存」走默认 save()（invokeCommand('save_song')) 在单测中成功。
const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}))

import type { Song } from '../api/types'
import { cancelPending, resolvePending, songStore } from '../store/song'
import SwitchDialog from './SwitchDialog.vue'

beforeEach(() => {
  mockInvoke.mockReset()
  mockInvoke.mockResolvedValue(undefined)
})

const makeSong = (over: Partial<Song> = {}): Song => ({
  path: '/a/告白气球.mp3',
  title: '告白气球',
  artist: '周杰伦',
  album: '',
  album_artist: '',
  track: '1',
  track_total: '',
  year: '',
  genre: '',
  lyrics: '',
  lyrics_source: 'none',
  cover: null,
  cover_mime: null,
  ...over,
})

/** 构造 dirty 编辑态 + 切歌 pending（弹窗出现前提）。 */
function setupDirtySwitch(): void {
  songStore.selectedPath = '/a/告白气球.mp3'
  songStore.current = { ...makeSong() }
  songStore.original = { ...makeSong() }
  songStore.current!.title = '改过' // 制造 dirty
  songStore.readonly = false
  songStore.saveState = 'idle'
  songStore.saveError = ''
  songStore.pendingAction = {
    kind: 'switch',
    path: '/a/第二首.flac',
    loadSong: async (p: string) => makeSong({ path: p, title: '第二首' }),
  }
}

describe('SwitchDialog — 渲染与消息文案（spec: 「保存对 <文件名> 的修改吗？」）', () => {
  beforeEach(setupDirtySwitch)

  it('role="dialog" + aria-modal + aria-labelledby 指向标题', () => {
    const w = mount(SwitchDialog)
    const dialog = w.get('[role="dialog"]')
    expect(dialog.attributes('aria-modal')).toBe('true')
    expect(dialog.attributes('aria-labelledby')).toBe('switch-dialog-title')
    expect(w.get('#switch-dialog-title').exists()).toBe(true)
  })

  it('消息含当前编辑的文件名（lib/path fileName），文件名 mono 展示', () => {
    const w = mount(SwitchDialog)
    expect(w.text()).toContain('保存对')
    expect(w.text()).toContain('告白气球.mp3')
    expect(w.text()).toContain('的修改吗？')
    expect(w.find('.file-name').text()).toBe('告白气球.mp3')
  })

  it('三按钮：保存（primary）/ 不保存（danger）/ 取消（ghost）', () => {
    const w = mount(SwitchDialog)
    const primary = w.get('button.btn-primary')
    const danger = w.get('button.btn-danger')
    const ghost = w.get('button.btn-ghost')
    expect(primary.text()).toBe('保存')
    expect(danger.text()).toBe('不保存')
    expect(ghost.text()).toBe('取消')
  })

  it('初始焦点落「取消」（安全默认，防误触保存/丢弃）', () => {
    const w = mount(SwitchDialog, { attachTo: document.body })
    const cancel = w.get('button.btn-ghost').element as HTMLButtonElement
    expect(document.activeElement).toBe(cancel)
    w.unmount()
  })
})

describe('SwitchDialog — 三选一行为（spec 场景）', () => {
  beforeEach(setupDirtySwitch)

  it('点「保存」→ resolvePending(save)：saveState 到 saved、pending 清空、切歌完成', async () => {
    const w = mount(SwitchDialog)
    await w.get('button.btn-primary').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(songStore.pendingAction).toBeNull()
    expect(songStore.selectedPath).toBe('/a/第二首.flac')
    expect(songStore.current?.title).toBe('第二首')
    expect(songStore.dirty).toBe(false)
  })

  it('点「不保存」→ resolvePending(discard)：丢弃编辑直接切歌', async () => {
    const w = mount(SwitchDialog)
    await w.get('button.btn-danger').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(songStore.pendingAction).toBeNull()
    expect(songStore.selectedPath).toBe('/a/第二首.flac')
    expect(songStore.current?.title).toBe('第二首')
  })

  it('点「取消」→ cancelPending：留在当前、编辑保留、pending 清空', async () => {
    const w = mount(SwitchDialog)
    await w.get('button.btn-ghost').trigger('click')

    expect(songStore.pendingAction).toBeNull()
    expect(songStore.selectedPath).toBe('/a/告白气球.mp3') // 未切歌
    expect(songStore.current?.title).toBe('改过') // 编辑保留
    expect(songStore.dirty).toBe(true)
  })
})

describe('SwitchDialog — Esc 取消 + 保存中禁用「保存」', () => {
  beforeEach(setupDirtySwitch)

  it('Esc → cancelPending：留在当前（spec「可 Esc 取消」）', async () => {
    const w = mount(SwitchDialog)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(songStore.pendingAction).toBeNull()
    expect(songStore.selectedPath).toBe('/a/告白气球.mp3')
  })

  it('保存中（saving）→ 「保存」按钮禁用（防连点并发写同一文件），不保存/取消仍可点', () => {
    songStore.saveState = 'saving'
    const w = mount(SwitchDialog)
    const primary = w.get('button.btn-primary')
    expect(primary.attributes('disabled')).toBeDefined()
    expect(w.get('button.btn-danger').attributes('disabled')).toBeUndefined()
    expect(w.get('button.btn-ghost').attributes('disabled')).toBeUndefined()
  })
})

describe('SwitchDialog — 保存中竞态（CR：保存中取消/Esc → 不切换；保存中不保存 → 忽略）', () => {
  beforeEach(setupDirtySwitch)

  it('保存进行中取消（cancelPending）→ save 成功后不再切换（spec「取消留在当前」）', async () => {
    // 竞态真实路径：resolvePending('save') 注入受控 saveFn，在 save await 挂起期间触发取消。
    // 用 Deferred 手动控制 saveFn 的 resolve 时机，模拟「写入进行中用户取消」。
    let resolveSave!: (v: void) => void
    const saveFn = () => new Promise<void>((r) => (resolveSave = r))

    const p = resolvePending('save', saveFn) // 进入 save，await saveFn 挂起
    // 写入进行中用户取消：cancelPending 清空 pendingAction（弹窗关闭）
    cancelPending()
    expect(songStore.pendingAction).toBeNull()

    // save 成功落盘：此时 resolvePending 续跑，应发现 pendingAction 已清空 → 不再切换
    resolveSave()
    await p

    expect(songStore.pendingAction).toBeNull() // 保持已取消
    expect(songStore.selectedPath).toBe('/a/告白气球.mp3') // 未切歌
    expect(songStore.current?.title).toBe('改过') // 编辑保留
  })

  it('保存进行中 discard → 忽略（saving 改道无效），不切歌不丢编辑', async () => {
    // 保存中（saveState='saving'）改道 discard：resolvePending('discard') 应被 saving 守卫拦截
    songStore.saveState = 'saving'
    await resolvePending('discard')

    expect(songStore.pendingAction).not.toBeNull() // 弹窗保持打开
    expect(songStore.selectedPath).toBe('/a/告白气球.mp3') // 未切歌
    expect(songStore.current?.title).toBe('改过') // 编辑保留
  })
})

describe('SwitchDialog — 换目录复用（spec: 换目录复用同一三选一弹窗）', () => {
  beforeEach(() => {
    songStore.selectedPath = '/a/告白气球.mp3'
    songStore.current = { ...makeSong() }
    songStore.original = { ...makeSong() }
    songStore.current!.title = '改过'
    songStore.readonly = false
    songStore.saveState = 'idle'
    songStore.saveError = ''
    songStore.folderPath = '/a'
    songStore.pendingAction = { kind: 'folder', dir: '/new', loadSongs: async () => [] }
  })

  it('点「保存」→ 先保存再换目录（列表替换）', async () => {
    const w = mount(SwitchDialog)
    await w.get('button.btn-primary').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(songStore.pendingAction).toBeNull()
    expect(songStore.folderPath).toBe('/new')
  })

  it('点「取消」→ 不换目录、保持当前状态', async () => {
    const w = mount(SwitchDialog)
    await w.get('button.btn-ghost').trigger('click')
    expect(songStore.pendingAction).toBeNull()
    expect(songStore.folderPath).toBe('/a')
  })
})
