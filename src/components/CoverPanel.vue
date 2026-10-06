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
// - 右键导出（export-embedded-cover）：封面框 `@contextmenu.prevent` 弹浮层菜单，单项「导出封面…」
//   → `pickCoverSavePath()` 弹存盘框（**取消 = null，不调 export_cover、无任何副作用**）→
//   `exportCover()` 纯写盘。**纯只读**：不碰 store（dirty/表单天然不变），只复用 errorHint 报失败；
// - 错误：pick/read/export reject → 一行 dim 提示，不污染现有封面（工具线克制，不弹窗）；
// - readonly（坏标签只读）：整个封面区禁用，不响应点击/drop。
// 分层：组件不直呼 invoke（IPC 一律经 api/songs.ts）；`@tauri-apps/api/window` 事件订阅
// 属窗口事件、非 IPC，符合 §10.0 分层（guard 只禁 IPC invoke 入口模块 import）。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'

import { exportCover, pickCoverFile, pickCoverSavePath, readCoverPath } from '../api/songs'
import { manualSearch, clearCover, setCover, songStore } from '../store/song'
import CoverCandidate from './CoverCandidate.vue'

const cover = computed(() => songStore.current?.cover ?? null)
const coverMime = computed(() => songStore.current?.cover_mime ?? null)
const readonly = computed(() => songStore.readonly)

/** 「搜索封面」可用性：readonly（坏标签只读）/ 无歌禁用。 */
const canSearch = computed(() => !songStore.readonly && songStore.current !== null)

// 候选区折叠（candidate-collapse）：组件局部 ref，默认展开；点按钮折叠。
// 切歌（current.path 变）时重置为默认展开——产品决策：折叠偏好不跨切歌保持（用户收起后
// 切歌，新歌候选区默认展开，避免「新歌被搜索顶开」的困惑；原「跨切歌保持」实测不好用已改为重置）。
const candidatesCollapsed = ref(false)
function toggleCandidates(): void {
  candidatesCollapsed.value = !candidatesCollapsed.value
}
// 切歌重置：current 换歌（path 变化）→ 折叠态回默认展开 + 右键导出菜单关闭
// （spec「切歌后菜单不残留」：浮层挂在封面区且坐标来自旧歌的右键事件，切歌必关）。
// 切歌只改 store 候选（resetSearchState），折叠/菜单 ref 在组件——watch current.path 显式重置
// （换目录/坏标签只读因面板卸载天然重置，本 watch 幂等覆盖）。
watch(
  () => songStore.current?.path,
  () => {
    candidatesCollapsed.value = false
    menuOpen.value = false
  },
)
/** 候选区有内容才显示折叠按钮——与模板 v-if 分支（searching / done+候选(含空态) / 离线）逐条对齐。 */
const candidatesVisible = computed(
  () =>
    songStore.coverSearchState === 'searching'
    || (songStore.coverSearchState === 'done' && songStore.coverCandidates.length > 0)
    || (songStore.coverSearchState === 'done' && songStore.coverCandidates.length === 0)
    || songStore.isOffline,
)

/** 拖拽中高亮（dragging class：虚线框 hover 琥珀，design §6.1 封面区）。 */
const dragging = ref(false)
/** 一行 dim 错误提示（非图片/读失败，不弹窗）。 */
const errorHint = ref('')

/** 封面框元素引用（拖拽命中判定基准；has-cover/empty 两分支 v-if/v-else 互斥，共用同一 ref）。 */
const coverEl = ref<HTMLElement | null>(null)

// ---------------------------------------------------------------------------
// 右键导出浮层菜单（export-embedded-cover design.md §4）
// ---------------------------------------------------------------------------
// 状态全在组件内、**不入 store**：导出不改任何 store 字段（current/original/dirty 天然不变），
// 故无需 store 动作，也不存在跨组件同步需求。

/** 菜单开关；`menuLeft/menuTop` 是**视口 CSS 像素**（与 `position: fixed` 同一坐标系）。
 *  取自右键事件的 clientX/clientY，不做 dpr 缩放——与拖拽的 PhysicalPosition 有意区分。 */
const menuOpen = ref(false)
const menuLeft = ref(0)
const menuTop = ref(0)

/** 「导出封面…」可用性：无内嵌封面 → 置灰（spec S7）。
 *  与模板 `v-if="cover"` 同一数据源。坏标签只读时 current 为 null → 天然 false，无需额外分支。 */
const hasCover = computed(() => cover.value !== null)

/** 导出进行中：覆盖「弹框 + 写盘」两次 IPC 全程，期间禁用菜单项防连点开多个对话框。
 *  菜单关闭**不**复位它——导出已发起就该等它结束（finally 统一复位）。 */
const exporting = ref(false)

/** 浮层元素引用：关闭出口用 contains 判「点在菜单外」（不引 getBoundingClientRect）。 */
const menuEl = ref<HTMLElement | null>(null)

/** 菜单项元素引用：打开后 nextTick 聚焦（键盘可达，对齐 SwitchDialog 初始聚焦惯例）。 */
const menuItemEl = ref<HTMLButtonElement | null>(null)

/** 菜单宽/高（CSS px）：仅用于**贴边翻转**的纯数值判断（design.md §4.1）。
 *  不量真实布局、不依赖 getComputedStyle——happy-dom 不计算 CSS，这样写才可测。
 *  常量近似值 + 内联 `max-width` 兜底；菜单高度随项数变（当前恒 1 项 → 32px）。 */
const MENU_W = 140
const MENU_H = 32

/** 右键封面框：`.prevent` 阻止 WebView/系统默认右键菜单（否则与浮层并存）。
 *  仅记录坐标不拦截点击——左键 @click 照旧选图（spec S1）。 */
function onContextMenu(e: MouseEvent): void {
  e.preventDefault()
  // 贴边翻转：菜单宽高按常量估算，超出视口右/下边则改向左/上展开，保证不被裁掉。
  // 左侧翻转不额外收窄：翻转后 x = clientX - MENU_W ≥ 0（触发条件已保证 clientX > MENU_W）。
  const x = e.clientX + MENU_W > window.innerWidth ? e.clientX - MENU_W : e.clientX
  const y = e.clientY + MENU_H > window.innerHeight ? e.clientY - MENU_H : e.clientY
  menuLeft.value = x
  menuTop.value = y
  menuOpen.value = true
  // 焦点移入菜单：键盘用户能直接 Enter/空格激活（Esc 关闭后焦点自然回到触发元素）。
  void nextTick(() => menuItemEl.value?.focus())
}

/** 点菜单项：先关浮层再 await（避免原生存盘框开着时浮层还挂在上面）。 */
async function onExport(): Promise<void> {
  menuOpen.value = false
  const song = songStore.current
  // 组件侧守卫：置灰项不该点到（原生 disabled 已拦一层），这里防「导出一瞬间清空封面」等竞态。
  if (song === null || !hasCover.value || exporting.value) return
  errorHint.value = ''
  exporting.value = true
  try {
    // 两步 command（design.md §0 方案 Y）：先弹框取路径，再写盘。
    const dest = await pickCoverSavePath(song.path)
    // 取消 = 正常选择而非错误（spec S4）：静默终止，不调 export_cover、不写任何文件、无副作用。
    if (dest === null) return
    await exportCover(song.path, dest)
  } catch (e) {
    errorHint.value = String(e) // 复用封面区一行 dim 提示（.cover-error role=alert），不新增弹窗
  } finally {
    exporting.value = false
  }
}

/** Esc 关闭（与 SwitchDialog 同款：onMounted 挂、onUnmounted 摘）。 */
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && menuOpen.value) menuOpen.value = false
}

/** 点菜单外部关闭（挂 window 冒泡阶段，design.md §4.3）：
 *  contains 判定保证菜单项自身的 click 不被这里抢先关掉（项的 @click 照常触发 onExport），
 *  故用 click 而非 mousedown 也无竞态。defaultPrevented 早退：尊重拖拽选区等既有 preventDefault。 */
function onWindowClick(e: MouseEvent): void {
  if (!menuOpen.value || e.defaultPrevented) return
  const target = e.target
  if (target instanceof Node && menuEl.value?.contains(target)) return
  menuOpen.value = false
}

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
let unmounted = false

onMounted(async () => {
  // 窗口监听同步安装，保证订阅 IPC 尚未完成时卸载也能成对释放。
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('click', onWindowClick)
  try {
    const release = await getCurrentWindow().onDragDropEvent((event) => {
      if (unmounted) return
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
    // 换目录可能在事件订阅返回前卸载面板；迟到的订阅不能留到下首歌。
    if (unmounted) release()
    else unlisten = release
  } catch {
    // 非 Tauri 环境（浏览器 dev / 单测 mock 缺失）无 drag-drop 能力，静默降级
    unlisten = undefined
  }
})

onBeforeUnmount(() => {
  unmounted = true
  unlisten?.()
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('click', onWindowClick)
})
</script>

<template>
  <div class="cover">
    <!-- 有封面：1:1 预览（压缩后小图）+ 右上角清空 ✕（readonly 禁用）；右键 → 导出浮层菜单 -->
    <div
      v-if="cover"
      ref="coverEl"
      class="cover-box has-cover"
      :class="{ dragging }"
      :title="readonly ? '' : '点击选择 / 拖拽嵌入封面 / 右键导出'"
      @click="onClickPick"
      @contextmenu.prevent="onContextMenu"
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

    <!-- 无封面：虚线框空态占位（点击选择 / 拖拽嵌入提示）；右键仍可开菜单（「导出封面…」置灰，
         spec S7：菜单出得来，只是项不可用，不弹存盘框） -->
    <div
      v-else
      ref="coverEl"
      class="cover-box cover-empty"
      :class="{ dragging }"
      @click="onClickPick"
      @contextmenu.prevent="onContextMenu"
    >
      <span class="cover-mark" aria-hidden="true">🖼</span>
      <span class="cover-hint">点击选择 / 拖拽嵌入</span>
    </div>

    <!-- 右键浮层菜单（export-embedded-cover）：
         必须挂在 .cover 下、与 .cover-box **兄弟**——.cover-box 有 overflow: hidden，
         作为它的子节点会被裁掉；.cover 无 overflow。
         position: fixed + 内联 left/top（视口坐标，取自右键事件）→ 不被任何祖先 overflow 裁剪，
         也不需要 Teleport / getBoundingClientRect 反算容器偏移。 -->
    <div
      v-if="menuOpen"
      ref="menuEl"
      class="cover-menu"
      role="menu"
      aria-label="封面操作"
      :style="{ left: `${menuLeft}px`, top: `${menuTop}px` }"
      @contextmenu.prevent
    >
      <button
        ref="menuItemEl"
        class="cover-menu-item"
        type="button"
        role="menuitem"
        :disabled="!hasCover || exporting"
        @click="onExport"
      >导出封面…</button>
    </div>

    <div class="cover-meta">{{ coverMime ? coverMime : '未设置' }}</div>

    <!-- 一行 dim 错误提示（非图片/读失败，不污染封面、不弹窗） -->
    <div v-if="errorHint" class="cover-error" role="alert">{{ errorHint }}</div>

    <!-- 「搜索封面」手动按钮（design §6.2：封面框 + 元信息下方） -->
    <button
      class="search-trigger"
      type="button"
      :disabled="!canSearch"
      @click="manualSearch('cover')"
    >🔍 搜索封面</button>

    <!-- 候选区折叠按钮（candidate-collapse）：候选区有内容才显示；折叠只做 v-show 包装，不动候选 DOM/搜索状态 -->
    <button
      v-if="candidatesVisible"
      class="cand-toggle"
      type="button"
      @click="toggleCandidates"
    >{{ candidatesCollapsed ? '展开候选 ▼' : '隐藏候选 ▲' }}</button>

    <!-- 封面候选区（D8），cand-collapse 外层 v-show 容器（仅显示/隐藏，不改内部 v-if/v-else 结构） -->
    <div class="cand-wrap" v-show="!candidatesCollapsed">
      <div v-if="songStore.coverSearchState === 'searching'" class="cand-status">
        搜索中…<span class="spinner" aria-hidden="true"></span>
      </div>
      <template v-else-if="songStore.coverSearchState === 'done'">
        <div v-if="songStore.coverCandidates.length" class="cand-grid">
          <CoverCandidate
            v-for="c in songStore.coverCandidates"
            :key="`${c.source}:${c.id}`"
            :cand="c"
          />
        </div>
        <div v-else class="cand-empty">未找到匹配的封面</div>
        <div v-if="songStore.coverCandidates.length" class="cand-hint">点选一张填入预览</div>
      </template>
      <div v-else-if="songStore.isOffline" class="cand-empty">离线：仅手动填写</div>
    </div>
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

/* 右键导出浮层菜单（export-embedded-cover design.md §4.5）：
   - fixed + 内联 left/top（视口坐标）；**祖先链不得加常态 transform/filter/contain**，
     否则 fixed 的包含块不再是视口、定位坐标系失效（风险已登记于 design.md §8）。
   - z-index 40：低于 SwitchDialog(50) / EulaDialog(60)，切歌确认弹窗出现时本菜单必须被盖住。
   - 宽 140px 与 JS 的 MENU_W 常量对应（贴边翻转判断用；max-width 防常量大改时溢出视口）。 */
.cover-menu {
  position: fixed;
  z-index: 40;
  min-width: 140px;
  max-width: calc(100vw - 16px);
  padding: 2px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px; /* design.md §4：控件族 6px（.btn / .cand-cell 同款，非弹窗 12px） */
  box-shadow: var(--shadow); /* 准弹层：脱离文档流的浮层菜单，design.md §4.5 已裁决沿用 */
}

.cover-menu-item {
  display: block;
  width: 100%;
  padding: 8px 12px;
  background: transparent;
  color: var(--text);
  border-radius: 6px;
  text-align: left;
  white-space: nowrap;
  transition: background 0.12s;
}

.cover-menu-item:hover:not(:disabled) {
  background: var(--hover);
}

/* 置灰不只靠颜色（design.md §8）：原生 disabled 语义（读屏可读「不可用」、键鼠不可触发）
   + --text-dim 文字降权 + not-allowed 光标 + 透明度，三重非颜色线索。 */
.cover-menu-item:disabled {
  color: var(--text-dim);
  opacity: 0.55;
  cursor: not-allowed;
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

.search-trigger:hover:not(:disabled) {
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

/* 候选区折叠按钮（candidate-collapse）：对齐 .search-trigger 克制风格，尺寸更小；
   封面搜索按钮下方，margin-top: 10px */
.cand-toggle {
  margin: 10px 0 0;
  padding: 3px 10px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-dim);
  font-size: 11px;
  cursor: pointer;
}

.cand-toggle:hover {
  color: var(--accent);
  border-color: var(--accent);
}

/* design §6.3：搜索中状态（居中 dim 文字 + 10×10 转圈） */
.cand-status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 0 10px;
  font-size: 11.5px;
  color: var(--text-dim);
}

.spinner {
  width: 10px;
  height: 10px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* design §6.4：3 列网格，间距 6px（每格 1:1 由 CoverCandidate 承载） */
.cand-grid {
  margin-top: 10px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.cand-hint {
  margin-top: 6px;
  text-align: center;
  font-size: 10.5px;
  color: var(--text-dim);
}

/* design §6.6：候选空态 */
.cand-empty {
  padding: 8px 0 10px;
  text-align: center;
  font-size: 11px;
  color: var(--text-dim);
}
</style>
