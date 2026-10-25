<script setup lang="ts">
// 全局顶栏：品牌 + 文件夹操作 + 主题按钮。
// v1-ux-settings：主题按钮接 theme store——图标 = 目标主题（D8：effective 深色显示 ☀️，
// 浅色显示 🌙），点击 setTheme 在深浅之间切换（写/删 localStorage 持久记忆）。
import { onMounted, onUnmounted } from 'vue'
import { listSongs, pickFolder } from '../api/songs'
import { requestFolder, songStore } from '../store/song'
import { setTheme, themeStore } from '../store/theme'
import { hasAvailableUpdate, restoreUpdateNotice } from '../store/updates'

async function openFolder() {
  try {
    const picked = await pickFolder()
    if (picked === null) return
    await requestFolder(picked, listSongs)
  } catch (error) {
    songStore.folderRefreshError = `打开文件夹失败：${error instanceof Error ? error.message : String(error)}`
  }
}

function onKeydown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'o') {
    event.preventDefault()
    void openFolder()
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <header class="appbar">
    <div class="brand">
      <span class="brand-mark" aria-hidden="true">♪</span>
      <span class="brand-name">MusicTag</span>
    </div>
    <button
      v-if="hasAvailableUpdate()"
      class="update-indicator"
      type="button"
      aria-label="有可用更新，重新显示更新提示"
      title="重新显示更新提示"
      @click="restoreUpdateNotice"
    ><span aria-hidden="true">•</span></button>
    <button
      class="open-folder-btn"
      type="button"
      aria-label="打开文件夹"
      title="打开文件夹"
      @click="openFolder"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
        <path d="M3.75 6.75h6l1.8 2h8.7v8.5a2 2 0 0 1-2 2h-12.5a2 2 0 0 1-2-2v-10.5Z" />
        <path d="M3.75 9h16.5" />
      </svg>
    </button>
    <!-- 主题按钮：图标 = 目标主题（深色 → ☀️ 去浅色；浅色 → 🌙 去深色） -->
    <button
      class="theme-btn"
      type="button"
      :title="themeStore.effective === 'dark' ? '切换到浅色' : '切换到深色'"
      :aria-label="themeStore.effective === 'dark' ? '切换到浅色' : '切换到深色'"
      @click="setTheme(themeStore.effective === 'dark' ? 'light' : 'dark')"
    >{{ themeStore.effective === 'dark' ? '☀️' : '🌙' }}</button>
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

.open-folder-btn {
  flex: 0 0 auto;
  width: 32px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  background: transparent;
  transition: background 0.12s, border-color 0.12s;
}

.open-folder-btn svg {
  width: 17px;
  height: 17px;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.open-folder-btn:hover,
.open-folder-btn:focus-visible {
  background: var(--hover);
  border-color: var(--accent);
}

.update-indicator {
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 50%;
  color: #fff;
  background: #d33;
  font-size: 20px;
  line-height: 1;
}

.update-indicator:hover,
.update-indicator:focus-visible {
  background: #b22;
}

.theme-btn {
  flex: 0 0 auto;
  margin-left: auto;
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
  transition: background 0.12s, border-color 0.12s;
}

.theme-btn:hover {
  background: var(--hover);
  border-color: var(--accent);
}

.theme-btn:active {
  transform: translateY(1px);
}
</style>
