# workflow-core 技术设计

## Context

`pipe` / `pipe-epic` 工作流当前由 Claude Code 专属的 Workflow 工具脚本 `.claude/workflows/music-tag-run.js` 承担全部编排。真实踩坑（`v1-ux-polish-layering` Epic + `multi-source-candidates` #115）暴露 5 个结构性短板：

- **P4 自适应编排（最痛）**：`ARCHITECT_SCHEMA.domain` 只有 `['backend','frontend','both']`，无 `docs`/`spec`/`infra` → 纯文档/规格同步任务错入 `both`，空实现/错位实现，tester 卡 `test_failed`，主会话手动补执行。
- **P1 断点续跑**：Workflow 工具 `resumeFromRunId` 重放缓存旧失败（cache key 固定），失败后靠编辑脚本强制 cache-miss 绕过。
- **P2 决断链**：无 leader 决断节点，test/verify/CR 失败直接 `return` 给主会话。
- **P3 子变更并行**：epic 子变更只串行，`epic.json` 已含 `dependsOn` DAG 未利用。
- **P5 跨模型**：流水线绑定 Workflow 工具，Codex 无法驱动。

用户拍板（本变更的约束基线）：
1. **P1-P5 全做**；后续会用 Codex 继续开发，跨模型通用是硬需求。
2. **核心架构原则**：工作流编排是核心能力——**单一模型无关编排核心 + 薄 driver 适配层**，基于核心适配 claude、适配 codex，**不写两套、不维护两套**。
3. **方向 A（已确认）**：外部 node 核心 + CLI 驱动（`claude -p` / `codex exec`），而非宿主原生编排（Claude Workflow 工具 + codex 另写一套）。理由：Codex 无可编程 pipeline 原语，要共享同一份流水线，唯一干净的路是 node 核心 + CLI 驱动。（注：此处原提 claude 侧复用原生 `--agent` 角色，已由 D7 拍板改为 `--append-system-prompt` 注入 roles/ 单源文案，避免双份维护——见 D7。）
4. **决策边界总原则**：涉及用户（人）的决策一律回主会话解决，流水线内绝不自动拍板、不自我扩张需求。
5. **本变更组织**：单变更 `workflow-core`（不拆 epic）。P1-P5 全落同一核心模块，拆分必文件冲突；用新 epic 并行器实现自身是循环依赖。
6. **PRD 初始化**：大变更 `/pipe:init <epic>` 拆子变更、用户批一次总 PRD；中等变更走单变更 `/pipe`。PRD 批准在主会话由用户做。

## Goals / Non-Goals

**Goals:**
- 交付 `.agents/tools/pipe-core/` 模型无关编排核心（纯 node、零依赖）：节点 DAG + 状态机 + 断点续跑（P1）+ 决断链（P2）+ epic 并行（P3）+ 自适应编排（P4）+ 跨模型 driver（P5）。
- 用核心取代 `.claude/workflows/music-tag-run.js`；`/pipe`、`/pipe:epic` 改为调用 `node run.js`。
- 角色文案收敛 `roles/` 单源；claude/codex 两个 driver 引用同一份。
- 保留既有门禁（统一验证基线、CR 复盘三检、前置静态自检）作为新核心规格基线。
- 跨 Claude / Codex 使用方式一致：Claude 斜杠命令薄壳转发，Codex 对话/自定义指令触发，都跑同一份核心。

**Non-Goals:**
- 不改应用功能：不动 `src/`、`src-tauri/` 业务代码。
- 不改动 V1 拍板产品约束。
- 不改 `openspec/specs/` 主规格（本变更无对应 capability，归档只归档 change 本体）。
- 不引入 CI 系统/平台；沿用本地 verify + GitHub CI required checks。
- 不保留旧 Workflow 脚本为双轨（删除，留档在归档 commit）。

## 变更域判定

**infra（纯流程/脚本）**，不触发 Rust/Vue 开发角色。实现集中在新增 `.agents/`（`.agents/tools/pipe-core/` + `.agents/skills/pipe/` + `.agents/runs/`）、改造 `.claude/workflows/`、`.claude/commands/`、`.claude/skills/pipe`（symlink）、`openspec/config.yaml`。对 `src/`、`src-tauri/` 只跑回归验证，不做功能改动。因此开发阶段以「Leader + 流程维护」方式推进，不派 rust-backend/vue-frontend。

## 架构

### 三层结构

```
.agents/                                # 跨框架共享资产根（Codex 原生自动扫描 skills 至 repo root）
├── skills/
│   └── pipe/SKILL.md                   # pipe 流水线总入口（物理唯一；.claude/skills/pipe → symlink 共享）
├── tools/pipe-core/                    # 模型无关编排核心（纯 node，零依赖）
│   ├── run.js            # CLI 入口：node run.js <change> --driver claude|codex [--epic <epic>] [--resume] [--self-check]
│   ├── core.js           # DAG 调度器 + 状态机（就绪集计算、≤N 并发池、条件边）
│   ├── state.js          # 节点级状态文件读写、缓存键、dirty 失效、commit SHA 落地校验
│   ├── decision.js       # P2 决断链：失败 → leader 节点 → retry/reroute/escalate/abort
│   ├── schema.js         # JSON Schema 二次校验（自研轻量，零依赖）
│   ├── dag.js            # 节点定义校验 + 拓扑排序 + 并行批次
│   ├── worktree.js       # P3: git worktree 创建/清理/分支隔离/合并回主
│   ├── roles/            # 角色定义（单一来源，7 角色）
│   └── drivers/
│       ├── claude.js     # claude -p --output-format json --json-schema ... --append-system-prompt roles/<role>.md ...
│       └── codex.js      # codex exec --json --output-schema schema.json -o result.json ...
└── runs/                               # 运行态状态文件（.gitignore）
    ├── <change>/state.json
    └── <epic>/epic-state.json

.claude/                                # Claude Code 专属壳（薄壳 + symlink）
├── skills/
│   └── pipe → ../../.agents/skills/pipe     # symlink（官方支持，git 存 symlink）
├── commands/
│   ├── pipe.md            # /pipe → node .agents/tools/pipe-core/run.js <change> --driver claude
│   ├── pipe-epic.md       # /pipe:epic → node ... --epic <epic> --driver claude
│   └── pipe-init.md / pipe-epic-status.md
├── workflows/
│   ├── pipe-preflight.sh  # 静态自检改调新核心 --self-check
│   └── pipe-epic-preflight.sh
└── agents/                # 7 角色定义（roles/ 迁移的生成参考，迁移后不重复维护）
```

### driver 统一契约

```js
runAgent(task, ctx) → { ok, structured?, raw?, sessionId?, exitCode? }
ctx = { cwd, worktreePath, env, stateFile, nodeId, prompt, schema, maxTurns, allowedTools, model }
```

- **claude driver**：`claude -p <prompt> --output-format json --json-schema '<schema>' --append-system-prompt roles/<role>.md [--cwd <dir>] [--permission-mode bypassPermissions|acceptEdits|...] [--allowedTools ...] [--model ...]` → 解析 `.structured_output`。（D7 拍板：不用 `--agent`，角色文案经 `--append-system-prompt` 注入 `roles/` 单源内容。）
- **codex driver**：`codex exec <prompt> --cd <dir> --sandbox <mode> --output-schema <schemaFile> -o <resultFile> --json [--model ...]` → 读 `resultFile` → 核心二次 schema 校验。
- 角色单源：`roles/` 定义 `{ id, name, systemPrompt, sandbox, allowedTools }`；claude 用 `--append-system-prompt` 注入同一份 role content，codex 把 role.systemPrompt 拼进 exec prompt；两个 driver 引用同一份文案。
- 已知坑（有兜底）：模型输出不稳定 → driver 层 schema 重试 + 核心二次校验；子进程超时 → 外部超时 + SIGTERM；断线 → session_id + 工具 resume（上下文保留）；token → `--max-budget-usd` / usage 字段。

## Decisions

### D1 节点状态机 + 断点续跑（P1）

- 状态文件 `.agents/runs/<change>/state.json`，每节点完成后原子写盘。路径一律以**仓库根**锚定（`path.resolve(repoRoot, '.agents/runs/<change>/state.json')`），worktree 并行场景同样写入主仓库状态目录——续跑/合并/清理均据此寻址，不受子进程 `--cwd` 影响。`.agents/runs/` 与 `.worktrees/` 均入 `.gitignore`。
- **仓库根判定机制**：`run.js`/state.js 解析仓库根依次为——① 环境变量 `PIPE_CORE_REPO_ROOT`（主编排器派生 worktree 子进程 `node run.js <item> --cwd <worktree>` 时注入主仓库绝对路径，worktree 内的 `.git` 是文件指向主仓库，`git rev-parse --show-toplevel` 会解析成 worktree 自身路径，不能直接用作状态根）→ ② `git rev-parse --show-toplevel`（普通直跑场景）→ ③ 报错退出。统一封装为 `state.js#repoRoot()`，单测覆盖 worktree 场景。
- 节点状态机：`pending → ready → running → succeeded | failed | suspended`。
- 节点缓存键 = `hash(nodeId + 输入 hash + 源快照/git ref)`。
- 节点失败 → 标记自身 + 所有依赖节点 dirty；续跑只重跑 dirty 节点，已通过且未污染节点复用结果（DVC 模式）。
- **落地校验**：状态文件记录每节点完成后的 commit SHA；续跑先验证「工作真落地」（commit 存在、diff 在），不信任节点自报 done。
- 工具 resume（`claude --resume` / `codex exec resume`）仅作 driver 层断线恢复（保留上下文），节点状态以核心状态文件为权威。

### D2 决断链（P2）

- 节点失败 → 路由到 leader 决断节点，决策 schema：
  ```js
  { action: 'retry'|'reroute'|'escalate'|'abort', node, reason }
  ```
- `retry` → 重置目标节点 ready（attempts+1，标记 dirty）重跑；`reroute` → 生成 reroute 子节点重派对应开发角色；`escalate`/`abort` → 挂起 run，写挂起报告（节点、原因、候选方案），退出 `suspended`。
- leader 决断节点只做**技术归类**（retry/reroute 不涉及产品方向）；一旦判断需要用户拍板（方向/范围/歧义/CR 三轮不过）→ 立即 `escalate` 挂起，**回主会话**，不自动继续。

### D3 自适应编排（P4）

- domain enum 扩为 `['backend','frontend','both','docs','spec','infra']`。
- 核心按 domain 分支（自适应规则进核心，不硬编码在节点顺序）：
  - `docs`/`spec`：跳过 Rust/Vue 开发与编译验证，只跑文档同步 + openspec validate + 轻量 CR（审文档一致性）。
  - `infra`：跳过业务编译，跑 `node --check` + `--self-check` + openspec validate + 轻量 CR。
  - `backend`/`frontend`/`both`：既有逻辑（both 为 Rust→Vue 串行，TDD，统一验证基线）。
- 开发阶段按 domain 动态组 agent；Tester/CR/Verify 的 prompt 按 domain 调整（文档变更的 Tester 审计文档一致性，非编译测试）。

### D4 子变更并行（P3）

- `/pipe:epic` 读 `epic.json` `dependsOn` DAG → 每批推进无依赖就绪子项，≤3 并行。
- 每个并行子项 = `git worktree add .worktrees/<item> -b <branch>`（独立分支必须，防并写污染——对应记忆 `music-tag-branch-switch-during-workflow` 教训）。worktree 目录须 gitignore。
- 每个子项在各自 worktree 内跑完整 pipe 子流程（子进程调用 `node run.js <item> --cwd <worktree>`）；合并回 main 按依赖拓扑保证前置先合并。
- **前置合并后 refresh**：前置子项合回 main 后，依赖它的后续 worktree 先 `git rebase main`（或 merge）刷新基准，再跑 `git diff main...HEAD` 与开 PR——保证 PR base 含前置改动，避免合并期冲突。
- **cursor 处置**：`epic.json` 的 `cursor` 字段随并行模型废弃，推进判定改以 `.agents/runs/<epic>/epic-state.json` 的就绪集/批次为准；`pipe-epic-preflight.sh`/`pipe-epic-status` 同步改按就绪集判定。
- **并行 checkpoint/崩溃恢复**：每批次（含各 worktree 子项状态）完成后原子落盘 epic-state.json（记录 worktree 路径、批次、子项状态、合并顺序）；崩溃后续跑读该文件恢复未完成子项、不重跑已合并项（对应记忆 `music-tag-branch-switch-during-workflow` 跨机器可恢复教训）。
- epic 并行状态（worktree 路径、批次、合并顺序）写 `.agents/runs/<epic>/epic-state.json`（版本控制外的运行态，`.gitignore`）。

### D5 跨模型 driver（P5）

- `run.js --driver claude|codex` 切换执行后端；核心 + 状态文件 + 任务定义 JSON 全部模型无关。
- 环境自动感知：未显式指定时，按环境变量判断——Claude 环境（`CLAUDECODE`/`AI_AGENT` 含 claude）→ claude driver；Codex 环境 → codex driver；纯终端无法判断 → 要求显式指定，避免猜错。
- 不做「两套逻辑」：claude/codex 都是「一个 agent 节点 → CLI 子进程 → 解析结构化输出」的薄 driver；角色文案单源、schema 单源（核心声明，driver 翻译成 `--json-schema`/`--output-schema`）。

### D6 涉及用户决策回主会话（总原则）

- 核心遇到需人拍板的情形 → 写挂起报告 + 退出 `suspended`，状态文件完整落盘。
- 「主会话」= 当前驱动 run.js 的会话（Claude 或 Codex 皆可），不硬编码死某一平台。
- 用户决策后再次触发带 resume 的同一变更 → 核心读状态文件 → 从挂起节点续跑。
- 各角色不自动拍板、不自我扩张需求：执行中遇到 PRD 之外的需求 → 上报 leader → 需人确认则挂起回主会话。

### D7 角色单源迁移

- 7 角色 system prompt 收敛到 `.agents/tools/pipe-core/roles/`（`{ id, name, systemPrompt, sandbox, allowedTools }`，单文件可注入），**唯一权威源**。
- **拍板：claude driver 走注入，不用 `--agent`**——`--append-system-prompt` 注入 `roles/<role>.md` 同一份内容，保证两 driver 引用同一份文案；不再把 `.claude/agents/*.md` 当运行时来源（其内容作为 roles/ 迁移的生成参考，迁移完成后不与 roles/ 重复维护）。
- codex driver 把 `roles/<role>.md` 内容拼进 exec prompt。
- 关键：**角色文案只有一份**，两个 driver 各自翻译成对应 CLI 形态。

### D8 命令与脚本改造

- `.claude/commands/pipe.md`：`/pipe` 改为调用 `node .agents/tools/pipe-core/run.js <change> --driver claude`（薄壳转发 + 呈现核心输出）。
- `.claude/commands/pipe-epic.md`：`/pipe:epic` 改为调用 `node .agents/tools/pipe-core/run.js --epic <epic> --driver claude`；并行语义写入文档（≤3、依赖拓扑、worktree）。
- `.claude/commands/pipe-init.md` / `pipe-epic-status.md`：保持/适配。
- **pipe skill 物理唯一迁至 `.agents/skills/pipe/SKILL.md`**：Codex 原生自动扫描 `.agents/skills/` 至 repo root（无需配置、symlink 跟随）；`.claude/skills/pipe` 建 symlink → `../../.agents/skills/pipe`（Claude 对 skills symlink 官方支持，git 存 symlink）。文档同步新架构（核心 + driver、断点续跑、决断链、并行、决策边界）。
- `.claude/workflows/pipe-preflight.sh`：保留前置校验，静态自检改调新核心 `--self-check`（Node `node --check` + shell `bash -n`，fail-closed）。
- `.claude/workflows/pipe-epic-preflight.sh`：适配并行状态（按就绪集而非 cursor 判定）。
- **仓库根 `AGENTS.md`（新增，P5 落地闭环）**：初始化 Codex 项目级指令——项目约定 + pipe 入口触发方式（`node .agents/tools/pipe-core/run.js <change> --driver codex`、`--epic <epic>`）。**只放入口指针与项目约定，不承载角色文案**（roles/ 单源）。让 Codex 会话说「跑 pipe <变更>」即识别入口，无需记忆命令。
- `.claude/CLAUDE.md`：同步移除对已删除 Workflow 脚本 `.claude/workflows/music-tag-run.js` 的引用，多 Agent 协作/常用命令段指向新核心。
- `openspec/config.yaml`：`workflow` 类规则补充「流程脚本变更须附带 `--self-check` 通过证据」。

### D9 旧脚本移除与归档

- `.claude/workflows/music-tag-run.js` 删除；删除前在归档 commit 留档（git 历史可回溯），不保留双轨。

### D10 本变更自举

- 本变更域 `infra`，由**旧 pipe**（`/pipe workflow-core`，Workflow 工具）跑完。
- 旧脚本打 **infra 三处补丁**（先行提交 main，只改旧脚本、随本变更 D9 删除，不碰新核心）：
  1. `ARCHITECT_SCHEMA.domain` enum 加 `infra`；
  2. 开发段加 infra 分支：`infra`/`docs`/`spec` 域派 1 个 `leader` 流程维护 agent 实现（scope 指 `.agents/`、`.claude/`、`openspec/`、`AGENTS.md`，`DEV_SCHEMA` 不变）——否则 infra 域 `devResults` 为空、`!devResults.length` 守卫直接 `failed`；
  3. 验证段加 infra 分支：`infra`/`docs`/`spec` 域跑 `node --test` 核心单测 + `run.js --self-check` + `openspec validate`，跳过 cargo/npm（P4 语义，避免 verify-agent 读 tasks.md infra 语义与硬编码基线打架）。
- 新核心实现并测试通过后，合回 main；后续 `/pipe`/`/pipe:epic` 指向新核心。

## Risks / Trade-offs

- **方向 A 的成本**：每个节点是独立 CLI 进程（冷启动、节点间无共享会话上下文）。缓解：状态文件 + 续跑，已通过节点复用、失败节点才重跑，重试便宜；claude 侧 `--append-system-prompt` 注入 `roles/` 单源角色文案并配合 `--allowedTools` 控制工具集，能力不缩水。
- **codex `--output-schema` 强制力不确定**：核心对落盘结果做二次 schema 校验，失败按节点失败处理（已设计）。
- **codex 本机可用但可能无 OpenAI 认证**：P5 完整验收依赖本机认证；未配置则 codex driver 显式报「配置缺失」，验收以 claude driver 全绿 + **codex driver 命令构造正确（单测断言参数拼装与输出解析，任务化落地）** 为准。
- **新核心首次实战回归风险**：保留旧脚本归档 commit 可回溯；本变更自身走旧 pipe 验证新核心测试全绿再切换；合回后首个真实 `/pipe` 变更以 `--self-check` + 手工盯跑过渡。
- **并行引入的复杂度**：worktree 管理、依赖拓扑合并顺序、epic-state.json 状态。缓解：独立模块（worktree.js）+ 单测（mock git）；并行上限 ≤3 保守；worktree 残留清理与文件级冲突缓解同此模块处理。
- **并行子项文件级冲突**：dependsOn 只表达语义依赖，不表达文件级重叠——两个无依赖子项同改同一文件会在合并期冲突。缓解：合并前 refresh 时暴露冲突、由核心提示主会话处置；epic 并行 ≤3 且同域（frontend/backend）子项优先串行，降低同文件重叠概率。
- **决策边界的摩擦**：涉及用户决策一律挂起回主会话，可能比「自动继续」慢。权衡：符合「不自动拍板」原则，且挂起时状态已落盘、一句话决策后续跑，成本可控。
- **状态文件演进**：`state.json`/`epic-state.json` 全新格式，核心演进期最易改动。缓解：两文件含 `schemaVersion` 字段，迁移兼容处理。
- **跨环境行为差异**：codex 无 `--agent` 角色加载，靠 prompt 注入；claude 走注入（同 roles/ 单源）。缓解：角色文案单源，driver 各自翻译，行为对齐由 `--self-check` + 单测覆盖。

## 任务拆分建议

依赖顺序（纯 infra，单线程推进，无需分 Rust/Vue 组）：

1. **自举补丁（D10）**：旧脚本 `ARCHITECT_SCHEMA.domain` enum 加 `infra`（一行，先行提交）。
2. **核心骨架（D1、D5、D9）**：`.agents/tools/pipe-core/` 目录、`run.js`、`core.js`、`state.js`、`schema.js`、`dag.js`、`drivers/claude.js`、`drivers/codex.js`、`roles/`；`.agents/skills/pipe/` 与 `.claude/skills/pipe` symlink。
3. **决断链（D2）**：`decision.js`。
4. **自适应编排（D3）**：domain 分支、按 domain 动态组 agent、Tester/CR/Verify prompt 调整。
5. **并行（D4）**：`worktree.js`、epic 执行器改造。
6. **命令与脚本（D8）**：`pipe*.md`、SKILL.md、preflight 脚本、**根 `AGENTS.md` 初始化**、`.claude/CLAUDE.md` 同步、config.yaml。
7. **旧脚本移除（D9）**：删除 `music-tag-run.js`，归档 commit 留档。
8. **验证**：`node --test` 核心单测 + 集成 resume 测试 + `--self-check`；`openspec validate workflow-core --strict --no-interactive`；对 `src/`、`src-tauri/` 跑回归验证（cargo test、npm run test、npm run build）确认未破坏既有构建。

> 说明：本变更为纯 infra，不派 rust-backend/vue-frontend；「开发」阶段由 Leader/流程维护直接改 `.agents/tools/pipe-core/`、`.agents/skills/pipe/` 与 `.claude/`，提交走 `feat(106): <任务>` 增量提交。
