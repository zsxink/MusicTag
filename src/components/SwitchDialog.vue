<script setup lang="ts">
// 切歌/换目录未保存三选一弹窗（v1-ux-settings D2：store 驱动、App 级挂载）。
// pendingAction 非 null 时 App 渲染本组件；三个出口直接调 store 动作（组件→store 方向合法，守 §10.0）：
// - 「保存」→ resolvePending('save')：完整复用 store.save，成功才切，失败保持弹窗（D3）
// - 「不保存」→ resolvePending('discard')：丢弃编辑直接切
// - 「取消」/ Esc → cancelPending()：留在当前
// 无障碍：role="dialog" aria-modal aria-labelledby；初始焦点落「取消」（安全默认，防误触保存/丢弃）。
import { onMounted, onUnmounted, ref } from 'vue'

import { fileName } from '../lib/path'
import { cancelPending, resolvePending, songStore } from '../store/song'

/** 保存中禁用「保存」按钮（防连点并发写同一文件；resolvePending 自身亦有 saving 守卫双保险）。 */
const saving = () => songStore.saveState === 'saving'

/** 当前编辑文件名的展示（mono 数据感）。current 为 null（脏态必非空，安全兜底）。 */
const currentFileName = () => fileName(songStore.current?.path ?? '')

/** 初始焦点落「取消」：挂载后聚焦取消按钮（安全默认，Esc/回车语义清晰）。 */
const cancelBtn = ref<HTMLButtonElement | null>(null)

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') cancelPending()
}

onMounted(() => {
  cancelBtn.value?.focus()
  window.addEventListener('keydown', onKeydown)
})
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="overlay">
    <div
      class="dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="switch-dialog-title"
      data-testid="switch-dialog"
    >
      <h3 class="dialog-title" id="switch-dialog-title">保存对 <span class="file-name">{{ currentFileName() }}</span> 的修改吗？</h3>
      <p class="dialog-body">修改尚未保存，切换歌曲将丢失。</p>
      <!-- 保存失败（save_failed）→ 弹窗保持打开、不切换（design.md D3），失败原因须在此弹窗语境可见
           （遮罩覆盖顶栏，顶栏「✕ 保存失败」不可见；CR：弹窗内补失败态文案，danger 色 + role=alert） -->
      <p v-if="songStore.saveState === 'save_failed'" class="dialog-error" role="alert">
        ✕ 保存失败：{{ songStore.saveError }}
      </p>
      <div class="dialog-actions">
        <button
          class="btn btn-primary"
          type="button"
          :disabled="saving()"
          @click="resolvePending('save')"
        >保存</button>
        <button
          class="btn btn-danger"
          type="button"
          @click="resolvePending('discard')"
        >不保存</button>
        <button
          ref="cancelBtn"
          class="btn btn-ghost"
          type="button"
          @click="cancelPending()"
        >取消</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 全窗口遮罩（spec FR-6.3「模态，覆盖全窗口」）；点击遮罩不关（须用户三选一，防误丢编辑） */
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}

.dialog {
  width: 360px;
  max-width: calc(100vw - 40px);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px; /* design.md §4：弹窗 12px 圆角 */
  padding: 20px;
  box-shadow: var(--shadow); /* 0 18px 48px（design.md §4：仅弹窗使用） */
}

.dialog-title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 8px;
  color: var(--text);
}

/* 文件名 mono（design 原则 3：路径/数据用等宽） */
.file-name {
  font-family: var(--mono);
  font-weight: 400;
  font-size: 13px;
  color: var(--accent);
  word-break: break-all;
}

.dialog-body {
  font-size: 12.5px;
  color: var(--text-dim);
  margin-bottom: 18px;
}

/* 保存失败态文案（danger 色，同 EditorBar save-state.failed；role=alert 对读屏用户） */
.dialog-error {
  font-size: 12.5px;
  color: var(--danger);
  font-weight: 600;
  background: color-mix(in srgb, var(--danger) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent);
  border-radius: 6px;
  padding: 8px 10px;
  margin-bottom: 16px;
  word-break: break-word;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

/* 按钮（与 mockup.css .btn 同源：120ms 过渡 + 按压 1px 位移） */
.btn {
  padding: 6px 14px;
  font-weight: 600;
  border-radius: 6px;
  transition: background 0.12s, border-color 0.12s, transform 0.05s;
}

.btn:active {
  transform: translateY(1px);
}

.btn-ghost {
  background: transparent;
  color: var(--text);
  border: 1px solid var(--border);
}

.btn-ghost:hover {
  background: var(--hover);
}

.btn-primary {
  background: var(--accent);
  color: var(--accent-ink);
}

.btn-primary:hover {
  filter: brightness(1.05);
}

.btn-primary:disabled {
  opacity: 0.4;
  cursor: default;
  transform: none;
}

.btn-danger {
  background: var(--danger);
  color: var(--danger-ink);
}

.btn-danger:hover {
  filter: brightness(1.05);
}
</style>
