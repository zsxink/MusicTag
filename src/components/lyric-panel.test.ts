import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

// mock ../api/search → LyricPanel 经 store 动作（manualSearch/pickLyricCandidate）的默认注入兜底
// （api/client.ts 必须保留 `import { invoke } from '@tauri-apps/api/core'`，改源失效）。
const { mockSearchSongs, mockFetchLyric, mockSearchSource } = vi.hoisted(() => ({
  mockSearchSongs: vi.fn(async () => ({
    songs: [],
    source_stats: [
      ['netease', 0],
      ['qqmusic', 0],
      ['kugou', 0],
      ['lrclib', 0],
      ['itunes', 0],
    ],
    all_failed: false,
  })),
  mockFetchLyric: vi.fn(async () => null),
  mockSearchSource: vi.fn(async () => []),
}))
vi.mock('../api/search', () => ({
  searchSongs: mockSearchSongs,
  searchSource: mockSearchSource,
  fetchLyric: mockFetchLyric,
  downloadCover: vi.fn(async () => []),
}))

import type { Song, SongCandidate } from '../api/types'
import { songStore } from '../store/song'
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

const makeCand = (over: Partial<SongCandidate> = {}): SongCandidate => ({
  source: 'netease',
  id: 'n1',
  title: '歌名',
  artist: '作者',
  album: '专辑',
  cover_url: 'https://p1.music.126.net/1.jpg',
  ...over,
})

/** 打开一首歌进 store（等价 open() 成功态，含切歌重置搜索状态）。 */
function openSong(song: Song = makeSong()): void {
  songStore.current = { ...song }
  songStore.original = { ...song }
  songStore.readonly = false
  songStore.lyricsSource = song.lyrics_source
  songStore.selectedPath = song.path
  songStore.exportLrc = false
  songStore.saveState = 'idle'
  songStore.saveError = ''
  songStore.lyricSearchState = 'idle'
  songStore.lyricCandidates = []
  songStore.isOffline = false
  songStore.searchedThisSong = false
  songStore.lyricSourcePlatform = null
  songStore.lyricFetchEmpty = false
}

describe('LyricPanel — 来源 badge 三态（design.md D8 文案定稿）', () => {
  beforeEach(() => openSong())

  it('lyrics_source=embedded → 「来源: 内嵌标签」', () => {
    openSong(makeSong({ lyrics_source: 'embedded', lyrics: '[00:00.00] 内嵌' }))
    const w = mount(LyricPanel)
    expect(w.find('.badge').text()).toBe('来源: 内嵌标签')
  })

  it('lyrics_source=sidecar → 「来源: 侧载 .lrc」（D8：同名 .lrc 统一改文案）', () => {
    openSong(makeSong({ lyrics_source: 'sidecar', lyrics: '[00:00.00] 侧载' }))
    const w = mount(LyricPanel)
    expect(w.find('.badge').text()).toBe('来源: 侧载 .lrc')
    expect(w.text()).not.toContain('同名 .lrc') // 旧文案不得残留
  })

  it('lyrics_source=none → 「来源: 无」', () => {
    openSong(makeSong({ lyrics_source: 'none', lyrics: '' }))
    const w = mount(LyricPanel)
    expect(w.find('.badge').text()).toBe('来源: 无')
  })

  it('lyricSourcePlatform 非 null（点选候选平台）→ badge 优先显示平台（D8）', () => {
    openSong()
    songStore.lyricSourcePlatform = 'qqmusic'
    const w = mount(LyricPanel)
    expect(w.find('.badge').text()).toBe('来源: QQ音乐')
  })

  it('lyricSourcePlatform 覆盖内嵌来源显示平台（点选平台优先于原来源）', () => {
    openSong(makeSong({ lyrics_source: 'embedded', lyrics: '[00:00.00] 内嵌' }))
    songStore.lyricSourcePlatform = 'kugou'
    const w = mount(LyricPanel)
    expect(w.find('.badge').text()).toBe('来源: 酷狗')
  })
})

describe('LyricPanel — 「同时保存为 .lrc」复选框（design.md D7）', () => {
  beforeEach(() => openSong())

  it('默认不勾选（opt-in）：checkbox.checked=false 且 store.exportLrc=false', () => {
    const w = mount(LyricPanel)
    const cb = w.find('input[type="checkbox"]').element as HTMLInputElement
    expect(cb.checked).toBe(false)
    expect(songStore.exportLrc).toBe(false)
  })

  it('勾选 → 写入 songStore.exportLrc=true（v-model 绑 store，EditorBar 保存时读它）', async () => {
    const w = mount(LyricPanel)
    await w.find('input[type="checkbox"]').setValue(true)
    expect(songStore.exportLrc).toBe(true)
  })

  it('readonly → 复选框禁用（坏标签只读，无法 opt-in 导出）', () => {
    songStore.readonly = true
    const w = mount(LyricPanel)
    expect((w.find('input[type="checkbox"]').element as HTMLInputElement).disabled).toBe(true)
  })

  it('textarea 绑 current.lyrics（等宽 mono 正文，design.md §5）', () => {
    openSong(makeSong({ lyrics_source: 'embedded', lyrics: '[00:12.34] 你说你有点难追' }))
    const w = mount(LyricPanel)
    const ta = w.find('textarea.lyrics-box')
    expect((ta.element as HTMLTextAreaElement).value).toBe('[00:12.34] 你说你有点难追')
    // mono 等宽由 .lyrics-box 样式承载（design 原则 3：歌词正文 mono）
    expect(ta.classes()).toContain('lyrics-box')
  })
})

describe('LyricPanel — 歌词候选区（v1-search-ui D8：status/列表/空态/离线）', () => {
  beforeEach(() => {
    mockSearchSongs.mockReset()
    mockFetchLyric.mockReset()
    mockFetchLyric.mockResolvedValue(null)
    mockSearchSongs.mockResolvedValue({
      songs: [],
      source_stats: [
        ['netease', 0],
        ['qqmusic', 0],
        ['kugou', 0],
        ['lrclib', 0],
        ['itunes', 0],
      ],
    })
    openSong()
  })

  it('「搜索歌词」按钮可用性：readonly / 无歌禁用', () => {
    const w = mount(LyricPanel)
    expect((w.find('.search-trigger').element as HTMLButtonElement).disabled).toBe(false)

    songStore.current = null
    songStore.readonly = false
    const w2 = mount(LyricPanel)
    expect((w2.find('.search-trigger').element as HTMLButtonElement).disabled).toBe(true)

    songStore.current = { ...makeSong() }
    songStore.readonly = true
    const w3 = mount(LyricPanel)
    expect((w3.find('.search-trigger').element as HTMLButtonElement).disabled).toBe(true)
  })

  it('点击「搜索歌词」→ manualSearch 以 current 的 title/artist 发起', async () => {
    const w = mount(LyricPanel)
    await w.find('.search-trigger').trigger('click')
    await flushPromises()
    expect(mockSearchSongs).toHaveBeenCalledWith('歌名', '作者')
  })

  it('searching → 显示「搜索中…」+ 转圈（后台异步不阻塞编辑）', () => {
    songStore.lyricSearchState = 'searching'
    const w = mount(LyricPanel)
    const status = w.find('.cand-status')
    expect(status.exists()).toBe(true)
    expect(status.text()).toContain('搜索中…')
    expect(status.find('.spinner').exists()).toBe(true)
    // spec「后台异步不阻塞编辑」：搜索中 textarea 仍可编辑（仅 readonly 才禁用）
    expect((w.find('textarea.lyrics-box').element as HTMLTextAreaElement).disabled).toBe(false)
  })

  it('done 有候选 → 候选条列表（来源标签 + 歌名 — 作者，design §6.5）', () => {
    songStore.lyricSearchState = 'done'
    songStore.lyricCandidates = [
      makeCand({ source: 'netease', id: 'n1' }),
      makeCand({ source: 'qqmusic', id: 'q1', title: '另一首', artist: 'B' }),
    ]
    const w = mount(LyricPanel)
    const rows = w.findAll('.cand-row')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('网易云')
    expect(rows[0].text()).toContain('歌名 — 作者')
    expect(rows[1].text()).toContain('QQ音乐')
    expect(rows[1].text()).toContain('另一首 — B')
  })

  it('点选候选 → fetch_lyric 拉文本填入 current.lyrics + badge 更新为平台（D4，仍可编辑）', async () => {
    songStore.lyricSearchState = 'done'
    songStore.lyricCandidates = [makeCand({ source: 'netease', id: 'n1' })]
    mockFetchLyric.mockResolvedValue('[00:00.00] 点选来的歌词')
    const w = mount(LyricPanel)

    await w.find('.cand-row').trigger('click')
    await flushPromises()

    expect(mockFetchLyric).toHaveBeenCalledWith('netease', 'n1')
    expect(songStore.current!.lyrics).toBe('[00:00.00] 点选来的歌词')
    expect(songStore.lyricSourcePlatform).toBe('netease')
    expect(songStore.dirty).toBe(true)
    expect(w.find('.badge').text()).toBe('来源: 网易云')
  })

  it('done 无候选 → 空态「未找到匹配的歌词，可手动粘贴」', () => {
    songStore.lyricSearchState = 'done'
    songStore.lyricCandidates = []
    const w = mount(LyricPanel)
    expect(w.find('.cand-empty').text()).toBe('未找到匹配的歌词，可手动粘贴')
  })

  it('C2 全源取词失败（lyricFetchEmpty）→ 空态提示', () => {
    songStore.lyricFetchEmpty = true
    const w = mount(LyricPanel)
    expect(w.find('.cand-empty').text()).toBe('未找到匹配的歌词，可手动粘贴')
  })

  it('C2 真实流程空态（CR）：state=done + 候选仍在 + lyricFetchEmpty=true → 空态优先于候选列表', () => {
    // 真实流程：autoSearch 置 done 且填满候选 → 点选候选 → pickLyricCandidate 全源失败
    // 置 lyricFetchEmpty=true（state 仍是 'done'、候选仍在）。lyricFetchEmpty 分支必须先于 done 分支。
    songStore.lyricSearchState = 'done'
    songStore.lyricCandidates = [makeCand({ source: 'netease', id: 'n1' })]
    songStore.lyricFetchEmpty = true
    const w = mount(LyricPanel)
    expect(w.find('.cand-list').exists()).toBe(false) // 候选列表被空态遮蔽
    expect(w.find('.cand-empty').text()).toBe('未找到匹配的歌词，可手动粘贴')
  })

  it('undo 清 lyricFetchEmpty → 候选列表恢复可重选（D5：候选保留仍是当前歌）', () => {
    songStore.lyricSearchState = 'done'
    songStore.lyricCandidates = [makeCand({ source: 'netease', id: 'n1' })]
    songStore.lyricFetchEmpty = true
    const w1 = mount(LyricPanel)
    expect(w1.find('.cand-list').exists()).toBe(false) // 空态遮蔽候选

    songStore.lyricFetchEmpty = false // undo 语义（store undo 置 false、候选保留）
    const w2 = mount(LyricPanel)
    expect(w2.find('.cand-list').exists()).toBe(true) // 候选恢复可重选
  })

  it('手动搜索清 lyricFetchEmpty（CR）：新搜索后旧 C2 空态不遮蔽新候选', async () => {
    songStore.lyricSearchState = 'done'
    songStore.lyricCandidates = [makeCand()]
    songStore.lyricFetchEmpty = true // 上次 C2 全源失败残留
    mockSearchSongs.mockResolvedValue({
      songs: [makeCand()],
      source_stats: [
        ['netease', 1],
        ['qqmusic', 0],
        ['kugou', 0],
        ['lrclib', 0],
        ['itunes', 0],
      ],
    })

    const w = mount(LyricPanel)
    await w.find('.search-trigger').trigger('click')
    await flushPromises()

    expect(songStore.lyricFetchEmpty).toBe(false) // 新搜索作废旧空态
    expect(w.find('.cand-list').exists()).toBe(true) // 新候选展示，不残留旧空态
  })

  it('isOffline && idle → 「离线：仅手动填写」（候选区不出现，只留手动按钮）', () => {
    songStore.isOffline = true
    const w = mount(LyricPanel)
    expect(w.find('.cand-empty').text()).toBe('离线：仅手动填写')
    // 手动按钮仍可用（离线只禁自动搜索）
    expect((w.find('.search-trigger').element as HTMLButtonElement).disabled).toBe(false)
  })

  it('readonly（坏标签只读）→ 搜索按钮禁用、不触发搜索', async () => {
    songStore.readonly = true
    const w = mount(LyricPanel)
    expect((w.find('.search-trigger').element as HTMLButtonElement).disabled).toBe(true)
    await w.find('.search-trigger').trigger('click')
    await flushPromises()
    expect(mockSearchSongs).not.toHaveBeenCalled()
  })
})

describe('LyricPanel — 候选区折叠（candidate-collapse：默认展开、点击折叠、切歌后重置展开）', () => {
  beforeEach(() => {
    mockSearchSongs.mockReset()
    mockFetchLyric.mockReset()
    mockFetchLyric.mockResolvedValue(null)
    mockSearchSongs.mockResolvedValue({
      songs: [],
      source_stats: [
        ['netease', 0],
        ['qqmusic', 0],
        ['kugou', 0],
        ['lrclib', 0],
        ['itunes', 0],
      ],
    })
    openSong()
  })

  /** v-show 折叠只改 .cand-wrap 的内联 display（happy-dom 不计算样式，直接断言内联属性）。 */
  function candWrapDisplay(w: ReturnType<typeof mount>): string {
    return (w.find('.cand-wrap').element as HTMLElement).style.display
  }

  it('默认展开：done + 候选非空 → .cand-list 存在、.cand-wrap 无 display:none、按钮文案「隐藏候选 ▲」', () => {
    songStore.lyricSearchState = 'done'
    songStore.lyricCandidates = [makeCand()]
    const w = mount(LyricPanel)
    expect(w.find('.cand-list').exists()).toBe(true)
    expect(candWrapDisplay(w)).not.toBe('none') // v-show 未折叠（内联 display 无值）
    expect(w.find('.cand-toggle').text()).toContain('隐藏候选')
  })

  it('点击折叠 → .cand-wrap display:none、按钮文案「展开候选 ▼」', async () => {
    songStore.lyricSearchState = 'done'
    songStore.lyricCandidates = [makeCand()]
    const w = mount(LyricPanel)
    await w.find('.cand-toggle').trigger('click')
    expect(candWrapDisplay(w)).toBe('none')
    expect(w.find('.cand-toggle').text()).toContain('展开候选')
  })

  it('重新展开 → .cand-wrap 恢复显示、按钮文案「隐藏候选 ▲」', async () => {
    songStore.lyricSearchState = 'done'
    songStore.lyricCandidates = [makeCand()]
    const w = mount(LyricPanel)
    await w.find('.cand-toggle').trigger('click') // 收起
    expect(candWrapDisplay(w)).toBe('none')
    await w.find('.cand-toggle').trigger('click') // 再点展开
    expect(candWrapDisplay(w)).not.toBe('none')
    expect(w.find('.cand-toggle').text()).toContain('隐藏候选')
  })

  it('切歌后重置展开：收起后切到另一首歌（current.path 变）→ 默认展开', async () => {
    songStore.lyricSearchState = 'done'
    songStore.lyricCandidates = [makeCand()]
    const w = mount(LyricPanel)
    await w.find('.cand-toggle').trigger('click') // 收起
    expect(candWrapDisplay(w)).toBe('none')
    expect(w.find('.cand-toggle').text()).toContain('展开候选')

    // 真实切歌：current.path 变化（watch 重置折叠为默认展开）+ resetSearchState 清候选
    songStore.current = { ...makeSong({ path: '/b/song.flac' }) }
    songStore.lyricSearchState = 'done'
    songStore.lyricCandidates = [makeCand({ id: 'n2', title: '另一首' })]
    await w.vm.$nextTick()

    expect(candWrapDisplay(w)).not.toBe('none') // 已重置为默认展开
    expect(w.find('.cand-toggle').text()).toContain('隐藏候选')
  })

  it('切歌经过无内容中间态（resetSearchState 归 idle）→ 按钮暂隐、新歌候选到来默认展开', async () => {
    songStore.lyricSearchState = 'done'
    songStore.lyricCandidates = [makeCand()]
    const w = mount(LyricPanel)
    await w.find('.cand-toggle').trigger('click') // 收起

    // 切歌：current.path 变 → watch 重置折叠为默认展开；resetSearchState 清候选归 idle
    songStore.current = { ...makeSong({ path: '/b/song.flac' }) }
    songStore.lyricSearchState = 'idle'
    songStore.lyricCandidates = []
    await w.vm.$nextTick() // 等 DOM 更新再断言
    expect(w.find('.cand-toggle').exists()).toBe(false) // 无内容 → 按钮暂隐
    expect(candWrapDisplay(w)).not.toBe('none') // 折叠已重置为默认展开

    // 新歌搜索中 → 按钮再现（默认展开）
    songStore.lyricSearchState = 'searching'
    await w.vm.$nextTick()
    expect(w.find('.cand-toggle').exists()).toBe(true)
    expect(w.find('.cand-toggle').text()).toContain('隐藏候选')

    // 新歌候选到来 → 保持展开
    songStore.lyricSearchState = 'done'
    songStore.lyricCandidates = [makeCand({ id: 'n2', title: '另一首' })]
    await w.vm.$nextTick()
    expect(candWrapDisplay(w)).not.toBe('none')
    expect(w.find('.cand-toggle').text()).toContain('隐藏候选')
  })

  it('候选区无内容（idle 且无候选/非离线）→ 不显示折叠按钮、无占位', () => {
    const w = mount(LyricPanel)
    expect(w.find('.cand-toggle').exists()).toBe(false)
  })

  it('空态分支（done + 候选空）也算有内容 → 显示折叠按钮（spec「空态」属有内容）', () => {
    songStore.lyricSearchState = 'done'
    songStore.lyricCandidates = []
    const w = mount(LyricPanel)
    expect(w.find('.cand-empty').exists()).toBe(true) // 空态渲染
    expect(w.find('.cand-toggle').exists()).toBe(true) // 有内容 → 显示按钮
  })

  it('lyricFetchEmpty（C2 全源失败空态）→ 显示折叠按钮', () => {
    songStore.lyricFetchEmpty = true
    const w = mount(LyricPanel)
    expect(w.find('.cand-empty').exists()).toBe(true)
    expect(w.find('.cand-toggle').exists()).toBe(true)
  })

  it('默认展开（searching 未折叠）→ 候选区可见 + 按钮「隐藏候选 ▲」（spec Req 1：搜索中属「有内容」）', () => {
    songStore.lyricSearchState = 'searching'
    const w = mount(LyricPanel)
    expect(w.find('.cand-status').exists()).toBe(true)
    expect(candWrapDisplay(w)).not.toBe('none') // v-show 未折叠
    expect(w.find('.cand-toggle').text()).toContain('隐藏候选')
  })

  it('离线（网络失败路径）也算有内容 → 显示折叠按钮（spec Req 1/4：离线提示属「有内容」）', () => {
    songStore.isOffline = true
    const w = mount(LyricPanel)
    expect(w.find('.cand-empty').text()).toBe('离线：仅手动填写')
    expect(w.find('.cand-toggle').exists()).toBe(true) // 离线 → 按钮显示
  })

  it('折叠只翻转本地 ref：不触发 store 动作、不清候选、不重跑搜索（design 语义）', async () => {
    songStore.lyricSearchState = 'done'
    songStore.lyricCandidates = [makeCand()]
    const w = mount(LyricPanel)
    await w.find('.cand-toggle').trigger('click')
    // store 状态未被折叠改动：候选仍在、搜索状态不变、无搜索调用
    expect(songStore.lyricCandidates).toHaveLength(1)
    expect(songStore.lyricSearchState).toBe('done')
    expect(mockSearchSongs).not.toHaveBeenCalled()
    expect(w.find('.cand-list').exists()).toBe(true) // v-show 保留 DOM，仅 display:none
  })
})
