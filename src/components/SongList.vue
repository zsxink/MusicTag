<script setup lang="ts">
// 左栏（v1-folder-list）：顶部「打开文件夹」按钮 + 搜索框 + 展平列表。
// 数据流：invoke('pick_folder') → Rust 原生选择器 → None 无视 / Some(dir)
//   → store.folderPath = dir → invoke('list_songs', { dir }) → songs 整体替换、selectedPath 重置。
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'

import { getLastDir, listSongs, pickFolder } from '../api/songs'
import type { MissingField } from '../api/types'
import { filteredSongs } from '../store/selectors'
import {
  closeMissingFilter,
  initLastDir,
  MISSING_FIELDS,
  openMissingFilter,
  requestFolder,
  refreshFolder,
  resetFailedStartupFolder,
  startFolderWatching,
  stopFolderWatching,
  scanMissing,
  setMissingChecks,
  songStore,
} from '../store/song'
import SongRow from './SongRow.vue'

/** 打开文件夹：选择 + 遍历 + 整体替换列表。
 *  v1-ux-settings：走 requestFolder（dirty 拦截门——有未保存修改时复用同一三选一弹窗）。 */
async function openFolder() {
  try {
    const picked = await pickFolder()
    if (picked === null || !mounted) return
    await requestFolder(picked, (dir) => listSongs(dir))
  } catch (error) {
    songStore.folderRefreshError = `打开文件夹失败：${error instanceof Error ? error.message : String(error)}`
  }
}

/** ⌘O / Ctrl+O 快捷键打开文件夹。 */
function onKeydown(e: KeyboardEvent) {
  if (menuOpen.value && e.key === 'Escape') {
    e.preventDefault()
    closeMenu(true)
  }
  if (menuOpen.value && e.key === 'Tab') closeMenu(false)
  if ((e.metaKey || e.ctrlKey) && (e.key === 'o' || e.key === 'O')) {
    e.preventDefault()
    openFolder()
  }
}

const missingLabels: Record<MissingField, string> = {
  title: '歌名',
  artist: '歌手',
  album: '专辑',
  cover: '封面',
  lyrics: '歌词',
}

function isMissingChecked(field: MissingField): boolean {
  return songStore.missingChecks.includes(field)
}

function toggleMissingField(field: MissingField, event: Event): void {
  const checked = (event.target as HTMLInputElement).checked
  const next = songStore.missingChecks.filter((item) => item !== field)
  if (checked) next.push(field)
  void setMissingChecks(next)
}

function retryMissingScan(): void {
  void scanMissing()
}

const missingEmptyState = computed(() => {
  if (
    !songStore.missingFilterEnabled ||
    songStore.missingScanState !== 'done' ||
    songStore.searchQuery.trim() !== ''
  ) {
    return null
  }
  if (Object.keys(songStore.missingByPath).length > 0) return null
  if (songStore.missingScanErrors.length > 0) {
    return {
      title: '扫描结果不完整',
      description: '部分歌曲读取失败，请查看上方提示后重试。',
    }
  }
  return {
    title: '没有缺失所选字段的歌曲',
    description: '当前文件夹没有缺少所选字段的歌曲',
  }
})

let mounted = false
const listArea = ref<HTMLElement | null>(null)
const menu = ref<HTMLElement | null>(null)
const refreshButton = ref<HTMLButtonElement | null>(null)
const menuOpen = ref(false)
const menuPosition = ref({ left: '0px', top: '0px' })
let menuOrigin: HTMLElement | null = null

function closeMenu(restoreFocus = false): void {
  menuOpen.value = false
  if (restoreFocus) menuOrigin?.focus()
}

function showMenu(event: MouseEvent | KeyboardEvent): void {
  event.preventDefault()
  menuOrigin = document.activeElement instanceof HTMLElement ? document.activeElement : listArea.value
  const rect = listArea.value?.getBoundingClientRect()
  const x = event instanceof MouseEvent ? event.clientX : (rect?.left ?? 0) + 12
  const y = event instanceof MouseEvent ? event.clientY : (rect?.top ?? 0) + 12
  menuPosition.value = {
    left: `${Math.max(0, Math.min(x, window.innerWidth - 140))}px`,
    top: `${Math.max(0, Math.min(y, window.innerHeight - 50))}px`,
  }
  menuOpen.value = true
  void nextTick(() => refreshButton.value?.focus())
}

function onListKeydown(event: KeyboardEvent): void {
  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) showMenu(event)
}

function onOutsidePointer(event: PointerEvent): void {
  if (menuOpen.value && !menu.value?.contains(event.target as Node)) closeMenu()
}

function manualRefresh(): void {
  closeMenu(true)
  void refreshFolder()
}

onMounted(() => {
  mounted = true
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('pointerdown', onOutsidePointer)
  const startupEpoch = songStore.folderEpoch
  void (async () => {
    // 事件订阅先就绪；目录恢复与手动打开共用 store 的 epoch/监听链路。
    await startFolderWatching()
    if (!mounted || songStore.folderEpoch !== startupEpoch || songStore.folderPath !== null) return
    const dir = await getLastDir()
    if (!mounted || songStore.folderEpoch !== startupEpoch || songStore.folderPath !== null || !dir) return
    const loading = initLastDir(dir, listSongs)
    const loadingEpoch = songStore.folderEpoch
    try {
      await loading
    } catch {
      if (mounted) resetFailedStartupFolder(loadingEpoch)
    }
  })().catch(() => {})
})
onUnmounted(() => {
  mounted = false
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('pointerdown', onOutsidePointer)
  stopFolderWatching()
})

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
      <button
        class="missing-filter-btn"
        type="button"
        :disabled="songStore.folderPath === null"
        @click="openMissingFilter()"
      >
        筛选缺失
      </button>
    </div>

    <div v-if="songStore.missingFilterEnabled" class="missing-panel" data-testid="missing-panel">
      <div class="missing-panel-head">
        <span>缺失字段</span>
        <span class="missing-head-actions">
          <!-- 刷新：常驻入口，复用 retryMissingScan → scanMissing（missing-filter-refresh #129）。
               禁挂 .missing-close-btn class（songlist.test.ts 唯一选择器要求）。 -->
          <button
            class="missing-refresh-btn"
            type="button"
            data-testid="missing-refresh-btn"
            @click="retryMissingScan"
          >
            刷新
          </button>
          <button class="missing-close-btn" type="button" @click="closeMissingFilter">关闭</button>
        </span>
      </div>
      <label v-for="field in MISSING_FIELDS" :key="field" class="missing-check">
        <input
          type="checkbox"
          :checked="isMissingChecked(field)"
          @change="toggleMissingField(field, $event)"
        />
        <span>{{ missingLabels[field] }}</span>
      </label>
      <p v-if="songStore.missingScanState === 'scanning'" class="missing-status">
        正在扫描缺失字段…
      </p>
      <p v-else-if="songStore.missingScanState === 'error'" class="missing-status missing-error">
        扫描失败：{{ songStore.missingScanError }}
        <button class="missing-retry-btn" type="button" @click="retryMissingScan">重试</button>
      </p>
      <p v-if="songStore.missingScanState === 'done' && songStore.missingScanErrors.length > 0" class="missing-status">
        {{ songStore.missingScanErrors.length }} 首歌曲读取失败，已保留其他结果
      </p>
    </div>

    <p v-if="songStore.folderWatchError || songStore.folderRefreshError" class="folder-error" role="status">
      <span v-if="songStore.folderWatchError">{{ songStore.folderWatchError }}</span>
      <span v-if="songStore.folderRefreshError">{{ songStore.folderRefreshError }}</span>
      <button type="button" :disabled="songStore.folderPath === null" @click="manualRefresh">重试刷新</button>
    </p>

    <div ref="listArea" class="list-area" tabindex="0" aria-label="歌曲列表" aria-haspopup="menu"
      @contextmenu="showMenu" @keydown="onListKeydown">
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
        {{
          missingEmptyState?.title
            ? missingEmptyState.title
            : songStore.songs.length === 0
              ? '文件夹中没有音乐'
              : '无匹配结果'
        }}
      </p>
      <p class="empty-desc">
        {{
          missingEmptyState?.description
            ? missingEmptyState.description
            : songStore.songs.length === 0
              ? '当前文件夹没有 .flac / .mp3 文件'
              : '换个关键词试试'
        }}
      </p>
    </div>

    <!-- 列表 -->
    <ul v-else class="list">
      <SongRow
        v-for="song in filteredSongs"
        :key="song.path"
        :song="song"
        :missing="songStore.missingByPath[song.path]"
      />
    </ul>
    </div>
    <div v-if="menuOpen" ref="menu" class="list-menu" role="menu" aria-label="歌曲列表操作" :style="menuPosition">
      <button ref="refreshButton" role="menuitem" type="button" :disabled="songStore.folderPath === null"
        @click="manualRefresh" @keydown.down.prevent="refreshButton?.focus()" @keydown.up.prevent="refreshButton?.focus()">刷新</button>
    </div>
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

.list-area {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}
.list-area:focus-visible { outline: 1px solid var(--accent); outline-offset: -1px; }
.list-menu {
  position: fixed;
  z-index: 100;
  min-width: 130px;
  padding: 4px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
}
.list-menu button {
  width: 100%;
  padding: 8px 12px;
  text-align: left;
  color: var(--text);
  background: transparent;
  border: 0;
  border-radius: 3px;
}
.list-menu button:hover:not(:disabled), .list-menu button:focus-visible { background: var(--hover); }
.list-menu button:disabled { opacity: 0.5; }
.folder-error {
  display: grid;
  gap: 4px;
  padding: 8px 10px;
  color: var(--danger, #e57373);
  font-size: 12px;
}
.folder-error button { justify-self: start; color: inherit; }

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
  transition: background 0.12s, border-color 0.12s;
}

.open-btn:hover {
  background: var(--hover);
}

.open-btn:active {
  transform: translateY(1px);
}

.missing-filter-btn,
.missing-close-btn,
.missing-retry-btn,
.missing-refresh-btn {
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--text-dim);
  font-size: 12px;
  cursor: pointer;
}

.missing-filter-btn:hover:not(:disabled),
.missing-close-btn:hover,
.missing-retry-btn:hover,
.missing-refresh-btn:hover {
  color: var(--text);
  background: var(--hover);
}

.missing-filter-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.missing-panel {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px 10px;
  padding: 9px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--panel-2);
}

.missing-panel-head,
.missing-status {
  grid-column: 1 / -1;
}

.missing-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
}

.missing-head-actions {
  display: flex;
  gap: 6px;
}

.missing-check {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-dim);
  font-size: 12px;
}

.missing-check input {
  accent-color: var(--accent);
}

.missing-status {
  margin: 2px 0 0;
  color: var(--text-dim);
  font-size: 11px;
  line-height: 1.4;
}

.missing-error {
  color: var(--danger, #e57373);
}

.missing-retry-btn {
  margin-left: 5px;
  padding: 3px 6px;
  color: inherit;
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

/* ---------- 空状态（design.md §6.1：图标 40px 35% 透明 + 标题 + 副说明统一） ---------- */
.empty {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
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
  color: var(--text);
  font-weight: 600;
  font-size: 15px;
}

.empty-desc {
  font-size: 12px;
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
