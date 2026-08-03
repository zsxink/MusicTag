import { createApp } from 'vue'

import App from './App.vue'
import { initTheme } from './store/theme'
import './styles/theme.css'

// 主题初始化必须在 app.mount() 之前同步完成（v1-ux-settings D5）：
// localStorage 同步读 + 同步设 data-theme —— 浅色手动选择的用户启动不闪深；
// 同时注册 matchMedia('(prefers-color-scheme: light)') change 监听
// （D7：仅 manualChoice===null 时系统偏好切换生效，手动选择后钉住）。
initTheme()

createApp(App).mount('#app')
