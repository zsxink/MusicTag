<script setup lang="ts">
// 首次启动授权确认弹窗（pre-release-check T1.2）：协议要点 + 同意/拒绝，全窗口模态遮罩。
// 自门禁：setup 同步算 showDialog = !isEulaAccepted()——已同意则组件自渲染空
// （「二次启动不弹」），未同意则渲染遮罩盖住主界面（spec「主界面不可交互」）。
// 遮罩与主界面同帧渲染，无「主界面先闪现再盖遮罩」的启动闪烁。
// 分层：组件只依赖 store/eula（组件→store 方向合法，守 §10.0）；
// **不直引 Tauri IPC 模块**（layering 守卫禁止组件 invoke）；窗口关闭经 store env 注入（defaultEnv 的 closeWindow）。
import { ref } from 'vue'

import { acceptEula, isEulaAccepted, rejectEula } from '../store/eula'

/** 自门禁：已同意 → 不渲染；未同意 → 渲染全窗口模态。同步计算（localStorage 同步读）。 */
const showDialog = ref(!isEulaAccepted())

function onAccept() {
  acceptEula()
  showDialog.value = false
}

function onReject() {
  rejectEula()
}
</script>

<template>
  <div v-if="showDialog" class="overlay">
    <div
      class="dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="eula-dialog-title"
      data-testid="eula-dialog"
    >
      <h3 class="dialog-title" id="eula-dialog-title">使用协议</h3>
      <p class="dialog-lead">本软件为<strong>个人学习用途</strong>的本地工具，使用前请确认以下协议要点：</p>
      <ul class="dialog-points">
        <li><strong>个人学习用途</strong>，禁止商用（含商业运营、商业分发、批量整理等）</li>
        <li>禁止私自销售、转卖、出租本软件（含修改后版本）</li>
        <li>禁止使用 AI 转写、重写或再创作本软件（转写/衍生作品与本软件无关）</li>
        <li>外部 API 基于公开资料调用，仅用于获取元数据；仅供个人学习与研究，请遵守各平台条款</li>
      </ul>
      <p class="dialog-footnote">完整协议见仓库 <span class="mono">README</span> 与 <span class="mono">LICENSE</span>（Business Source License 1.1）。</p>
      <div class="dialog-actions">
        <button class="btn btn-primary" type="button" @click="onAccept">同意并继续</button>
        <button class="btn btn-danger" type="button" @click="onReject">拒绝</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 全窗口遮罩（复用 SwitchDialog overlay：position:fixed; inset:0；点击遮罩不关——须用户明示同意/拒绝） */
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 60; /* 高于 SwitchDialog(50)：授权是启动门禁，最先覆盖 */
}

.dialog {
  width: 420px;
  max-width: calc(100vw - 40px);
  max-height: calc(100vh - 40px);
  overflow-y: auto;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px; /* design.md §4：弹窗 12px 圆角 */
  padding: 20px;
  box-shadow: var(--shadow); /* design.md §4：仅弹窗使用 */
}

.dialog-title {
  font-size: 15px;
  font-weight: 700;
  margin-bottom: 10px;
  color: var(--text);
}

.dialog-lead {
  font-size: 12.5px;
  color: var(--text-dim);
  margin-bottom: 12px;
  line-height: 1.6;
}

.dialog-points {
  margin: 0 0 12px;
  padding-left: 18px;
  font-size: 12.5px;
  color: var(--text);
  line-height: 1.8;
}

.dialog-footnote {
  font-size: 12px;
  color: var(--text-dim);
  margin-bottom: 16px;
}

/* 协议文件名单词用 mono（design 原则 3：路径/数据用等宽） */
.mono {
  font-family: var(--mono);
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

.btn-primary {
  background: var(--accent);
  color: var(--accent-ink);
}

.btn-primary:hover {
  filter: brightness(1.05);
}

.btn-danger {
  background: var(--danger);
  color: var(--danger-ink);
}

.btn-danger:hover {
  filter: brightness(1.05);
}
</style>
