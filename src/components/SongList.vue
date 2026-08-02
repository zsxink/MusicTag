<script setup lang="ts">
// 左栏（v1-folder-list）：顶部「打开文件夹」按钮 + 搜索框 + 展平列表。
// 数据流：invoke('pick_folder') → Rust 原生选择器 → None 无视 / Some(dir)
//   → store.folderPath = dir → invoke('list_songs', { dir }) → songs 整体替换、selectedPath 重置。
import { onMounted, onUnmounted } from 'vue'

import { invokeCommand } from '../lib/tauri'
import { activateFolder, filteredSongs, songStore } from '../store/song'
import SongRow from './SongRow.vue'

/** 打开文件夹：选择 + 遍历 + 整体替换列表（编排在 store.activateFolder）。 */
async function openFolder() {
  const picked = await invokeCommand<string | null>('pick_folder')
  if (picked === null) return // 取消，无视
  await activateFolder(picked, (dir) =>
    invokeCommand<typeof songStore.songs>('list_songs', { dir }),
  )
}

/** ⌘O / Ctrl+O 快捷键打开文件夹。 */
function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && (e.key === 'o' || e.key === 'O')) {
    e.preventDefault()
    openFolder()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <aside class="song-list">
    <div class="list-head">
      <button class="open-btn" type="button" @click="openFolder">打开文件夹</button>
      <input
        v-model="songStore.searchQuery"
        class="search-input"
        type="text"
        placeholder="搜索歌名 / 作者"
      />
    </div>

    <!-- 空态：未打开文件夹 -->
    <div v-if="songStore.folderPath === null" class="empty">
      <span class="empty-icon" aria-hidden="true">🗂️</span>
      <p class="empty-title">未打开文件夹</p>
      <p class="empty-desc">点击上方「打开文件夹」选择本地音乐文件夹</p>
    </div>

    <!-- 空文件夹 / 无匹配 -->
    <div
      v-else-if="filteredSongs.length === 0"
      class="empty"
      data-testid="empty-state"
    >
      <span class="empty-icon" aria-hidden="true">🎵</span>
      <p class="empty-title">
        {{ songStore.songs.length === 0 ? '文件夹中没有音乐' : '无匹配结果' }}
      </p>
      <p class="empty-desc">
        {{
          songStore.songs.length === 0
            ? '当前文件夹没有 .flac / .mp3 文件'
            : '换个关键词试试'
        }}
      </p>
    </div>

    <!-- 列表 -->
    <ul v-else class="list">
      <SongRow v-for="song in filteredSongs" :key="song.path" :song="song" />
    </ul>
  </aside>
</template>

<style scoped>
.song-list {
  display: flex;
  flex-direction: column;
  width: 280px;
  min-width: 200px;
  background: var(--panel);
  border-right: 1px solid var(--border);
  flex: 0 0 auto;
}

.list-head {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border-bottom: 1px solid var(--border);
}

.open-btn {
  padding: 8px 10px;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 6px;
  font-weight: 600;
}

.open-btn:hover {
  background: var(--hover);
}

.search-input {
  width: 100%;
  padding: 7px 10px;
  font-size: 12px;
  font-family: inherit;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
}

.search-input::placeholder {
  color: var(--text-dim);
}

.search-input:focus {
  outline: none;
  border-color: var(--accent);
}

/* ---------- 空状态（design.md §6.1：图标 40px 35% 透明 + 标题 + 副说明） ---------- */
.empty {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 24px;
  color: var(--text-dim);
  text-align: center;
}

.empty-icon {
  font-size: 40px;
  line-height: 1;
  opacity: 0.35;
}

.empty-title {
  color: var(--text-dim);
  font-weight: 600;
  font-size: 13px;
}

.empty-desc {
  font-size: 11.5px;
  max-width: 200px;
}

/* ---------- 列表 ---------- */
ul {
  list-style: none;
  overflow-y: auto;
  flex: 1 1 auto;
  min-height: 0;
  padding: 6px;
}
</style>