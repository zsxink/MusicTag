<script setup lang="ts">
// 编辑顶栏（design.md §5 editor-bar）：正在编辑 + 保存状态 + 保存/撤销。
// v1-song-save 接入保存状态机：dirty 琥珀 / 保存中 / ✓ 已保存 绿 / ✕ 保存失败：原因。
// 保存状态由 readonly/dirty/saveState 三者合成（design.md D7，saveState 只存动作态）。
import { fileName, save, songStore, undo } from '../store/song'

// 保存中：为 true 时保存/撤销按钮均禁用（design.md D6 防连点并发写同一文件）
const saving = () => songStore.saveState === 'saving'
</script>

<template>
  <div class="editor-bar">
    <div class="now">
      <span class="now-title">正在编辑: <span class="now-file" :title="songStore.selectedPath ?? ''">{{ fileName(songStore.selectedPath ?? '') }}</span></span>
      <span v-if="songStore.current?.artist" class="now-artist">{{ songStore.current.artist }}</span>
    </div>

    <!-- 保存状态（readonly > saving > save_failed > saved > dirty > 已就绪，design.md D7 优先级） -->
    <span v-if="songStore.readonly" class="save-state readonly" role="alert">✕ 标签损坏，只读</span>
    <span v-else-if="songStore.saveState === 'saving'" class="save-state saving">保存中…</span>
    <span v-else-if="songStore.saveState === 'save_failed'" class="save-state failed" role="alert">✕ 保存失败：{{ songStore.saveError }}</span>
    <span v-else-if="songStore.saveState === 'saved'" class="save-state saved">✓ 已保存</span>
    <span v-else-if="songStore.dirty" class="save-state dirty">有未保存的修改</span>
    <span v-else class="save-state">已就绪</span>

    <!-- 撤销 / 保存（design.md D9 接语义） -->
    <div class="editor-actions">
      <button
        class="btn btn-ghost"
        type="button"
        :disabled="!songStore.dirty || saving()"
        @click="undo"
      >撤销</button>
      <button
        class="btn btn-primary"
        type="button"
        :disabled="!songStore.dirty || saving() || songStore.readonly"
        @click="save()"
      >保存</button>
    </div>
  </div>
</template>

<style scoped>
.editor-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--panel-2);
  flex: 0 0 auto;
}

.now {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.now-title {
  font-weight: 700;
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 文件名 mono（design 原则 3：路径/数据用等宽） */
.now-file {
  font-family: var(--mono);
  font-weight: 400;
  font-size: 12.5px;
  color: var(--text);
}

.now-artist {
  flex: 0 0 auto;
  color: var(--text-dim);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 160px;
}

.save-state {
  font-size: 11.5px;
  color: var(--text-dim);
  white-space: nowrap;
  flex: 0 0 auto;
}

.save-state.dirty {
  color: var(--accent);
}

.save-state.saved {
  color: var(--success);
  font-weight: 600;
}

.save-state.readonly,
.save-state.failed {
  color: var(--danger);
  font-weight: 600;
}

.editor-actions {
  display: flex;
  gap: 8px;
  flex: 0 0 auto;
}

.btn {
  padding: 6px 14px;
  font-weight: 600;
  transition: background 0.12s, transform 0.05s;
}

.btn:active {
  transform: translateY(1px);
}

.btn-ghost {
  background: transparent;
  color: var(--text);
  border: 1px solid var(--border);
}

.btn-ghost:hover {
  background: var(--hover);
}

.btn-primary {
  background: var(--accent);
  color: var(--accent-ink);
}

.btn-primary:hover {
  filter: brightness(1.05);
}

.btn:disabled {
  opacity: 0.4;
  cursor: default;
  transform: none;
}
</style>
