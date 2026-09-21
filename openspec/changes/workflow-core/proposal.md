# proposal: workflow-core

## Why

`pipe` / `pipe-epic` 工作流（`.claude/workflows/music-tag-run.js` 等）在 Epic 与单变更执行中暴露 5 个结构性短板。真实踩坑验证（`v1-ux-polish-layering` Epic + `multi-source-candidates` #115）：

- **P4 自适应编排（最痛）**：纯文档/规格同步任务落入 scope 缺口——旧脚本 `domain` 只有 `['backend','frontend','both']`，无 `docs`/`spec`/`infra` 类型 → 文档类任务错入 `both`，空实现/错位实现，tester 卡 `test_failed`，主会话手动补执行。
- **P1 断点续跑失效**：Workflow 工具 `resumeFromRunId` 重放缓存旧失败（cache key 固定），失败后靠编辑脚本强制 cache-miss 绕过。
- **P2 无决断链**：workflow 内无 leader 决断节点，test/verify/CR 失败直接 `return` 给主会话，无「自动归类 → 重跑 → 上报」的中间层。
- **P3 子变更只串行**：epic 子变更逐个跑，`epic.json` 已含 `dependsOn` DAG 但未利用，无并行。
- **P5 只认 Claude**：流水线逻辑完全绑定 Workflow 工具（Claude Code 专属），后续会用 Codex 驱动的需求无法满足。
- **P6 跨 Agent 产品仍未闭环（复核追加）**：当前实现只提供 `claude` / `codex` 两个 CLI driver，核心默认脚本路径仍位于 `.claude/workflows/`，角色权限仍使用 Claude 工具名，集成节点仍依赖 `/opsx:*` 斜杠命令；因此“模型无关”已经成立，但尚不能直接在 OpenCode 等第三方 Agent 产品中复用。

用户拍板：**P1-P5 全做**；后续会用 Codex 继续开发，跨模型通用是硬需求。PR #118 复核后追加 **P6 跨 Agent 产品通用化**：同一核心至少在 Claude Code、Codex、OpenCode 三端可执行，并为其他 CLI Agent 保留稳定扩展契约。

## What Changes

把「工作流编排」从 Claude 专属的 Workflow 工具脚本中解耦，重构为**模型无关的编排核心 + 薄 driver 适配层**——核心一份（纯 node、零依赖），Claude / Codex 是可插拔执行器（driver），**不写两套、不维护两套**。

### 新增 `.agents/tools/pipe-core/`（模型无关编排核心，跨框架共享资产收敛 `.agents/`）

```
.agents/                                # 跨框架共享资产根（Codex 原生自动扫描 skills 至 repo root）
├── skills/
│   └── pipe/SKILL.md                   # pipe 流水线总入口（物理唯一；.claude/skills/pipe → symlink 共享）
├── tools/pipe-core/
│   ├── run.js            # CLI 入口：node run.js <change> --driver claude|codex [--epic <epic>] [--resume] [--self-check]
│   ├── core.js           # DAG 调度器 + 状态机（就绪集计算、≤N 并发池、条件边）
│   ├── state.js          # 节点级状态文件读写、缓存键、dirty 失效、commit SHA 落地校验
│   ├── decision.js       # P2 决断链：失败 → leader 节点 → retry/reroute/escalate/abort
│   ├── schema.js         # JSON Schema 二次校验（自研轻量，零依赖）
│   ├── dag.js            # 节点定义校验 + 拓扑排序 + 并行批次
│   ├── worktree.js       # P3: git worktree 创建/清理/分支隔离/合并回主
│   ├── roles/            # 角色定义（单一来源）
│   └── drivers/
│       ├── claude.js     # claude -p --output-format json --json-schema ... --append-system-prompt roles/<role>.md ...
│       └── codex.js      # codex exec --json --output-schema schema.json -o result.json ...
└── runs/                               # 运行态状态文件（.gitignore）
    ├── <change>/state.json
    └── <epic>/epic-state.json
```

**跨框架共享目录——方案 A（用户拍板）**：技能/工具/运行态统一收敛到 `.agents/`，Claude 侧留 symlink + 薄壳，**不写两套、不维护两套**：
- `.agents/skills/pipe/SKILL.md` —— pipe skill **物理唯一**（Codex 原生自动扫描 `.agents/skills/` 至 repo root，无需配置、symlink 跟随）；`.claude/skills/pipe` → `../../.agents/skills/pipe` symlink（Claude 对 skills symlink 官方支持，git 存 symlink）。
- `.agents/tools/pipe-core/` —— 编排核心（普通 JS，非框架发现物，放 `.agents/` 统一管理；两边 `node` 直调路径一致）。
- `.agents/runs/` —— 运行态状态文件，`.gitignore` 不入库。
- `.claude/commands/pipe*.md`（斜杠命令）留在 `.claude/commands/`——Claude 专属入口，Codex 无斜杠命令体系、靠根 `AGENTS.md` 识别入口，无共享需求。

### 替换 `.claude/workflows/music-tag-run.js`

旧 Workflow 脚本删除（留档在归档 commit），流水线逻辑改为核心的**节点定义数据**：preflight → architect → dev（按 domain 自适应）→ tester → CR（≤3 轮）→ verify → integrate（leader 归档/PR/合并）。`/pipe` 命令改为调用 `node .agents/tools/pipe-core/run.js`。

### `/pipe:epic` 改造

epic 执行器读 `epic.json` 的 `dependsOn` DAG → 每次推进就绪子项 ≤3 并行（每项独立 worktree + 独立分支跑完整 pipe 子流程）→ 按依赖拓扑合并回 main。

### 更新命令与脚本

`.claude/commands/pipe*.md`、`.agents/skills/pipe/SKILL.md`（+ `.claude/skills/pipe` symlink）、`.claude/workflows/pipe-preflight.sh` 改调新核心；角色 system prompt 收敛到 `.agents/tools/pipe-core/roles/` 单源；初始化仓库根 `AGENTS.md`（Codex 项目级指令：项目约定 + pipe 入口触发方式），并同步 `.claude/CLAUDE.md` 移除对已删除 Workflow 脚本的引用。

### P6：跨 Agent 产品通用化（复核追加）

在既有模型无关核心上增加稳定的 **Agent Runtime Adapter**，把产品差异限制在 driver 和入口薄壳：

- 新增 `drivers/opencode.js`，通过 `opencode run --format json --dir <cwd>` 执行节点，解析 NDJSON 事件并提取最终 assistant 输出；OpenCode 无原生 output-schema 时，由 prompt JSON envelope + 核心二次 schema 校验保证结构化契约。
- 抽出 `drivers/contract.js` 与 driver registry，统一 `runAgent(task, ctx)` 输入、标准结果、错误分类、超时/终止语义和能力声明；`run.js` 不再硬编码 driver import、枚举和帮助文本。
- 将 `roles.json` 的 Claude 工具名改为产品无关 capability（`shell/read_files/write_files/search_files/git_read/git_write/network`），由各 driver 映射为宿主权限；不能满足角色最小能力时 fail-closed。
- 将 preflight/epic-preflight 从 `.claude/workflows/` 移至 `.agents/workflows/`；核心只调用中立脚本路径，`.claude/` 仅保留兼容薄壳。
- 核心节点不得依赖 `/opsx:*`、`/pipe` 等宿主斜杠命令；统一调用可执行的 `openspec`、`git`、`gh` 或 `.agents/commands/*.js`，斜杠命令只负责转发核心 CLI。
- 为 Claude Code、Codex、OpenCode 分别保留入口薄壳；所有入口最终执行同一条 `node .agents/tools/pipe-core/run.js ... --driver <name>`。
- 增加 driver conformance suite：同一组 fake runtime 用例覆盖结构化输出、权限、cwd、认证失败、超时、SIGTERM、挂起、resume 和 epic worktree 隔离；真实 CLI smoke test 按本机可用性执行，缺失认证必须显式 skip/fail，不得静默换 driver。

### 决策边界（确立为总原则）

**涉及用户（人）的决策，一律回主会话解决**，流水线内绝不自动拍板、不自我扩张需求：
- 初始化（PRD 批准）：大变更 `/pipe:init <epic>` 拆子变更，用户在**主会话**批一次总 PRD（唯一强制确认点）；中等变更走单变更 `/pipe`。
- 流水线内挂起（CR 三轮不过 / 验证反复不过 / 需求歧义 / 方向变化）：run.js 写挂起报告 → 退出 `suspended` → 当前驱动它的会话即主会话 → 用户一句话决策 → 从断点续跑。

## Capabilities

### New Capabilities
- `workflow-core`: 模型无关编排核心——节点 DAG + 状态机 + 断点续跑（P1）+ 决断链（P2）+ epic 并行（P3）+ 自适应编排（P4）+ 跨模型 driver（P5）+ 跨 Agent 产品通用化（P6）

### Modified Capabilities
- `workflow-optimize`（既有）：本变更以 `workflow-core` 取代其 Workflow 工具实现路径；既有门禁（CR 复盘维度、统一验证基线、前置自检）作为新核心的规格基线保留。
  - （继承标注：`workflow-optimize` 属已归档变更，`openspec/specs/` 无对应 capability；此「修改」仅是**继承/取代标注**，非主规格锚点——与项目「流程类变更归档时无主规格同步」惯例一致，归档只归档 change 本体，spec 中对应两条门禁也以「继承」方式列入 `workflow-core` 基线。）

## 关联 Issue

- GitHub Issue：`#106`（变更前已建，作为本变更锚点；分支 `workflow-core`、PR 引用 `Closes #106`）。

## Impact

- 影响面：开发流程基础设施（新增 `.agents/tools/pipe-core/` + `.agents/skills/pipe/` + `.agents/runs/` + `.agents/workflows/`；替换 `.claude/workflows/music-tag-run.js`；改 `.claude/commands/pipe*.md`、`.agents/skills/pipe/SKILL.md`、`.claude/skills/pipe`（symlink）、OpenCode 项目入口、`openspec/config.yaml`）。
- 与后续变更的关系：本变更合回 main 后，后续所有变更走 `node .agents/tools/pipe-core/run.js --driver claude|codex|opencode`；新增 Agent 只实现 driver contract 与入口薄壳，不复制 pipeline。
- 不改应用功能：无 Rust/前端业务代码改动；对 `src/`、`src-tauri/` 只做回归验证，不做功能改动。
- 本变更自身域为 `infra`：开发/验证阶段不跑 cargo/npm（无业务代码变更、不以编译作为门禁），跑核心单测 + 静态自检 + openspec validate；交付前对既有代码跑回归验证确认未破坏构建。
- 归档时无主规格同步（`openspec/specs/` 无对应 capability 变更），只需归档 change 本体并随分支提交。
