<script setup lang="ts">
// 左栏（v1-folder-list）：顶部「打开文件夹」按钮 + 搜索框 + 展平列表。
// 数据流：invoke('pick_folder') → Rust 原生选择器 → None 无视 / Some(dir)
//   → store.folderPath = dir → invoke('list_songs', { dir }) → songs 整体替换、selectedPath 重置。
import { computed, onMounted, onUnmounted } from 'vue'

import { getLastDir, listSongs, pickFolder } from '../api/songs'
import type { MissingField } from '../api/types'
import { filteredSongs } from '../store/selectors'
import {
  closeMissingFilter,
  initLastDir,
  MISSING_FIELDS,
  openMissingFilter,
  requestFolder,
  scanMissing,
  setMissingChecks,
  songStore,
} from '../store/song'
import SongRow from './SongRow.vue'

/** 打开文件夹：选择 + 遍历 + 整体替换列表。
 *  v1-ux-settings：走 requestFolder（dirty 拦截门——有未保存修改时复用同一三选一弹窗）。 */
async function openFolder() {
  const picked = await pickFolder()
  if (picked === null) return // 取消，无视
  await requestFolder(picked, (dir) => listSongs(dir))
}

/** ⌘O / Ctrl+O 快捷键打开文件夹。 */
function onKeydown(e: KeyboardEvent) {
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

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  // dir-memory：启动自动加载上次目录——getLastDir() 无记忆/目录已删 → null → no-op 保持空态；
  // 非空 → initLastDir 复用 activateFolder 激活链路（列表加载、搜索重置语义）。不阻塞渲染，
  // 启动期用户手点打开与 getLastDir 竞态窗口极小（onMounted 立即触发、响应先于用户交互），不额外处理。
  void getLastDir()
    .then((dir) => {
      // falsy 统一守卫（null/undefined/'' 均 no-op）：目录已删/无记忆 → 保持「未打开文件夹」空态
      if (!dir) return
      // 启动自动加载 best-effort：initLastDir 复用 activateFolder 激活链路（含列表加载）。
      // rejection 兜底复位空态——list_songs IPC 失败时 activateFolder 已先设 folderPath
      // （半打开态 + 空列表，UI 会误显「文件夹中没有音乐」），此处复位为「未打开文件夹」
      // 空态，与无记忆空态同语义，且不产生 unhandled rejection（tester 审计）。
      // 竞态守卫（tester 审计）：仅当仍处于启动目录时才复位——用户已手动切到新目录
      // （启动 loadSongs 慢、晚于手动切换才失败）时，不得清掉手动切换的目录。
      return initLastDir(dir, (d) => listSongs(d)).catch(() => {
        if (songStore.folderPath === dir) {
          songStore.folderPath = null
          songStore.songs = []
        }
      })
    })
    .catch(() => {
      // 启动自动加载 best-effort：getLastDir IPC 异常 → 静默降级为无记忆空态（不阻塞渲染、不报错）
    })
})
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
