import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Tauri dev 固定端口 + strictPort + clearScreen:false（对齐 create-tauri-app 模板，保证 tauri dev 稳定连上）
export default defineConfig({
  plugins: [vue()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
})
