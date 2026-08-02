import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import type { Song } from '../lib/tauri'
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

describe('FieldGrid — 两列布局（spec: 左字段列 + 右封面区 `1fr 200px`）', () => {
  beforeEach(() => openSong())

  it('渲染左字段列 + 右封面区', () => {
    const w = mount(FieldGrid)
    const grid = w.find('.field-grid')
    expect(grid.exists()).toBe(true)
    expect(grid.findComponent(FieldList).exists()).toBe(true)
    expect(grid.findComponent(CoverPanel).exists()).toBe(true)
  })

  it('字段列含 8 个字段行（歌名/作者/专辑/专辑作者/音轨号/年份/流派/文件名）', () => {
    const w = mount(FieldGrid)
    const labels = w.findAll('.field-label').map((n) => n.text())
    expect(labels).toEqual([
      '歌名',
      '作者',
      '专辑',
      '专辑作者',
      '音轨号',
      '年份',
      '流派',
      '文件名',
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

  it('无封面 → 虚线框空态占位 + MIME 未设置', () => {
    openSong(makeSong({ cover: null, cover_mime: null }))
    const w = mount(CoverPanel)
    expect(w.find('img.cover-img').exists()).toBe(false)
    expect(w.find('.cover-empty').exists()).toBe(true)
    expect(w.text()).toContain('无封面')
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
    // 文件名行：只读 mono 展示
    const fileRow = w.findAll('.field').find((f) => f.find('.field-label').text() === '文件名')!
    expect(fileRow.find('.file-name').text()).toBe('song.flac')
  })
})
