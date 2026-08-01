---
description: 启动本地开发环境（前端 Vite 或 Tauri 窗口）
---

按需启动开发环境：

- 只改前端：后台起 `npm run dev`（Vite），确认端口就绪后告知访问地址
- 需要外壳/跨端验证：`npm run tauri dev`

先检查目标端口是否被占用；占用时提示用户。启动后给出明确的下一个操作指引。
