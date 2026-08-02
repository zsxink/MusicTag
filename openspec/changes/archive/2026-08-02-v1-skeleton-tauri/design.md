# v1-skeleton-tauri — 技术设计

## Context

仓库当前为纯规格基线（`docs/`、`openspec/`、`.github/`，无 `src-tauri/`、无 `src/`、无 `package.json`）。V1 全链路（读标签 → 保存 → 搜索）都建立在 Tauri 2 应用壳之上，本变更承担脚手架职责，搭建最小可运行壳，作为后续子变更（v1-folder-list 起）的公共前置依赖。

技术栈基线（定稿，`docs/V1-PRD.md` §7）：外壳 **Tauri 2 + Rust**，前端 **Vue 3 + Vite + TypeScript**（`<script setup>` 组合式 API，单 store 不用 Pinia）。

## Goals / Non-Goals

**Goals:**
- 建立可 `npm run tauri dev` 启动的 Tauri 2 + Vue3/Vite/TS 工程结构（`src-tauri/` + `src/`）。
- 落地设计语言深色优先 token 地基（`docs/design/design.md` §2 色彩系统）。
- 提供 `invoke` 封装 seed 与单 store 骨架（design.md §10.2），为后续 command 接入预留类型安全入口。
- 空壳即可通过 CI 门禁（cargo check/test + npm run build/test + openspec validate）。

**Non-Goals:**
- 不做任何业务功能（文件夹选择、标签读写、搜索均属后续变更）。
- 不接 `rfd`、不引入 `lofty`/`reqwest`/`walkdir` 等业务依赖。
- 不注册任何 Tauri command（`invoke_handler` 留空壳，command 由后续变更逐个注册）。

## 技术方案

### 1. 工程结构（create-tauri-app 等价物）

根目录新增（.gitignore 已覆盖 `node_modules/`、`dist/`、`src-tauri/target/`、`src-tauri/gen/schemas/`）：

```
├── package.json          # scripts: dev/build/test/tauri; devDeps: vite、@vitejs/plugin-vue、typescript、vue-tsc、vitest
├── vite.config.ts        # @vitejs/plugin-vue；tauri dev 的固定端口 + strictPort + host（clearScreen: false）
├── tsconfig.json         # 项目引用根
├── tsconfig.node.json    # vite.config.ts / Node 环境
├── index.html            # 入口 html（深色 <html> 或 CSS 同步渲染，避免闪白）
├── src/
│   ├── main.ts           # createApp(App).mount('#app')
│   ├── App.vue           # 壳：appbar 占位（品牌 + 主题按钮占位），主体空容器
│   ├── lib/tauri.ts      # invoke 类型安全封装 seed（见下）
│   ├── store/song.ts     # 单 store 骨架（见下）
│   ├── styles/theme.css  # 深色优先 token 地基（见下）
│   └── vite-env.d.ts     # /// <reference types="vite/client" />
├── src-tauri/
│   ├── Cargo.toml        # tauri 2、tauri-build 2、serde、serde_json；仅壳所需，无业务依赖
│   ├── build.rs          # tauri_build::build()
│   ├── tauri.conf.json   # productName: MusicTag、identifier、window 配置
│   └── src/
│       ├── main.rs       # 调用 lib run()（mobile 兼容模板形态）
│       └── lib.rs        # run()：Builder.default().invoke_handler(handler)（空壳）
```

> **工程起点决策**：等价于 `create-tauri-app`（Vue-TS 变体）生成结构，**人工搭建**、不依赖模板脚本——保证结构可审、可追溯、符合仓库现状。版本锁定：Tauri 2 系（`tauri`/`tauri-build` 2.x）、Vue 3、Vite 5+、TS 5。

### 2. 变更域判定：both（跨前后端）

- **后端（Rust）**：`src-tauri/` 全部——Cargo.toml、build.rs、tauri.conf.json、main.rs、lib.rs。空壳即可编译。
- **前端（Vue）**：`package.json` 起全部 `src/` 与构建配置——main.ts、App.vue、theme.css、store/song.ts、lib/tauri.ts。

两个方向都必须存在才能 `npm run tauri dev` 起窗，且无业务依赖、无 command 契约变更，**无真实依赖序问题**；但按项目约束「跨前后端默认 Rust → Vue 串行」，实施顺序定为 **Rust 壳先落地（cargo check 绿）→ 前端壳接入（npm run build 绿）→ CI 全绿**。不创建 worktree、不并行。

### 3. 数据流与模块边界

```
Vue (App.vue)  ── 主题按钮占位 / 空状态容器
   │
   ├─ store/song.ts   # reactive 空状态，SongEditor 形态占位（current/original/dirty 接口）
   │
   └─ lib/tauri.ts    # invoke 封装：invokeCommand<T>(cmd, args) → Promise<T>
                        # 后续 list_songs/open_song/save_song/... 全部经由这里
                              │ invoke
                              ▼
Rust lib.rs  # invoke_handler 空壳（本次不注册 command）
```

边界原则：文件 I/O 与网络请求永远走 Rust command，前端只持有界面与状态（PRD §7 架构要点）。本变更只铺**入口**（invoke 封装 + handler 空壳），不铺业务数据流。

### 4. 主题 token 地基（docs/design/design.md §2 落地）

`src/styles/theme.css`：

- **`:root` 缺省深色**：`--bg:#12161A`、`--panel:#1A2026`、`--panel-2:#212830`、`--border:#262D34`、`--text:#E8E9E4`、`--text-dim:#8A939C`、`--accent:#E8A33D`、`--accent-ink:#241A05`、`--danger:#C0553E`、`--success:#3FA36B`、`--hover:rgba(255,255,255,0.05)`、`--active:rgba(232,163,61,0.12)`。
- **`@media (prefers-color-scheme: light)` 覆盖浅色**：`--bg:#F4F4F1`、`--panel:#FFFFFF`、`--panel-2:#F1F0EC`、`--border:#DAD9D2`、`--text:#1E2429`、`--text-dim:#5F6A73`、`--accent:#B4761D`、`--accent-ink:#FFFFFF`、`--danger:#B3452E`、`--hover:rgba(0,0,0,0.045)`。
- **防闪白**：深色为 `:root` 缺省值 → 系统无浅色偏好时渲染即深色，无启动闪白（spec 场景「深色默认渲染」）。
- 手动主题切换 + 持久记忆（FR-7.3 / FR-7.4）由后续 `v1-ux-settings` 实现，本变更只铺 token 地基与跟随系统。

### 5. App.vue 壳形态

- 渲染 appbar 占位：品牌「♪ MusicTag」+ 右侧**主题按钮占位**（ghost 方形 30×30，不实现切换逻辑）。
- 主体空容器（后续 sidebar/editor 挂载点）。
- 不引入任何业务组件、不拉取 store 数据。

### 6. CI 门禁对齐

`.github/workflows/ci.yml` 已存在且对空壳通过（`hashFiles` 守卫自动启用对应 step）：`npm ci` → `npm run build` → `npm run test` → `cargo check --all-targets` → `cargo test --all-targets` → `openspec validate --all --strict`。本变更需保证这些脚本在空壳上即绿：`test` 脚本用 vitest（或 `vue-tsc --noEmit`）空跑通过。

## 关键技术决策

1. **工程起点 = create-tauri-app（Vue-TS）等价结构，人工搭建**：结构可审、不依赖模板脚本、与仓库纯规格基线自然衔接；后续子变更按此结构增量落地，避免模板反复生成产生漂移。
2. **invoke 封装 seed（`src/lib/tauri.ts`）**：统一 command 调用入口，`invokeCommand<T>(cmd, args)` 泛型包装 `@tauri-apps/api/core.invoke`；TS 类型与 `docs/design/design.md` §10.3 契约对齐，后续 command 接入零改动入口。引入依赖 `@tauri-apps/api`。
3. **`invoke_handler` 空壳预留（lib.rs）**：本次不注册 command，但函数签名定型，后续变更逐个 `tauri::generate_handler!` 追加 command，避免反复改入口形态。
4. **单 store 用 `reactive` + `computed`（不用 Pinia）**：design.md §10.2 已定；本变更只铺 `SongEditor` 形态占位（`current`/`original`/`dirty` 接口），不实现对比逻辑。
5. **主题 token 在全局 `theme.css` 以 CSS 自定义属性定义，深色缺省 + `prefers-color-scheme` 浅色覆盖**：语义 token 名与 design.md §2 完全一致，后续组件零改动直接用；手动切换持久记忆留待 `v1-ux-settings`。
6. **不引入任何业务依赖**（lofty/reqwest/walkdir/rfd/image）：本变更是壳，过早引入增加编译面与锁定成本；业务依赖随各自子变更按需引入。

## Risks / Trade-offs

- Tauri 首次 `dev` 编译大量 Rust 依赖较慢，属一次性成本；`cargo check` 首次同慢，CI 冷缓存亦然。
- 前端构建依赖 Node 版本（CI 用 24），本地需一致（`npm ci` 锁定）。
- macOS WebView 首次启动可能需授权弹窗，属平台行为非工程缺陷。
- 若本变更贪多引入业务依赖或 UI 骨架，会模糊与后续子变更的边界——**克制：只铺壳 + token + 入口**。

## 与定稿规格的对齐

- specs `app-shell` 三条 requirement（Tauri2 可启动 / invoke 封装入口 / 深色默认主题地基）全部在本设计覆盖：工程结构、lib/tauri.ts、theme.css。
- 不新增任何超出 specs 的需求；FR-7 其余（手动切换、持久记忆）明确留待 `v1-ux-settings`，属于后续变更职责，非本变更范围。

## 依赖顺序（变更域判定）

- **域**：both（跨前后端）。
- **实施序**：Rust 壳 → 前端壳 → CI 验证（Rust 优先于前端接入，遵循项目 tasks 规则）。
- **不并行、不建 worktree**：无业务耦合，但按约束串行执行。
- **下游**：后续所有子变更（v1-folder-list 起）以本变更的 `src-tauri/` + `src/` + `package.json` + `invoke` 封装为前置依赖。
