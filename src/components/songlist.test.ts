// SongList 组件挂载回归测试（bug #27：模板里 computed 误写 `.value` 导致解包后崩溃）。
//
// 根因：`<script setup>` 模板中 computed 经 `$setup`(proxyRefs) 自动解包，
// `filteredSongs.value` 的 `.value` 取到 undefined → `.length` 抛 TypeError，
// 整个 SongList 渲染崩溃，表现为「打开文件夹后列表不显示」。
// 回归：v-else-if 分支求值 + v-for 渲染都必须用解包后的数组（去掉 `.value`）。
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import { songStore } from '../store/song'
import SongList from './SongList.vue'

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
