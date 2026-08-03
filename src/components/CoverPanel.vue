<script setup lang="ts">
// 封面区（design.md §5 cover / v1-cover-embed D4–D5）：
// - 点击选择：`pickCoverFile()`（rfd 原生对话框，jpg/png/webp）→ 非 null 则 setCover；
// - 拖拽嵌入：Tauri 原生 `onDragDropEvent`（`@tauri-apps/api/window`）拿文件路径 →
//   `readCoverPath` → setCover（不用 HTML5 dragover/drop + FileReader，WKWebView 不保证暴露路径）；
//   **范围限定封面区**（CR：spec「拖拽文件到封面区」）：position 是 PhysicalPosition（物理像素），
//   按 dpr 与封面框 getBoundingClientRect（CSS px）对齐做命中判定——仅 drop 命中封面框才嵌入、
//   仅 enter/over 命中封面框才点亮 dragging 高亮；拖到歌词区/字段区/顶栏不替换封面、不误导高亮；
// - 预览：`current.cover` 即压缩后小图 data URL（`<img :src>` 直接用）；
// - 清空封面：✕ → `clearCover()`（置 null → 保存走既有删除语义）；
// - 错误：pick/read reject → 一行 dim 提示，不污染现有封面（工具线克制，不弹窗）；
// - readonly（坏标签只读）：整个封面区禁用，不响应点击/drop。
// 分层：组件不直呼 invoke（IPC 一律经 api/songs.ts）；`@tauri-apps/api/window` 事件订阅
// 属窗口事件、非 IPC，符合 §10.0 分层（guard 只禁 IPC invoke 入口模块 import）。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'

import { pickCoverFile, readCoverPath } from '../api/songs'
import { clearCover, setCover, songStore } from '../store/song'

const cover = computed(() => songStore.current?.cover ?? null)
const coverMime = computed(() => songStore.current?.cover_mime ?? null)
const readonly = computed(() => songStore.readonly)

/** 拖拽中高亮（dragging class：虚线框 hover 琥珀，design §6.1 封面区）。 */
const dragging = ref(false)
/** 一行 dim 错误提示（非图片/读失败，不弹窗）。 */
const errorHint = ref('')

/** 封面框元素引用（拖拽命中判定基准；has-cover/empty 两分支 v-if/v-else 互斥，共用同一 ref）。 */
const coverEl = ref<HTMLElement | null>(null)

/**
 * 拖拽命中判定（CR：拖拽范围限定封面区，spec「拖拽文件到封面区」）。
 * Tauri `onDragDropEvent` 的 position 是 PhysicalPosition（物理像素），而
 * getBoundingClientRect 返回 CSS 像素 → 按 `window.devicePixelRatio` 缩放对齐；
 * 指针落在封面框矩形内才算命中。无 position（leave 等）一律视为未命中。
 */
function isInsideCoverBox(pos?: { x: number; y: number }): boolean {
  const el = coverEl.value
  if (el === null || pos === undefined) return false
  const rect = el.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  const left = rect.left * dpr
  const top = rect.top * dpr
  const right = rect.right * dpr
  const bottom = rect.bottom * dpr
  return pos.x >= left && pos.x <= right && pos.y >= top && pos.y <= bottom
}

/** 点击选择：`pickCoverFile` → 非 null 则 `setCover`（readonly 时禁用）。 */
async function onClickPick() {
  if (readonly.value) return
  errorHint.value = ''
  try {
    const input = await pickCoverFile()
    if (input !== null) setCover(input)
  } catch (e) {
    errorHint.value = String(e) // 不污染现有封面，仅提示
  }
}

/** 拖拽 drop：`paths[0]` → `readCoverPath` → `setCover`；非图片 reject 不污染封面。 */
async function applyDropped(paths: string[]) {
  if (readonly.value) return
  const path = paths[0]
  if (!path) return
  errorHint.value = ''
  try {
    const input = await readCoverPath(path)
    setCover(input)
  } catch (e) {
    errorHint.value = String(e)
  }
}

/** Tauri 原生 drag-drop 订阅（enter/over 命中封面框 → 点亮高亮；drop 命中 → 路径；leave → 复位）。 */
let unlisten: (() => void) | undefined

onMounted(async () => {
  try {
    unlisten = await getCurrentWindow().onDragDropEvent((event) => {
      const { type } = event.payload
      if (readonly.value) return // 只读态不响应 drop（含高亮）
      if (type === 'enter' || type === 'over') {
        // 仅指针位于封面框内才点亮高亮（CR：窗口级拖拽不再误导封面框）
        dragging.value = isInsideCoverBox(event.payload.position)
      } else if (type === 'drop') {
        dragging.value = false
        // 仅 drop 落在封面框内才嵌入（spec「拖拽文件到封面区」）；
        // 拖到歌词区/字段区/顶栏任意位置落下一律不替换封面
        if (isInsideCoverBox(event.payload.position)) {
          void applyDropped(event.payload.paths)
        }
      } else {
        // 'leave'：拖拽离开窗口 → 复位高亮
        dragging.value = false
      }
    })
  } catch {
    // 非 Tauri 环境（浏览器 dev / 单测 mock 缺失）无 drag-drop 能力，静默降级
    unlisten = undefined
  }
})

onBeforeUnmount(() => {
  unlisten?.()
})
</script>

<template>
  <div class="cover">
    <!-- 有封面：1:1 预览（压缩后小图）+ 右上角清空 ✕（readonly 禁用） -->
    <div
      v-if="cover"
      ref="coverEl"
      class="cover-box has-cover"
      :class="{ dragging }"
      :title="readonly ? '' : '点击选择 / 拖拽嵌入封面'"
      @click="onClickPick"
    >
      <img :src="cover" alt="封面" class="cover-img" />
      <button
        v-if="!readonly"
        class="cover-clear"
        type="button"
        title="移除封面"
        aria-label="移除封面"
        @click.stop="clearCover()"
      >✕</button>
    </div>

    <!-- 无封面：虚线框空态占位（点击选择 / 拖拽嵌入提示） -->
    <div
      v-else
      ref="coverEl"
      class="cover-box cover-empty"
      :class="{ dragging }"
      @click="onClickPick"
    >
      <span class="cover-mark" aria-hidden="true">🖼</span>
      <span class="cover-hint">点击选择 / 拖拽嵌入</span>
    </div>

    <div class="cover-meta">{{ coverMime ? coverMime : '未设置' }}</div>

    <!-- 一行 dim 错误提示（非图片/读失败，不污染封面、不弹窗） -->
    <div v-if="errorHint" class="cover-error" role="alert">{{ errorHint }}</div>

    <!-- 搜索封面占位（v1-search-ui 接语义） -->
    <button class="search-trigger" type="button" disabled>🔍 搜索封面</button>
  </div>
</template>

<style scoped>
.cover {
  width: 200px;
}

.cover-box {
  aspect-ratio: 1;
  width: 100%;
  border: 1px dashed var(--border);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-dim);
  background: var(--panel-2);
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.12s;
}

.cover-box:hover {
  border-color: var(--accent);
}

/* 拖拽中：虚线框 hover 琥珀高亮（design §6.1 封面区） */
.cover-box.dragging {
  border-color: var(--accent);
  background: var(--active);
}

.cover-box.has-cover {
  border-style: solid;
  padding: 0;
  position: relative;
}

.cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  pointer-events: none;
}

/* 清空封面 ✕（右上角小圆钮，hover 危险色） */
.cover-clear {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 22px;
  height: 22px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  line-height: 1;
  color: var(--text);
  background: rgba(0, 0, 0, 0.55);
  border: none;
  border-radius: 50%;
  opacity: 0;
  transition: opacity 0.12s, background 0.12s;
}

.cover-box.has-cover:hover .cover-clear {
  opacity: 1;
}

.cover-clear:hover {
  background: var(--danger);
}

.cover-clear:active {
  transform: translateY(1px);
}

.cover-mark {
  font-size: 30px;
  opacity: 0.4;
}

.cover-hint {
  font-size: 11.5px;
  text-align: center;
  padding: 0 8px;
}

.cover-meta {
  margin-top: 8px;
  text-align: center;
  color: var(--text-dim);
  font-size: 11px;
  font-family: var(--mono);
}

/* 一行 dim 错误提示（工具线克制：不弹窗） */
.cover-error {
  margin-top: 6px;
  text-align: center;
  color: var(--text-dim);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.search-trigger {
  margin-top: 10px;
  width: 100%;
  padding: 6px 0;
  background: transparent;
  border: 1px dashed var(--border);
  border-radius: 6px;
  color: var(--text-dim);
  font-size: 11.5px;
  transition: border-color 0.12s, color 0.12s, transform 0.05s;
}

.search-trigger:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.search-trigger:active {
  transform: translateY(1px);
}

.search-trigger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}
</style>
