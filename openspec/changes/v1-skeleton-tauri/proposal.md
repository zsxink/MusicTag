## Why

仓库当前是纯规格基线状态：无 `src-tauri/`、无 `src/`、无任何可运行代码。V1 全链路（读标签→保存→搜索）都建立在 Tauri 2 应用壳之上，必须先有能 `npm run tauri dev` 起窗口的最小骨架，后续每个子变更才能在其上独立增量落地。本变更承担 `create-tauri-app` 等价物的脚手架职责。

## What Changes

- 新建 Tauri 2 工程结构：`src-tauri/`（Cargo.toml、tauri.conf.json、main.rs、lib.rs）+ Vue 3 + Vite + TypeScript 前端壳（`src/`）。
- 单 store（`store/song.ts`）骨架与 `invoke` IPC 封装 seed，为后续 command 接入预留入口。
- 深色为默认主题的 CSS token 地基（`--bg`/`--panel`/`--text`/`--accent` 等语义变量，浅色随系统 `prefers-color-scheme`）。
- `App.vue` 起一个可显示窗口的壳，`npm run tauri dev` 能正常打开。
- CI 门禁（cargo check/test + npm run build/test + openspec validate）对空壳即可通过。

## Capabilities

### New Capabilities
- `app-shell`: Tauri 2 应用外壳 + Vue 3/Vite/TS 前端 + 深色优先主题 token 地基 + invoke 封装入口

### Modified Capabilities
（无——这是首个变更，`openspec/specs/` 目前为空）

## 关联 Issue

- GitHub Issue：`#6`（变更前已建，作为本变更锚点；分支提交 `feat(6): ...`、PR `Closes #6`）

## Impact

- 依赖：Tauri 2 CLI 与 crate、Vue 3、Vite、TypeScript；前端包管理 npm。
- 文件：新增 `src-tauri/`、`src/`、`package.json`、`vite.config.ts`、`index.html`、`tsconfig*.json`。
- 后续所有子变更（v1-folder-list 起）以其为前置依赖。
