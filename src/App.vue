<script setup lang="ts">
// 壳：appbar + 左栏 SongList + 右侧编辑表单 Editor（v1-song-read 挂载）。
// 左侧展示当前文件夹展平歌曲列表；选中一首 → 右栏读全量标签渲染编辑表单。
import AppBar from './components/AppBar.vue'
import Editor from './components/Editor.vue'
import SongList from './components/SongList.vue'
</script>

<template>
  <div class="app">
    <!-- 全局顶栏：品牌 + 当前目录绝对路径（mono）+ 主题按钮占位 -->
    <AppBar />

    <!-- 主体：左侧列表 + 右侧编辑器 -->
    <main class="workspace">
      <SongList />
      <section class="editor-slot" aria-label="歌曲编辑器">
        <Editor />
      </section>
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
