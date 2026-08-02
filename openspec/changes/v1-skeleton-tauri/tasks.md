## 1. Rust 工程骨架（src-tauri）

- [ ] 1.1 创建 `src-tauri/`：Cargo.toml（tauri 2、tauri-build、serde、serde_json）、build.rs、tauri.conf.json（identifier、窗口配置）
- [ ] 1.2 编写 `src-tauri/src/main.rs` + `lib.rs`：`run()` 启动，`invoke_handler` 注册入口空壳（无 command）
- [ ] 1.3 `cargo check` 通过（Tauri 2 依赖可编译）

## 2. 前端骨架（Vue 3 + Vite + TS）

- [ ] 2.1 根级 `package.json`（scripts: dev/build/test/tauri）、`vite.config.ts`、`tsconfig*.json`、`index.html`
- [ ] 2.2 `src/main.ts` + `App.vue`：渲染 appbar 占位（品牌 + 主题按钮占位），可显示窗口
- [ ] 2.3 `src/lib/tauri.ts`：`invoke` 封装 seed（类型安全的 command 调用入口）
- [ ] 2.4 `src/store/song.ts`：单 store 骨架（`reactive` 空状态，预留 Song 类型占位）
- [ ] 2.5 `src/styles/theme.css`：深色优先 token 地基（`--bg`/`--panel`/`--text`/`--accent` 等，浅色 `prefers-color-scheme` 覆盖）
- [ ] 2.6 `npm run build` 通过

## 3. CI 与验证

- [ ] 3.1 `cargo test`（src-tauri）与 `npm run test` 空通过
- [ ] 3.2 `npm run tauri dev` 人工确认窗口可启动、深色渲染正常
