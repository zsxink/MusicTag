## Why

项目规则与全局规则均已声明「有 CodeGraph 索引的项目用 `codegraph_explore` / `codegraph explore` 定位/理解代码，优先于 grep/find」，但本仓库尚未建立索引（`.codegraph/` 不存在，规则里注明「本项目暂未建索引时跳过」）。V1 开发期定位符号、追踪 Tauri command 调用链多靠 grep + Read 循环。本变更在仓库根执行 `codegraph init` 建立 `.codegraph/` SQLite 知识图谱索引，把「先 explore 后 grep」从规则文字落地为可用的基础设施，并确认它不干扰现有构建/验证、厘清 `.codegraph/` 的 git 归属。

## What Changes

- 在仓库根执行 `codegraph init`，生成 `.codegraph/` 索引（符号/边/文件知识图谱），并建立日常增量维护姿势（`codegraph sync` / `codegraph status`）。
- 接入后定位/理解代码优先走 `codegraph explore`（MCP `codegraph_explore` 或 shell `codegraph explore`），替代 grep + Read 循环；索引缺失/未命中时回退 grep/find（与既有规则一致，不改 CLAUDE.md 工作流约定文字）。
- `.gitignore` 处理（本变更的可验收决策点，见 spec「仓库根存在 `.codegraph/` 索引」Requirement）：**决策为忽略 `.codegraph/`**——它是本地生成索引产物（SQLite 二进制、随代码变更持续重建），非源码；纳入 git 会造成大体积二进制 diff 与合并噪音。忽略仅影响 git 跟踪，不影响 codegraph 工具读取。
- 确认 `codegraph init` 不影响既有构建/验证：`cargo check`、`npm run build`、`openspec validate` 均不受 `.codegraph/` 存在影响（索引目录不在 Rust 编译目标或 Vite 源码扫描路径内）。

## Capabilities

### New Capabilities
- `infra-codegraph`: 仓库根 `.codegraph/` 索引 + explore 优先的代码定位 + `.gitignore` 忽略决策（不影响构建/验证）

### Modified Capabilities
（无）

## 关联 Issue

- GitHub Issue：`#51`（Epic「项目基建初始化」总 Issue #48 的子变更；分支提交 `feat(51): ...`、PR `Closes #51`）

## Impact

- **仓库根新增 `.codegraph/` 目录**（本地生成、不进 git）：体积随代码规模增长，可随时 `codegraph uninit` 清除重建，无持久副作用。
- **`.gitignore` 新增一行**：`.codegraph/` 进忽略列表（本次唯一写 git 的文件变更；不含任何产品代码改动）。
- **不新增依赖**：codegraph 为开发工具（CLI 已装），不进 `Cargo.toml` / `package.json`。
- **对产品行为零影响**：不触碰 Rust 后端、Vue 前端、Tauri command 契约；仅影响开发者「如何定位/理解代码」的工作流，并保持与既有规则（CodeGraph 一节）一致。
- 后续变更（V1 后续、V2）均可直接复用该索引做代码定位/影响面分析（`codegraph impact`）。
