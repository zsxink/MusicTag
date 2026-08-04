# infra-codegraph 技术设计

## Context

项目与全局 CLAUDE.md 均声明「有 CodeGraph 索引的项目用 `codegraph_explore`（MCP）或 `codegraph explore`（shell）定位/理解代码，优先于 grep/find」，但本仓库 `.codegraph/` 尚不存在（`codegraph status` 返回 "Not initialized"），该规则实际处于空转状态。V1 开发期定位 Tauri command（`save_song`/`open_song` 等）的调用链多靠 grep + Read 循环。codegraph 是 SQLite 知识图谱索引（符号/边/文件），`codegraph init` 在项目根建 `.codegraph/` 索引，`codegraph explore "<符号或问题>"` 一次返回相关符号的源码与调用路径。本变更把该基础设施落地并确认其不干扰既有流程。

## Goals / Non-Goals

**Goals:**
- 在仓库根执行 `codegraph init` 建立 `.codegraph/` 索引，覆盖 Rust 后端（`src-tauri/`）与 Vue 前端（`src/`）。
- 接入后定位/理解代码优先走 codegraph explore（MCP `codegraph_explore` 或 shell `codegraph explore`），替代 grep + Read 循环；未命中时回退 grep/find（不阻断）。
- 建立索引维护姿势：`codegraph sync`（增量更新，日常）/ `codegraph index`（全量重建，过期损坏时）/ `codegraph status`（查看状态）。
- 确认索引不影响既有构建/验证：`cargo check`、`npm run build`、`openspec validate`。
- 决策并落地 `.codegraph/` 的 git 归属：**忽略**（加入 `.gitignore`），PR 说明中写明理由。

**Non-Goals:**
- 不改动 `docs/V1-PRD.md` / `docs/design/design.md` 产品规格——本变更是纯开发工具基建，不涉及产品行为。
- 不改写 `.claude/CLAUDE.md` 的工作流约定文字（「有索引才用 explore、未建索引跳过」的规则已正确，本次只是让「有索引」成立）。
- 不为 codegraph 编写 CI 集成或索引保鲜机制（自用工具线，索引过期手动 `sync` 即可）。
- 不引入任何新依赖（codegraph 为已装 CLI，不进 `Cargo.toml` / `package.json`）。

## 变更域判定

**infra（纯基建）**，不涉及 Rust 代码或 Vue 代码改动，无前后端协作，无 worktree 并行写风险。单任务串行即可。

## Decisions

### D1 索引位置与初始化命令

- 在仓库根 `/Users/xian/Project/music/MusicTag/` 执行 `codegraph init`。
- 生成 `.codegraph/` 目录（SQLite 索引 + 元数据），不指定子路径（覆盖全仓库源码：`src/`、`src-tauri/` 等）。
- 初始化后 `codegraph status` 应显示已初始化（Project 指到仓库根，非 "Not initialized"）。

### D2 索引维护姿势

- **日常**：`codegraph sync`（增量同步代码变更后的索引）。
- **过期/损坏**：`codegraph index`（全量重建，结果等价于重新 init）。
- **状态查看**：`codegraph status`。
- **彻底移除**：`codegraph uninit`（删除 `.codegraph/`，无残留）。
- 自用工具线，不做 CI 保鲜；谁用谁 sync。

### D3 接入工作流：explore 优先、grep 兜底

- 定位符号/理解调用链：优先 `codegraph explore "<符号或问题>"`（或 MCP `codegraph_explore`），一次拿相关符号源码 + 调用路径。
- 未命中或索引不可用：回退 grep/find + Read（既有工作流不变）。
- 不修改 `.claude/CLAUDE.md` 规则文字——「有索引才用、未建索引跳过」的描述在本次落地后即自然成立，无需改动。

### D4 `.codegraph/` 的 git 归属：忽略

- 决策：**`.codegraph/` 进 `.gitignore`**。
- 理由：
  1. `.codegraph/` 是本地生成索引产物（SQLite 二进制），随代码变更持续重建，非源码、非可审查 diff。
  2. 纳入 git 会带来大体积二进制 diff 与合并噪音，收益为零（索引可通过 `codegraph index` 随时重建）。
  3. 与既有忽略策略一致：`node_modules/`、`dist/`、`src-tauri/target/` 同为「本地产物，不进 git」。
- 落地：`.gitignore` 追加一行 `.codegraph/`（归入「构建产物」或独立注释分组）。
- **git 忽略不影响工具可用性**：codegraph 直接读文件系统上的 `.codegraph/`，与 git 跟踪无关；`git status` 不再显示该目录即为忽略生效。

### D5 构建/验证零影响确认

- `.codegraph/` 不在 Rust 编译目标（`src-tauri/target/`）或 Vite 源码扫描路径（`src/`、`index.html`）内，纯工具读取。
- 确认手段：`cargo check --manifest-path src-tauri/Cargo.toml`、`npm run build`、`openspec validate` 在索引建立前后各跑一次，结果一致。
- 仅 `.gitignore` 一个 git 文件变更，无产品代码 diff，构建影响面理论上为零，验证仅作回归保险。

### D6 PR 说明要求

- PR 描述需写明：`.codegraph/` 被忽略的决策及理由（本地索引产物，可随时 `codegraph index` 重建）；索引建立后如何用 `codegraph explore` 定位代码；`Closes #51`。

## Risks / Trade-offs

- **索引过期**：代码变更后索引可能滞后（新增符号查不到）。**缓解**：日常 `codegraph sync`；未命中时 grep 兜底，不阻断。自用工具线可接受。
- **忽略决策可逆**：若未来想共享索引（如 CI 用它做测试影响分析），从 `.gitignore` 移除并 `git add -f .codegraph/` 即可，无结构性包袱。
- **索引体积**：SQLite 索引随代码规模增长。仓库体量小（V1），开销可忽略；必要时 `codegraph uninit` 重建/清除。
- **工具依赖**：explore 依赖 codegraph CLI/MCP 可用。CLI 已装；缺失时回到 grep/find 工作流，不影响开发。

## 任务拆分建议

依赖顺序：**初始化 → 验证 → git 决策 → 回归验证**（纯 infra，串行）：

1. **建立索引**：仓库根 `codegraph init` → `codegraph status` 确认已初始化。
2. **explore 验证**：`codegraph explore "save_song"`（或 MCP `codegraph_explore`）命中 V1 既有符号，确认返回源码与调用路径。
3. **git 决策落地**：`.gitignore` 追加 `.codegraph/` → `git status` 确认目录不再显示为未跟踪。
4. **回归验证**：索引建立后重跑 `cargo check` + `npm run build` + `openspec validate`，与建立前结果一致。
