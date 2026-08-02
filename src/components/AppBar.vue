<script setup lang="ts">
// 全局顶栏（v1-folder-list）：品牌 + 当前目录绝对路径（mono）+ 主题按钮占位。
// 主题按钮仅占位不实现切换逻辑（v1-ux-settings 负责）。
import { songStore } from '../store/song'
</script>

<template>
  <header class="appbar">
    <div class="brand">
      <span class="brand-mark" aria-hidden="true">♪</span>
      <span class="brand-name">MusicTag</span>
    </div>
    <div
      class="appbar-path"
      :title="songStore.folderPath ?? '未打开文件夹'"
    >
      <template v-if="songStore.folderPath">路径: {{ songStore.folderPath }}</template>
      <template v-else>路径: —</template>
    </div>
    <button class="theme-btn" type="button" title="切换主题" aria-label="切换主题">☀️</button>
  </header>
</template>

<style scoped>
.appbar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 16px;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
  flex: 0 0 auto;
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
}

.brand-mark {
  color: var(--accent);
  font-size: 18px;
}

.brand-name {
  font-weight: 700;
  letter-spacing: 0.02em;
}

.appbar-path {
  flex: 1;
  color: var(--text-dim);
  font-family: var(--mono);
  font-size: 11.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.theme-btn {
  flex: 0 0 auto;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
}

.theme-btn:hover {
  background: var(--hover);
}
</style>