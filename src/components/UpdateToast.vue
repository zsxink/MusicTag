<script setup lang="ts">
import { dismissUpdate, recentUpdateText, updatesStore, viewUpdateDetails } from '../store/updates'
</script>

<template>
  <!-- 常驻容器供读屏播报；不聚焦、不加遮罩、不阻断编辑。 -->
  <aside class="update-notices" aria-live="polite" aria-atomic="true">
    <div v-if="updatesStore.noticeVisible" class="update-toast" role="status" data-testid="update-toast">
      <p>{{ updatesStore.status === 'checking' ? '正在检查更新…' : recentUpdateText() }}</p>
      <p v-if="updatesStore.detailError" class="error">{{ updatesStore.detailError }}</p>
      <div v-if="updatesStore.status === 'update-available'" class="actions">
        <button type="button" :disabled="updatesStore.openingDetails" @click="viewUpdateDetails()">
          {{ updatesStore.openingDetails ? '正在打开…' : '查看详情' }}
        </button>
        <button type="button" @click="dismissUpdate">稍后</button>
      </div>
      <button v-else-if="updatesStore.status !== 'checking'" class="close" type="button" @click="dismissUpdate">关闭</button>
    </div>
  </aside>
</template>

<style scoped>
.update-notices { position: fixed; right: 18px; bottom: 18px; z-index: 40; pointer-events: none; }
.update-toast { width: 300px; max-width: calc(100vw - 36px); padding: 14px; background: var(--panel); color: var(--text); border: 1px solid var(--border); border-radius: 8px; pointer-events: auto; font-size: 12.5px; }
p { margin: 0; line-height: 1.6; overflow-wrap: anywhere; }
.error { margin-top: 8px; color: var(--danger); }
.actions { display: flex; gap: 8px; margin-top: 12px; }
button { padding: 6px 12px; border: 1px solid var(--border); border-radius: 6px; color: var(--text); background: var(--panel); }
button:hover { background: var(--hover); }
button:disabled { opacity: .5; cursor: default; }
.close { margin-top: 10px; }
</style>
