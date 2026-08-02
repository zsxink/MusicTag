import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

// vitest 配置：Vue 单测需要 DOM 环境（组件渲染断言两列布局/封面/只读态等 spec 场景）。
// `*.test.ts` 中仅 store/lib 纯逻辑测试跑 node 环境，组件测试（Editor 等）在
// `environment: 'happy-dom'` 下运行，且 `globals: false`（显式 import 语义更清晰）。
export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
  },
})
