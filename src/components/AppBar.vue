<script setup lang="ts">
// 全局顶栏（v1-folder-list）：品牌 + 当前目录绝对路径（mono）+ 主题按钮。
// v1-ux-settings：主题按钮接 theme store——图标 = 目标主题（D8：effective 深色显示 ☀️，
// 浅色显示 🌙），点击 setTheme 在深浅之间切换（写/删 localStorage 持久记忆）。
import { setTheme, themeStore } from '../store/theme'
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
