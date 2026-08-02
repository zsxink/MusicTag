# v1-skeleton-tauri — 任务拆分

> 变更域：**both（跨前后端）**。实施顺序：**Rust 壳 → 前端壳 → CI 验证**（Rust 优先于前端接入）。不并行、不建 worktree。
> 分支名：`v1-skeleton-tauri`；提交前缀 `feat(6): ...`；PR `Closes #6`。

## 1. Rust 工程骨架（src-tauri）

- [ ] 1.1 创建 `src-tauri/Cargo.toml`：tauri 2、tauri-build 2、serde、serde_json 为 dependencies；`tauri-build` 为 build-dependencies；`[build-dependencies]` 形态对齐 create-tauri-app 模板；**不引入** lofty/reqwest/walkdir/rfd/image 等业务依赖
- [ ] 1.2 创建 `src-tauri/build.rs`：`fn main() { tauri_build::build() }`
- [ ] 1.3 创建 `src-tauri/tauri.conf.json`：productName `MusicTag`、identifier、单窗口配置（title `MusicTag`、宽高、resizable）；frontendDist 指向前端构建产物、devUrl 指向 Vite dev server
- [ ] 1.4 编写 `src-tauri/src/main.rs` + `lib.rs`：`main` 调 `app_lib::run()`；`lib.rs` 内 `run()` 用 `tauri::Builder::default()`，注册 `invoke_handler` 空壳（`tauri::generate_handler![]`，**不注册任何 command**）
- [ ] 1.5 `cargo check --manifest-path src-tauri/Cargo.toml` 通过（Tauri 2 依赖可编译）

## 2. 前端骨架（Vue 3 + Vite + TS）

- [x] 2.1 根级 `package.json`：deps 含 vue、@tauri-apps/api；devDeps 含 vite、@vitejs/plugin-vue、typescript、vue-tsc、vitest；scripts：`dev`（vite）、`build`（vue-tsc + vite build）、`test`（vitest 空跑）、`tauri`（tauri dev）
- [x] 2.2 `vite.config.ts`：@vitejs/plugin-vue；固定端口 + `strictPort` + `clearScreen:false`（对齐 create-tauri-app 模板，保证 tauri dev 稳定连上）
- [x] 2.3 `tsconfig.json` + `tsconfig.node.json` + `vite-env.d.ts`（vite/client 类型）
- [x] 2.4 `index.html`：入口 html，含 `#app` 挂载点
- [x] 2.5 `src/main.ts`：`createApp(App).mount('#app')`，导入 `styles/theme.css`
- [x] 2.6 `src/App.vue`：壳——appbar 占位（品牌「♪ MusicTag」+ 右侧主题按钮占位，ghost 30×30），主体空容器；不引入业务组件、不拉取 store 数据
- [x] 2.7 `src/lib/tauri.ts`：`invokeCommand<T>(cmd: string, args?: Record<string, unknown>): Promise<T>` 泛型封装 `@tauri-apps/api/core.invoke`；TS 类型骨架对齐 `docs/design/design.md` §10.3（`Song`/`SongSummary`/`SongCandidate`/`SearchResult` 接口先建，供后续 command 接入）
- [x] 2.8 `src/store/song.ts`：单 store 骨架——`reactive` 空状态，预留 `SongEditor` 形态占位（`current`/`original`/`dirty` 接口字段，不实现对比逻辑；不用 Pinia）
- [x] 2.9 `src/styles/theme.css`：深色优先 token 地基——`:root` 深色缺省（`--bg:#12161A`/`--panel:#1A2026`/`--panel-2:#212830`/`--border:#262D34`/`--text:#E8E9E4`/`--text-dim:#8A939C`/`--accent:#E8A33D`/`--accent-ink:#241A05`/`--danger:#C0553E`/`--success:#3FA36B`/`--hover`/`--active`）+ `@media (prefers-color-scheme: light)` 浅色覆盖；token 名与 `docs/design/design.md` §2 完全一致
- [x] 2.10 `npm run build` 通过（vue-tsc 无类型错误 + vite build 产出）

## 3. CI 与验证

- [x] 3.1 `cargo test --manifest-path src-tauri/Cargo.toml` 空通过（无测试用例，编译即绿）
- [x] 3.2 `npm run test`（vitest 空跑）通过
- [ ] 3.3 `npm run tauri dev` 人工确认窗口可启动、深色 token 渲染正常、无闪白（spec「深色默认渲染」场景）
- [ ] 3.4 系统偏好切浅色 → 界面跟随浅色 token（spec「浅色跟随系统」场景）
- [x] 3.5 提交 PR 前确认 CI（`.github/workflows/ci.yml`）对空壳全绿：openspec validate + npm ci/build/test + cargo check/test
