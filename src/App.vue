<script setup lang="ts">
// 壳：appbar + 左栏 SongList + 右侧编辑表单 Editor（v1-song-read 挂载）。
// 左侧展示当前文件夹展平歌曲列表；选中一首 → 右栏读全量标签渲染编辑表单。
// v1-ux-settings：SwitchDialog 挂在 App 层（§10.1 组件树预留，Editor 平级），
// v-if 由 store.pendingAction 驱动——有未保存修改切歌/换目录时全窗口模态三选一。
import AppBar from './components/AppBar.vue'
import Editor from './components/Editor.vue'
import SongList from './components/SongList.vue'
import SwitchDialog from './components/SwitchDialog.vue'
import { songStore } from './store/song'
</script>

<template>
  <div class="app">
    <!-- 全局顶栏：品牌 + 当前目录绝对路径（mono）+ 主题按钮 -->
    <AppBar />

    <!-- 主体：左侧列表 + 右侧编辑器 -->
    <main class="workspace">
      <SongList />
      <section class="editor-slot" aria-label="歌曲编辑器">
        <Editor />
      </section>
    </main>

    <!-- 切歌/换目录未保存三选一弹窗（pendingAction 非 null → 渲染；全窗口遮罩） -->
    <SwitchDialog v-if="songStore.pendingAction !== null" />
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
  overflow: hidden; /* 锁定高度边界：右栏超高仅内部滚动，不撑高顶起左栏 */
}

/* 右侧编辑器占位（v1-song-read 起填充 SongEditor 形态） */
.editor-slot {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0; /* 保证内部 .editor-body 的 overflow-y:auto 生效 */
  background: var(--bg);
}
</style>
