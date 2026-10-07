<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { recentUpdateText, updatesStore } from '../store/updates'

const emit = defineEmits<{ close: [] }>()
const closeButton = ref<HTMLButtonElement | null>(null)
let previousFocus: HTMLElement | null = null
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
  if (event.key === 'Tab') {
    event.preventDefault()
    closeButton.value?.focus()
  }
}
onMounted(() => {
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  closeButton.value?.focus()
  window.addEventListener('keydown', onKeydown)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  if (previousFocus?.isConnected) previousFocus.focus()
})
</script>

<template>
  <div class="overlay">
    <section class="about-dialog" role="dialog" aria-modal="true" aria-labelledby="about-title" data-testid="about-dialog">
      <h2 id="about-title">关于 MusicTag</h2>
      <p>当前版本：{{ updatesStore.currentVersion || '读取中…' }}</p>
      <p v-if="updatesStore.status === 'checking'" role="status">正在检查更新…</p>
      <p>最近检查：{{ recentUpdateText() }}</p>
      <div class="actions"><button ref="closeButton" type="button" @click="emit('close')">关闭</button></div>
    </section>
  </div>
</template>

<style scoped>
.overlay { position: fixed; inset: 0; z-index: 50; background: rgba(0, 0, 0, .45); display: flex; align-items: center; justify-content: center; }
.about-dialog { width: 360px; max-width: calc(100vw - 40px); padding: 20px; background: var(--panel); color: var(--text); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); }
h2 { font-size: 15px; margin: 0 0 14px; }
p { font-size: 12.5px; line-height: 1.6; margin: 8px 0; overflow-wrap: anywhere; }
.actions { display: flex; justify-content: flex-end; margin-top: 16px; }
button { padding: 6px 14px; border: 1px solid var(--border); border-radius: 6px; color: var(--text); background: transparent; }
button:hover { background: var(--hover); }
</style>
