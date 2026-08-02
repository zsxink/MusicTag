<script setup lang="ts">
// 右栏编辑表单（v1-song-read）：
// - 空态：未选中/未打开 → 占位提示（design §6.1 空状态样式）
// - 坏标签只读态：readonly === true → EditorBar 显示「标签损坏，只读」(danger)、
//   正文区只读提示，不进入可编辑态（FR-5.7 / spec「坏标签只读」）
// - 展示态：EditorBar + FieldGrid（字段列 + 封面区）+ LyricPanel（歌词）
// 本变更仅展示形态：字段可编辑（v-model 绑 current），保存语义归 v1-song-save。
import { songStore } from '../store/song'
import EditorBar from './EditorBar.vue'
import FieldGrid from './FieldGrid.vue'
import LyricPanel from './LyricPanel.vue'
</script>

<template>
  <div class="editor" data-testid="editor">
    <!-- 空态：未打开歌曲 / 未选中 -->
    <div v-if="songStore.current === null && !songStore.readonly" class="editor-empty">
      <div class="empty-mark" aria-hidden="true">♪</div>
      <div class="empty-title">从左侧选择一首歌曲</div>
      <div class="empty-hint">支持 FLAC / MP3 · 选中后读取完整标签与封面</div>
    </div>

    <!-- 编辑表单 / 坏标签只读 -->
    <template v-else>
      <EditorBar />

      <!-- 坏标签只读：能看不能改、不能保存（FR-5.7） -->
      <div v-if="songStore.readonly" class="readonly-note" role="alert">
        <span class="danger-dot" aria-hidden="true">✕</span>
        <span>标签损坏，只读</span>
      </div>

      <!-- 表单主体：字段网格（左列）+ 歌词区（整宽） -->
      <div v-else class="editor-body">
        <FieldGrid />
        <LyricPanel />
      </div>
    </template>
  </div>
</template>

<style scoped>
.editor {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  min-height: 0;
}

/* 空状态（design §6.1：图标 40px 35% 透明 + 标题 + 副说明） */
.editor-empty {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--text-dim);
  text-align: center;
  padding: 24px;
}

.empty-mark {
  font-size: 40px;
  line-height: 1;
  opacity: 0.35;
}

.empty-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
}

.empty-hint {
  font-size: 12px;
  max-width: 300px;
}

/* 坏标签只读提示 */
.readonly-note {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 12px 20px 0;
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--danger);
  background: var(--panel-2);
  border: 1px solid var(--danger);
  border-radius: 6px;
}

.danger-dot {
  flex: 0 0 auto;
}

/* 表单主体（滚动） */
.editor-body {
  flex: 1 1 auto;
  overflow-y: auto;
  min-height: 0;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
</style>
