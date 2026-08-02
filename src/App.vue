<script setup lang="ts">
// 壳（v1-folder-list）：appbar + 左栏 SongList + 右侧 SongEditor 挂载占位。
// 左侧展示当前文件夹展平歌曲列表；右侧编辑器由后续子变更（v1-song-read 起）挂载。
import AppBar from './components/AppBar.vue'
import SongList from './components/SongList.vue'
</script>

<template>
  <div class="app">
    <!-- 全局顶栏：品牌 + 当前目录绝对路径（mono）+ 主题按钮占位 -->
    <AppBar />

    <!-- 主体：左侧列表 + 右侧编辑器挂载点 -->
    <main class="workspace">
      <SongList />
      <section class="editor-slot" aria-label="歌曲编辑器" />
    </main>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 560px;
}

.workspace {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
}

/* 右侧编辑器占位（v1-song-read 起填充 SongEditor 形态） */
.editor-slot {
  flex: 1 1 auto;
  min-width: 0;
  background: var(--bg);
}
</style>
