import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

// mock invoke，让组件点击保存走的默认 save（invokeCommand('save_song')) 在单测中成功。
// 经 vi.hoisted 暴露 mock 实例，供断言「EditorBar 保存按钮把 store.exportLrc 传给 save_song」。
const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}))

import type { Song } from '../api/types'
import { songStore } from '../store/song'
import CoverPanel from './CoverPanel.vue'
import Editor from './Editor.vue'
import EditorBar from './EditorBar.vue'
import FieldGrid from './FieldGrid.vue'
import FieldList from './FieldList.vue'
import LyricPanel from './LyricPanel.vue'

/** 构造一首完整标签的 Song（v1-song-read 契约形状）。 */
const makeSong = (over: Partial<Song> = {}): Song => ({
  path: '/a/song.flac',
  title: '歌名',
  artist: '作者',
  album: '',
  album_artist: '',
  track: '1',
  track_total: '10',
  year: '2020',
  genre: '',
  lyrics: '',
  lyrics_source: 'none',
  cover: null,
  cover_mime: null,
  ...over,
})

/** 打开一首歌进 store（等价 open() 成功态）。 */
function openSong(song: Song = makeSong()): void {
  songStore.current = { ...song }
  songStore.original = { ...song }
  songStore.readonly = false
  songStore.lyricsSource = song.lyrics_source
  songStore.selectedPath = song.path
  songStore.saveState = 'idle'
  songStore.saveError = ''
  songStore.pendingRename = null
  songStore.renameRejected = false
}

describe('Editor — 空态（spec: 未选中/未打开 → 右栏空态占位）', () => {
  beforeEach(() => {
    songStore.current = null
    songStore.original = null
    songStore.readonly = false
    songStore.selectedPath = null
  })

  it('current=null 且非只读 → 展示空态占位，不渲染表单', () => {
    const w = mount(Editor)
    expect(w.find('.editor-empty').exists()).toBe(true)
    expect(w.text()).toContain('从左侧选择一首歌曲')
    expect(w.find('.editor-body').exists()).toBe(false)
  })
})

describe('Editor — 坏标签只读（spec: 表单只读禁用 + 「标签损坏，只读」提示）', () => {
  beforeEach(() => {
    songStore.current = null
    songStore.original = null
    songStore.readonly = true
    songStore.lyricsSource = 'none'
    songStore.selectedPath = '/bad/broken.mp3'
  })

  it('readonly → 不进入可编辑表单（无 .editor-body），展示只读提示', () => {
    const w = mount(Editor)
    expect(w.find('.editor-empty').exists()).toBe(false)
    expect(w.find('.readonly-note').exists()).toBe(true)
    expect(w.text()).toContain('标签损坏，只读')
    expect(w.find('.editor-body').exists()).toBe(false)
    // EditorBar 也带只读态
    expect(w.findComponent(EditorBar).text()).toContain('✕ 标签损坏，只读')
  })
})

describe('Editor — 展示态（spec: 选中歌曲渲染编辑表单）', () => {
  beforeEach(() => openSong())

  it('渲染 EditorBar + 两列字段网格 + 歌词区', () => {
    const w = mount(Editor)
    expect(w.find('.editor-body').exists()).toBe(true)
    expect(w.findComponent(FieldGrid).exists()).toBe(true)
    expect(w.findComponent(LyricPanel).exists()).toBe(true)
    expect(w.find('.editor-empty').exists()).toBe(false)
  })
})

describe('EditorBar — 保存状态（spec: dirty 顶栏琥珀 / 只读 danger / 干净就绪）', () => {
  beforeEach(() => openSong())

  it('刚打开（clean）→ 「已就绪」', () => {
    const w = mount(EditorBar)
    expect(w.text()).toContain('已就绪')
    expect(w.find('.save-state.dirty').exists()).toBe(false)
  })

  it('编辑任一字段 → dirty 琥珀「有未保存的修改」', async () => {
    songStore.current!.title = '改过'
    const w = mount(EditorBar)
    expect(w.find('.save-state.dirty').exists()).toBe(true)
    expect(w.text()).toContain('有未保存的修改')
  })

  it('只读 → danger「✕ 标签损坏，只读」', () => {
    songStore.readonly = true
    const w = mount(EditorBar)
    expect(w.find('.save-state.readonly').exists()).toBe(true)
    expect(w.text()).toContain('✕ 标签损坏，只读')
  })

  it('展示「正在编辑: 文件名 + 作者」', () => {
    const w = mount(EditorBar)
    expect(w.text()).toContain('正在编辑:')
    expect(w.text()).toContain('song.flac')
    expect(w.text()).toContain('作者')
  })
})

describe('EditorBar — v1-song-save 保存状态渲染与按钮禁用（design.md D7/D9）', () => {
  beforeEach(() => openSong())

  const btn = (w: ReturnType<typeof mount>, cls: string) =>
    w.find(`button.${cls}`)

  it('saving → 「保存中…」+ 保存/撤销按钮都禁用', async () => {
    songStore.saveState = 'saving'
    const w = mount(EditorBar)
    expect(w.text()).toContain('保存中…')
    expect(btn(w, 'btn-primary').attributes('disabled')).toBeDefined()
    expect(btn(w, 'btn-ghost').attributes('disabled')).toBeDefined()
  })

  it('save_failed → 「✕ 保存失败：原因」+ 保存按钮可点（脏可重试）', async () => {
    songStore.current!.title = '改过'
    songStore.saveState = 'save_failed'
    songStore.saveError = '磁盘写入失败'
    const w = mount(EditorBar)
    expect(w.text()).toContain('✕ 保存失败：磁盘写入失败')
    expect(w.find('.save-state.failed').exists()).toBe(true)
    // 脏 = 可重试 → 保存按钮不禁用
    expect(btn(w, 'btn-primary').attributes('disabled')).toBeUndefined()
  })

  it('saved → 「✓ 已保存」绿（保存后 dirty=false）', async () => {
    songStore.saveState = 'saved'
    songStore.current = { ...songStore.original } // dirty 归 false
    const w = mount(EditorBar)
    expect(w.text()).toContain('✓ 已保存')
    expect(w.find('.save-state.saved').exists()).toBe(true)
    expect(w.find('.save-state.dirty').exists()).toBe(false)
  })

  it('保存成功后再编辑字段 → dirty 琥珀「有未保存的修改」（绝不假报已保存，FR-5.4a）', async () => {
    // 先构造「刚保存成功」态：saveState=saved 且 current=original（dirty=false）
    songStore.saveState = 'saved'
    songStore.current = { ...songStore.original }
    // 用户随后再编辑字段 → dirty 翻转，但 saveState 仍为 saved
    songStore.current!.title = '保存后又改'
    expect(songStore.dirty).toBe(true)
    expect(songStore.saveState).toBe('saved')
    const w = mount(EditorBar)
    // dirty 优先级高于 saved：琥珀提示，绝不显示「✓ 已保存」
    expect(w.find('.save-state.dirty').exists()).toBe(true)
    expect(w.text()).toContain('有未保存的修改')
    expect(w.find('.save-state.saved').exists()).toBe(false)
  })

  it('clean 且 idle → 「已就绪」，撤销/保存按钮都禁用（无修改）', () => {
    const w = mount(EditorBar)
    expect(w.text()).toContain('已就绪')
    expect(btn(w, 'btn-ghost').attributes('disabled')).toBeDefined()
    expect(btn(w, 'btn-primary').attributes('disabled')).toBeDefined()
  })

  it('编辑（dirty）→ 撤销/保存按钮可点', () => {
    songStore.current!.title = '改过'
    const w = mount(EditorBar)
    expect(btn(w, 'btn-ghost').attributes('disabled')).toBeUndefined()
    expect(btn(w, 'btn-primary').attributes('disabled')).toBeUndefined()
  })

  it('readonly → 保存按钮禁用（只读不可保存），撤销也禁用', () => {
    songStore.readonly = true
    songStore.saveState = 'idle'
    const w = mount(EditorBar)
    expect(btn(w, 'btn-primary').attributes('disabled')).toBeDefined()
    expect(btn(w, 'btn-ghost').attributes('disabled')).toBeDefined()
    expect(w.text()).toContain('✕ 标签损坏，只读')
  })

  it('点击保存 → 调用 store save()（IPC 注入为 resolve）', async () => {
    songStore.current!.title = '改过'
    const w = mount(EditorBar)
    // 直接验证按钮点击触发 store.save 到 saved 态（save 默认 invoke 已 mock 成功）
    await btn(w, 'btn-primary').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    expect(songStore.saveState).toBe('saved')
    expect(songStore.dirty).toBe(false)
  })

  it('点击撤销 → current 回到 original、dirty 归 false', async () => {
    songStore.current!.title = '改过'
    const original = { ...songStore.original }
    const w = mount(EditorBar)
    await w.find('button.btn-ghost').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    expect(songStore.current).toEqual(original)
    expect(songStore.dirty).toBe(false)
    expect(songStore.saveState).toBe('idle')
  })
})

describe('EditorBar — v1-lyrics-lrc exportLrc 接线（design.md D7：保存按钮传 songStore.exportLrc）', () => {
  beforeEach(() => {
    openSong(makeSong({ lyrics: '[00:00.00] 原词' }))
    songStore.current!.lyrics = '[00:00.00] 新词' // 制造 dirty
    mockInvoke.mockReset()
    mockInvoke.mockResolvedValue(undefined)
  })

  const clickSave = async () => {
    const w = mount(EditorBar)
    await w.find('button.btn-primary').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
  }
  const lastSaveSongArgs = (): Record<string, unknown> | undefined => {
    const call = mockInvoke.mock.calls.find((c) => c[0] === 'save_song')
    return call ? (call[1] as Record<string, unknown>) : undefined
  }

  it('勾选「同时保存为 .lrc」后点保存 → save_song 收到 exportLrc=true', async () => {
    songStore.exportLrc = true
    await clickSave()
    expect(songStore.saveState).toBe('saved')
    expect(lastSaveSongArgs()?.exportLrc).toBe(true)
  })

  it('未勾选点保存 → save_song 收到 exportLrc=false（opt-in，默认不导出）', async () => {
    songStore.exportLrc = false
    await clickSave()
    expect(songStore.saveState).toBe('saved')
    expect(lastSaveSongArgs()?.exportLrc).toBe(false)
  })
})

describe('EditorBar — exportLrc 独立导出门禁（CR 修复：D7 非脏但「勾选 + 歌词非空」放行保存）', () => {
  beforeEach(() => {
    // 核心场景：一首已含内嵌歌词、表单未编辑的歌（dirty=false），勾选「同时保存为 .lrc」后应能直接保存导出
    openSong(makeSong({ lyrics: '[00:00.00] 已内嵌歌词', lyrics_source: 'embedded' }))
    songStore.exportLrc = false
    mockInvoke.mockReset()
    mockInvoke.mockResolvedValue(undefined)
  })

  const saveBtn = (w: ReturnType<typeof mount>) => w.find('button.btn-primary')
  const lastSaveSongArgs = (): Record<string, unknown> | undefined => {
    const call = mockInvoke.mock.calls.find((c) => c[0] === 'save_song')
    return call ? (call[1] as Record<string, unknown>) : undefined
  }

  it('勾选 + 歌词非空（表单未编辑）→ 保存按钮可点（spec「勾选同步写」经 UI 可达）', () => {
    expect(songStore.dirty).toBe(false)
    songStore.exportLrc = true
    expect(songStore.dirty).toBe(false) // D7：复选框本身不是编辑内容，不脏表单
    const w = mount(EditorBar)
    expect(saveBtn(w).attributes('disabled')).toBeUndefined()
  })

  it('勾选但歌词为空 → 保存按钮仍禁用（空歌词不写 .lrc，无独立触发必要）', () => {
    openSong(makeSong({ lyrics: '' }))
    songStore.exportLrc = true
    const w = mount(EditorBar)
    expect(saveBtn(w).attributes('disabled')).toBeDefined()
  })

  it('未勾选且无字段编辑 → 保存按钮仍禁用（原 dirty 门禁保持）', () => {
    const w = mount(EditorBar)
    expect(saveBtn(w).attributes('disabled')).toBeDefined()
  })

  it('勾选 + 歌词非空 → 顶栏展示「待导出 .lrc」而非「已就绪」，且不是 dirty 琥珀', () => {
    songStore.exportLrc = true
    const w = mount(EditorBar)
    expect(w.text()).toContain('待导出 .lrc')
    expect(w.find('.save-state.dirty').exists()).toBe(false)
  })

  it('勾选 + 歌词非空、表单未编辑 → 点保存即独立导出：save_song 收到 exportLrc=true、saveState=saved', async () => {
    songStore.exportLrc = true
    const w = mount(EditorBar)
    await saveBtn(w).trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    expect(songStore.saveState).toBe('saved')
    expect(songStore.dirty).toBe(false)
    expect(lastSaveSongArgs()?.exportLrc).toBe(true)
  })

  it('导出保存成功后 → 展示「✓ 已保存」（exportLrc 保持勾选但已落盘）', async () => {
    songStore.exportLrc = true
    const w = mount(EditorBar)
    await saveBtn(w).trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    expect(songStore.saveState).toBe('saved')
    const w2 = mount(EditorBar)
    expect(w2.text()).toContain('✓ 已保存')
    expect(w2.text()).not.toContain('待导出 .lrc')
  })
})

describe('EditorBar — v1-rename-sync renamePending 保存门禁（design.md D5：纯改名独立触发保存）', () => {
  beforeEach(() => {
    openSong()
    songStore.pendingRename = null
    songStore.renameRejected = false
    mockInvoke.mockReset()
    mockInvoke.mockResolvedValue(undefined)
  })

  const saveBtn = (w: ReturnType<typeof mount>) => w.find('button.btn-primary')

  it('纯改名（dirty=false + renamePending=true）→ 保存按钮可点', () => {
    expect(songStore.dirty).toBe(false)
    songStore.pendingRename = '新歌.flac'
    const w = mount(EditorBar)
    expect(saveBtn(w).attributes('disabled')).toBeUndefined()
  })

  it('未改名且无字段编辑 → 保存按钮仍禁用（原 dirty 门禁保持）', () => {
    const w = mount(EditorBar)
    expect(saveBtn(w).attributes('disabled')).toBeDefined()
  })

  it('改名被拒后（renameRejected=true、pendingRename 保留）→ 保存按钮仍可点（换名后重存即完成改名）', () => {
    songStore.pendingRename = '撞名.flac'
    songStore.renameRejected = true
    const w = mount(EditorBar)
    expect(saveBtn(w).attributes('disabled')).toBeUndefined()
  })

  it('纯改名点保存 → store.save 走 rename 成功路径：saveState=saved、pendingRename 清空、path 同步', async () => {
    songStore.pendingRename = '新歌.flac'
    const w = mount(EditorBar)
    await saveBtn(w).trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    expect(songStore.saveState).toBe('saved')
    expect(songStore.pendingRename).toBeNull()
    expect(songStore.current!.path).toBe('/a/新歌.flac')
  })
})

describe('FieldGrid — 两列布局（spec: 左字段列 + 右封面区 `1fr 200px`）', () => {
  beforeEach(() => openSong())

  it('渲染左字段列 + 右封面区', () => {
    const w = mount(FieldGrid)
    const grid = w.find('.field-grid')
    expect(grid.exists()).toBe(true)
    expect(grid.findComponent(FieldList).exists()).toBe(true)
    expect(grid.findComponent(CoverPanel).exists()).toBe(true)
  })

  it('字段列含 8 个字段行（文件名/歌名/作者/专辑/专辑作者/音轨号/年份/流派）', () => {
    const w = mount(FieldGrid)
    const labels = w.findAll('.field-label').map((n) => n.text())
    expect(labels).toEqual([
      '文件名',
      '歌名',
      '作者',
      '专辑',
      '专辑作者',
      '音轨号',
      '年份',
      '流派',
    ])
  })

  it('字段输入框 v-model 绑 current（歌名显示当前值）', () => {
    songStore.current!.title = '新标题'
    const w = mount(FieldGrid)
    const titleInput = w
      .findAll('input')
      .find((i) => i.element.value === '新标题')
    expect(titleInput).toBeDefined()
  })
})

describe('CoverPanel — 封面预览与空态占位（spec: 封面 base64 data URL 渲染 / 无封面占位）', () => {
  beforeEach(() => openSong())

  it('有封面 → `<img>` 直接用 data URL 渲染', () => {
    openSong(makeSong({ cover: 'data:image/png;base64,AAAA', cover_mime: 'image/png' }))
    const w = mount(CoverPanel)
    const img = w.find('img.cover-img')
    expect(img.exists()).toBe(true)
    expect(img.attributes('src')).toBe('data:image/png;base64,AAAA')
    expect(w.find('.cover-empty').exists()).toBe(false)
    expect(w.text()).toContain('image/png')
  })

  it('无封面 → 虚线框空态占位 + 「点击选择 / 拖拽嵌入」提示 + MIME 未设置', () => {
    openSong(makeSong({ cover: null, cover_mime: null }))
    const w = mount(CoverPanel)
    expect(w.find('img.cover-img').exists()).toBe(false)
    expect(w.find('.cover-empty').exists()).toBe(true)
    expect(w.text()).toContain('点击选择 / 拖拽嵌入')
    expect(w.text()).toContain('未设置')
  })
})

describe('LyricPanel — 歌词区（spec: 来源 badge + 等宽 textarea 绑 current.lyrics）', () => {
  beforeEach(() => openSong())

  it('lyrics_source=embedded → badge「来源: 内嵌标签」', () => {
    openSong(makeSong({ lyrics_source: 'embedded', lyrics: '[00:00.00] 一行' }))
    const w = mount(LyricPanel)
    expect(w.text()).toContain('来源: 内嵌标签')
    const ta = w.find('textarea.lyrics-box')
    expect((ta.element as HTMLTextAreaElement).value).toBe('[00:00.00] 一行')
  })

  it('lyrics_source=none → badge「来源: 无」', () => {
    openSong(makeSong({ lyrics_source: 'none', lyrics: '' }))
    const w = mount(LyricPanel)
    expect(w.text()).toContain('来源: 无')
  })

  it('readonly → textarea disabled（坏标签只读态跟随）', () => {
    songStore.readonly = true
    const w = mount(LyricPanel)
    expect((w.find('textarea.lyrics-box').element as HTMLTextAreaElement).disabled).toBe(true)
  })
})

describe('FieldList 全字段行 — 字段值渲染（spec: 左列字段区 8 字段）', () => {
  beforeEach(() =>
    openSong(
      makeSong({
        title: 'T',
        artist: 'A',
        album: 'AL',
        album_artist: 'AA',
        track: '3',
        track_total: '12',
        year: '2021',
        genre: 'Pop',
      }),
    ),
  )

  it('文本字段输入框显示 current 对应值', () => {
    const w = mount(FieldList)
    const inputs = w.findAll('input')
    const byLabel = (label: string) => {
      const row = w.findAll('.field').find((f) => f.find('.field-label').text() === label)!
      return (row.find('input').element as HTMLInputElement).value
    }
    expect(byLabel('歌名')).toBe('T')
    expect(byLabel('作者')).toBe('A')
    expect(byLabel('专辑')).toBe('AL')
    expect(byLabel('专辑作者')).toBe('AA')
    expect(byLabel('年份')).toBe('2021')
    expect(byLabel('流派')).toBe('Pop')
    // 音轨号行：track / track_total 两个输入
    const trackRow = w.findAll('.field').find((f) => f.find('.field-label').text() === '音轨号')!
    const trackInputs = trackRow.findAll('input').map((i) => (i.element as HTMLInputElement).value)
    expect(trackInputs).toEqual(['3', '12'])
    // 文件名行：可编辑 input，显示 fileName(selectedPath)
    const fileRow = w.findAll('.field').find((f) => f.find('.field-label').text() === '文件名')!
    expect((fileRow.find('input').element as HTMLInputElement).value).toBe('song.flac')
  })
})
