// SongList 组件挂载回归测试（bug #27：模板里 computed 误写 `.value` 导致解包后崩溃）。
//
// 根因：`<script setup>` 模板中 computed 经 `$setup`(proxyRefs) 自动解包，
// `filteredSongs.value` 的 `.value` 取到 undefined → `.length` 抛 TypeError，
// 整个 SongList 渲染崩溃，表现为「打开文件夹后列表不显示」。
// 回归：v-else-if 分支求值 + v-for 渲染都必须用解包后的数组（去掉 `.value`）。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

// mock invoke：openFolder 经 api/songs.ts 的 pickFolder/listSongs 走 mock IPC（接线测试才发）。
// 默认 async no-op：onMounted 启动自动加载调 getLastDir()（invokeCommand 需要返回 Promise）。
const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn(async () => undefined) }))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}))

import type { Song } from '../api/types'
import { songStore } from '../store/song'
import SongList from './SongList.vue'

const makeSong = (path: string): Song => ({
  path,
  title: '歌名',
  artist: '作者',
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
})

describe('SongList — 打开文件夹后的列表渲染（regression #27）', () => {
  beforeEach(() => {
    songStore.folderPath = null
    songStore.songs = []
    songStore.searchQuery = ''
  })

  it('空文件夹 → 展示「文件夹中没有音乐」空态，不崩溃', () => {
    songStore.folderPath = '/empty/dir'
    const w = mount(SongList)
    expect(w.find('[data-testid="empty-state"]').exists()).toBe(true)
    expect(w.text()).toContain('文件夹中没有音乐')
  })

  it('有歌曲 → 渲染歌曲行，行内显示歌名与作者', () => {
    songStore.folderPath = '/some/dir'
    songStore.songs = [{ path: '/some/dir/a.flac', title: 'My Love', artist: 'Westlife' }]
    const w = mount(SongList)
    expect(w.findAll('.song-row').length).toBe(1)
    expect(w.text()).toContain('My Love')
    expect(w.text()).toContain('Westlife')
  })

  it('搜索无匹配 → 展示「无匹配结果」空态', () => {
    songStore.folderPath = '/some/dir'
    songStore.songs = [{ path: '/some/dir/a.flac', title: 'My Love', artist: 'Westlife' }]
    songStore.searchQuery = '不存在的歌'
    const w = mount(SongList)
    expect(w.find('[data-testid="empty-state"]').exists()).toBe(true)
    expect(w.text()).toContain('无匹配结果')
  })
})

describe('SongList — openFolder 走 dirty 拦截门（v1-ux-settings 2.3 补充接线测试）', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    songStore.folderPath = null
    songStore.songs = []
    songStore.searchQuery = ''
    songStore.selectedPath = null
    songStore.current = null
    songStore.original = null
    songStore.readonly = false
    songStore.saveState = 'idle'
    songStore.saveError = ''
    songStore.pendingAction = null
  })

  it('干净态点「打开文件夹」→ 直接换目录并替换列表，不弹窗（spec 无修改直接换）', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_last_dir') return null // 启动自动加载：无记忆 → 不自动加载
      if (cmd === 'pick_folder') return '/new/dir'
      if (cmd === 'list_songs') return [{ path: '/new/dir/a.flac', title: 'A', artist: 'AA' }]
      throw new Error(`unexpected cmd: ${cmd}`)
    })

    const w = mount(SongList)
    await w.get('button.open-btn').trigger('click')
    await flushPromises()

    expect(songStore.pendingAction).toBeNull() // 不弹窗
    expect(songStore.folderPath).toBe('/new/dir') // 直接换目录
    expect(songStore.songs).toEqual([{ path: '/new/dir/a.flac', title: 'A', artist: 'AA' }])
  })

  it('dirty 态点「打开文件夹」→ 进入 pending folder（复用同一弹窗），不立即换目录、编辑保留', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_last_dir') return null // 启动自动加载：无记忆 → 不自动加载
      if (cmd === 'pick_folder') return '/new/dir'
      throw new Error(`unexpected cmd: ${cmd}`)
    })
    songStore.folderPath = '/a'
    songStore.selectedPath = '/a/one.flac'
    songStore.current = { ...makeSong('/a/one.flac') }
    songStore.original = { ...makeSong('/a/one.flac') }
    songStore.current!.title = '改过'

    const w = mount(SongList)
    await w.get('button.open-btn').trigger('click')
    await flushPromises()

    expect(songStore.pendingAction).toMatchObject({ kind: 'folder', dir: '/new/dir' })
    expect(songStore.folderPath).toBe('/a') // 未换目录
    expect(songStore.current?.title).toBe('改过') // 编辑保留
    expect(mockInvoke).toHaveBeenCalledWith('pick_folder', undefined) // 只触发选择器
    expect(mockInvoke).not.toHaveBeenCalledWith('list_songs') // 未触发列表加载
  })

  it('dirty 态但用户取消原生选择器（pick_folder 返回 null）→ 无视，不弹窗不改状态', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_last_dir') return null // 启动自动加载：无记忆 → 不自动加载
      if (cmd === 'pick_folder') return null
      throw new Error(`unexpected cmd: ${cmd}`)
    })
    songStore.folderPath = '/a'
    songStore.selectedPath = '/a/one.flac'
    songStore.current = { ...makeSong('/a/one.flac') }
    songStore.original = { ...makeSong('/a/one.flac') }
    songStore.current!.title = '改过'

    const w = mount(SongList)
    await w.get('button.open-btn').trigger('click')
    await flushPromises()

    expect(songStore.pendingAction).toBeNull() // 用户已明确取消，不弹窗
    expect(songStore.folderPath).toBe('/a')
    expect(songStore.current?.title).toBe('改过')
  })
})

describe('SongList — 启动自动加载上次目录（dir-memory G4：onMounted getLastDir → initLastDir）', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    songStore.folderPath = null
    songStore.songs = []
    songStore.searchQuery = ''
    songStore.selectedPath = null
  })

  it('getLastDir 返回 null（无记忆/目录已删）→ 保持「未打开文件夹」空态、不加载列表', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_last_dir') return null
      throw new Error(`unexpected cmd: ${cmd}`)
    })

    const w = mount(SongList)
    await flushPromises()

    expect(mockInvoke).toHaveBeenCalledWith('get_last_dir', undefined) // 启动查询记忆
    expect(songStore.folderPath).toBeNull() // 保持空态
    expect(songStore.songs).toEqual([])
    expect(mockInvoke).not.toHaveBeenCalledWith('list_songs', expect.anything()) // 未触发列表加载
    expect(w.text()).toContain('未打开文件夹')
  })

  it('getLastDir 返回有效目录 → 启动自动加载并列出歌曲（等价自动点了打开文件夹）', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_last_dir') return '/music'
      if (cmd === 'list_songs') return [{ path: '/music/a.flac', title: 'A', artist: 'AA' }]
      throw new Error(`unexpected cmd: ${cmd}`)
    })

    const w = mount(SongList)
    await flushPromises()

    expect(songStore.folderPath).toBe('/music')
    expect(songStore.songs).toEqual([{ path: '/music/a.flac', title: 'A', artist: 'AA' }])
    expect(w.findAll('.song-row').length).toBe(1)
    expect(w.text()).toContain('A')
  })

  it('getLastDir IPC 异常 → 静默降级为无记忆空态（onMounted catch：不报错、不加载列表、不阻塞渲染）', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_last_dir') throw new Error('IPC failed')
      throw new Error(`unexpected cmd: ${cmd}`)
    })

    const w = mount(SongList)
    await flushPromises()

    expect(mockInvoke).toHaveBeenCalledWith('get_last_dir', undefined)
    expect(songStore.folderPath).toBeNull() // 保持「未打开文件夹」空态
    expect(songStore.songs).toEqual([])
    expect(mockInvoke).not.toHaveBeenCalledWith('list_songs', expect.anything()) // 未触发列表加载
    expect(w.text()).toContain('未打开文件夹')
    expect(w.text()).not.toContain('文件夹中没有音乐')
  })

  it('getLastDir 返回目录但 list_songs IPC 失败 → 启动自动加载失败静默降级（不 unhandled、保持空态）', async () => {
    // 失败路径（tester 审计）：启动自动加载的列表加载失败（list_songs IPC 异常）——
    // getLastDir 的 .catch 只兜 getLastDir 自身，initLastDir 的 rejection 在组件边界无 catch。
    // 期望：与「无记忆空态」同语义静默降级——folderPath 不残留半打开态、不产生 unhandled rejection。
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_last_dir') return '/music'
      if (cmd === 'list_songs') throw new Error('list_songs IPC failed')
      throw new Error(`unexpected cmd: ${cmd}`)
    })

    const w = mount(SongList)
    await flushPromises()

    expect(mockInvoke).toHaveBeenCalledWith('get_last_dir', undefined)
    expect(mockInvoke).toHaveBeenCalledWith('list_songs', { dir: '/music' })
    expect(songStore.folderPath).toBeNull() // 期望：启动失败 → 保持「未打开文件夹」空态（当前实现残留 '/music'，此断言失败即缺陷）
    expect(songStore.songs).toEqual([])
    expect(w.text()).toContain('未打开文件夹')
  })

  it('竞态（tester 审计）：启动自动加载 list_songs 慢 + 用户已手动换到新目录 + 启动加载随后失败 → 不得复位清掉手动目录', async () => {
    // 竞态守卫缺口：activateFolder 的 `folderPath !== dir` 守卫只护成功路径；失败路径上
    // SongList onMounted 的 `.catch` 无条件复位 folderPath=null/songs=[]——
    // 若启动自动加载（慢的 list_songs）在用户手动切到新目录**之后**才失败，
    // catch 会把手动切换的目录一并清掉（回归「未打开文件夹」空态，用户操作被吞）。
    // 期望：启动失败复位只应作用于仍处于启动目录的场景；用户已切走 → 不得动 manual 目录。
    let rejectStartup!: (e: Error) => void
    let resolveManual!: (v: unknown) => void
    let listCalls = 0
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'get_last_dir') return Promise.resolve('/music')
      if (cmd === 'pick_folder') return Promise.resolve('/manual')
      if (cmd === 'list_songs') {
        listCalls++
        if (listCalls === 1) {
          // 启动自动加载：慢，等测试手动 reject
          return new Promise((_, rej) => {
            rejectStartup = rej
          })
        }
        // 手动换目录：快，可手动 resolve
        return new Promise((res) => {
          resolveManual = res
        })
      }
      if (cmd === 'save_last_dir') return Promise.resolve(undefined)
      throw new Error(`unexpected cmd: ${cmd}`)
    })

    const w = mount(SongList)
    await flushPromises()
    // 启动自动加载已发起（folderPath='/music'，loadSongs in-flight）
    expect(songStore.folderPath).toBe('/music')

    // 用户手动打开新目录并成功加载
    await w.get('button.open-btn').trigger('click')
    await flushPromises()
    expect(songStore.folderPath).toBe('/manual')
    resolveManual([{ path: '/manual/x.flac', title: 'M', artist: 'MM' }])
    await flushPromises()
    expect(songStore.folderPath).toBe('/manual')
    expect(songStore.songs).toEqual([{ path: '/manual/x.flac', title: 'M', artist: 'MM' }])

    // 启动自动加载此刻才失败 → catch 复位
    rejectStartup(new Error('list_songs IPC failed'))
    await flushPromises()

    // 期望：用户手动目录不被启动失败复位吞掉（当前实现无条件 folderPath=null，此断言失败即缺陷）
    expect(songStore.folderPath).toBe('/manual')
    expect(songStore.songs).toEqual([{ path: '/manual/x.flac', title: 'M', artist: 'MM' }])
  })
})
