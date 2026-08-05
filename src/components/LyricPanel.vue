<script setup lang="ts">
// 歌词区（design.md §5 lyrics + v1-search-ui D8）：
// - head 行（来源 badge + 「同时保存为 .lrc」opt-in）+ 等宽 textarea。
// - 来源 badge：`lyricSourcePlatform` 非 null（点选候选平台）优先 → 「来源: 网易云/QQ音乐/酷狗/LRCLIB/iTunes」，
//   否则沿用 `lyricsSource` 映射（内嵌标签 / 侧载 .lrc / 无）。
// - 「搜索歌词」手动按钮（design §6.2，head 与 textarea 之间）：readonly（坏标签只读）/ 无歌禁用；
//   点击 → store.manualSearch('lyrics')（无视离线 / 缺失判定，随时可发起）。
// - 候选区（D8）：searching → 「搜索中…」+ 转圈（后台异步不阻塞编辑）；done 有候选 → 候选条列表；
//   done 无 → 空态；C2 全源取词失败（lyricFetchEmpty）→ 「未找到匹配的歌词，可手动粘贴」；
//   离线（isOffline && idle）→ 「离线：仅手动填写」。
// - 渲染优先级（CR C2）：`lyricFetchEmpty` 分支必须**先于** done 分支——真实流程里
//   pickLyricCandidate 全源失败置 lyricFetchEmpty 时 `lyricSearchState` 仍是 'done'、候选仍在，
//   若空态分支排在 done 之后则永远不可达。manualSearch 清 lyricFetchEmpty，新搜索不残留旧空态。
// 分层：组件不直呼 invoke（store 动作注入 api/search 默认），零 invoke 直呼（layering 守卫）。
import { computed, ref } from 'vue'

import { sourceLabel } from '../store/selectors'
import { manualSearch, songStore } from '../store/song'
import LyricCandidate from './LyricCandidate.vue'

/** 来源 badge 文案（D8：点选候选平台优先，否则 lyrics_source 映射）。 */
const badgeText = computed(() => {
  if (songStore.lyricSourcePlatform !== null) {
    return `来源: ${sourceLabel(songStore.lyricSourcePlatform)}`
  }
  switch (songStore.lyricsSource) {
    case 'embedded':
      return '来源: 内嵌标签'
    case 'sidecar':
      return '来源: 侧载 .lrc'
    default:
      return '来源: 无'
  }
})

/** 「搜索歌词」可用性：readonly（坏标签只读）/ 无歌禁用。 */
const canSearch = computed(() => !songStore.readonly && songStore.current !== null)

// 候选区折叠（candidate-collapse）：组件局部 ref，跨切歌保持（面板常驻不销毁，resetSearchState
// 只清 store 候选内容、不动本 ref）；仅换目录/清空当前歌卸载面板才重置为默认展开。
const candidatesCollapsed = ref(false)
function toggleCandidates(): void {
  candidatesCollapsed.value = !candidatesCollapsed.value
}
/** 候选区有内容才显示折叠按钮——与模板 v-if 分支（searching / lyricFetchEmpty / done+候选(含空态) / 离线）逐条对齐。 */
const candidatesVisible = computed(
  () =>
    songStore.lyricSearchState === 'searching'
    || songStore.lyricFetchEmpty
    || (songStore.lyricSearchState === 'done' && songStore.lyricCandidates.length > 0)
    || (songStore.lyricSearchState === 'done' && songStore.lyricCandidates.length === 0)
    || songStore.isOffline,
)
</script>

<template>
  <section class="lyrics">
    <div class="lyrics-head">
      <span class="label">歌词</span>
      <span class="badge">{{ badgeText }}</span>
      <!-- 「同时保存为 .lrc」opt-in（design.md D7）：v-model 绑 store.exportLrc，readonly 禁用 -->
      <label class="export-lrc">
        <input
          type="checkbox"
          v-model="songStore.exportLrc"
          :disabled="songStore.readonly"
        />
        同时保存为 .lrc
      </label>
    </div>

    <!-- 「搜索歌词」手动按钮（design §6.2：head 与 textarea 之间） -->
    <button
      class="search-trigger"
      type="button"
      :disabled="!canSearch"
      @click="manualSearch('lyrics')"
    >🔍 搜索歌词</button>

    <!-- 候选区折叠按钮（candidate-collapse）：候选区有内容才显示；折叠只做 v-show 包装，不动候选 DOM/搜索状态 -->
    <button
      v-if="candidatesVisible"
      class="cand-toggle"
      type="button"
      @click="toggleCandidates"
    >{{ candidatesCollapsed ? '展开候选 ▼' : '隐藏候选 ▲' }}</button>

    <!-- 歌词候选区（D8），cand-collapse 外层 v-show 容器（仅显示/隐藏，不改内部 v-if/v-else 结构） -->
    <div class="cand-wrap" v-show="!candidatesCollapsed">
      <div v-if="songStore.lyricSearchState === 'searching'" class="cand-status">
        搜索中…<span class="spinner" aria-hidden="true"></span>
      </div>
      <!-- C2 全源取词失败（lyricFetchEmpty）须先于 done 分支：pickLyricCandidate 置它时 state 仍是
           'done'，排在 done 之后会被候选列表遮蔽（CR C2）。manualSearch 会清 lyricFetchEmpty。 -->
      <div v-else-if="songStore.lyricFetchEmpty" class="cand-empty">未找到匹配的歌词，可手动粘贴</div>
      <template v-else-if="songStore.lyricSearchState === 'done'">
        <div v-if="songStore.lyricCandidates.length" class="cand-list">
          <LyricCandidate
            v-for="c in songStore.lyricCandidates"
            :key="`${c.source}:${c.id}`"
            :cand="c"
          />
        </div>
        <div v-else class="cand-empty">未找到匹配的歌词，可手动粘贴</div>
      </template>
      <div v-else-if="songStore.isOffline" class="cand-empty">离线：仅手动填写</div>
    </div>

    <textarea
      v-if="songStore.current"
      v-model="songStore.current.lyrics"
      class="lyrics-box"
      placeholder="粘贴歌词，可带时间轴（[00:11.32] …）"
      spellcheck="false"
      :disabled="songStore.readonly"
    ></textarea>
  </section>
</template>

<style scoped>
.lyrics {
  border-top: 1px solid var(--border);
  padding-top: 16px;
}

.lyrics-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.label {
  font-weight: 600;
  font-size: 13px;
}

.badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  color: var(--text-dim);
}

.export-lrc {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  color: var(--text-dim);
  cursor: pointer;
  user-select: none;
}

.export-lrc input[type='checkbox'] {
  accent-color: var(--accent);
  cursor: pointer;
}

.export-lrc:has(input:disabled) {
  opacity: 0.5;
  cursor: not-allowed;
}

.export-lrc input:disabled {
  cursor: not-allowed;
}

/* design §6.2：虚线全宽触发按钮 */
.search-trigger {
  margin-bottom: 10px;
  width: 100%;
  padding: 6px 0;
  background: transparent;
  border: 1px dashed var(--border);
  border-radius: 6px;
  color: var(--text-dim);
  font-size: 11.5px;
  transition: border-color 0.12s, color 0.12s, transform 0.05s;
}

.search-trigger:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}

.search-trigger:active {
  transform: translateY(1px);
}

.search-trigger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

/* 候选区折叠按钮（candidate-collapse）：对齐 .search-trigger 克制风格，尺寸更小；
   歌词区 head 与 textarea 之间，margin-top: 0 */
.cand-toggle {
  margin: 0 0 10px;
  padding: 3px 10px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-dim);
  font-size: 11px;
  cursor: pointer;
}

.cand-toggle:hover {
  color: var(--accent);
  border-color: var(--accent);
}

/* design §6.3：搜索中状态（居中 dim 文字 + 10×10 转圈） */
.cand-status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 0 10px;
  font-size: 11.5px;
  color: var(--text-dim);
}

.spinner {
  width: 10px;
  height: 10px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* design §6.5：歌词候选列表（每条顶部间距 6px） */
.cand-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 10px;
}

/* design §6.6：候选空态 */
.cand-empty {
  padding: 8px 0 10px;
  text-align: center;
  font-size: 11px;
  color: var(--text-dim);
}

.lyrics-box {
  width: 100%;
  min-height: 360px;
  resize: vertical;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  color: var(--text);
  font-family: var(--mono);
  font-size: 12.5px;
  line-height: 1.8;
  padding: 12px 14px;
  outline: none;
  transition: border-color 0.12s;
}

.lyrics-box:focus {
  border-color: var(--accent);
}

.lyrics-box::placeholder {
  color: var(--text-dim);
}

.lyrics-box:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
