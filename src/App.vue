<script setup lang="ts">
// 壳（v1-skeleton-tauri）：appbar 占位 + 主体空容器。
// 不引入业务组件、不拉取 store 数据；业务 UI（sidebar/editor）由后续子变更挂载。
</script>

<template>
  <div class="app">
    <!-- 全局顶栏（占位：品牌 + 主题按钮，不实现切换逻辑） -->
    <header class="appbar">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">♪</span>
        <span class="brand-name">MusicTag</span>
      </div>
      <div class="appbar-path" title="当前文件夹">路径: —</div>
      <button class="theme-btn" type="button" title="切换主题" aria-label="切换主题">☀️</button>
    </header>

    <!-- 主体空容器（sidebar / editor 挂载点，后续子变更填充） -->
    <main class="workspace" />
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 560px;
}

/* ---------- 全局顶栏 ---------- */
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

/* ---------- 主体（后续挂载 sidebar / editor） ---------- */
.workspace {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
}
</style>
