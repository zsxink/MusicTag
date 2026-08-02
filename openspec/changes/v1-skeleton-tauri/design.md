## Context

仓库为纯规格基线，无任何可运行代码。V1 采用 Tauri 2 单窗口桌面应用：Rust 后端负责全部文件 I/O 与网络，Vue 3 前端只管界面与状态。本变更搭建最小可运行壳。

## Goals / Non-Goals

**Goals:**
- 建立可 `npm run tauri dev` 启动的 Tauri 2 + Vue3/Vite/TS 工程。
- 落地设计语言深色优先 token 地基（`docs/design/design.md` §2 色彩系统）。
- 提供 `invoke` 封装 seed 与单 store 骨架（design.md §10.2）。

**Non-Goals:**
- 不做任何业务功能（文件夹选择、标签读写、搜索均属后续变更）。
- 不接 `rfd` 对话框、不引入 `lofty`/`reqwest` 等业务依赖。

## Decisions

- **工程起点**：`create-tauri-app` 官方模板（Vue-TS 变体）生成的等价结构，人工搭建不依赖模板脚本。
- **store 形态**：单 store 用 Vue 组合式 API 的 `reactive` + `computed`，不用 Pinia（design.md §10.2 已定）。
- **主题 token**：CSS 自定义属性在全局样式定义；`:root` 为深色缺省，`@media (prefers-color-scheme: light)` 覆盖为浅色；手动切换持久记忆（FR-7.4）由后续 `v1-ux-settings` 实现，本变更只铺 token 地基。
- **command 注册入口**：`lib.rs` 预留 `invoke_handler` 空壳，后续变更逐个注册 command，避免反复改入口签名。

## Risks / Trade-offs

- Tauri 首次 `dev` 需编译大量 Rust 依赖（较慢），属一次性成本。
- 前端构建依赖 Node 版本（CI 用 24），本地需保持一致。
