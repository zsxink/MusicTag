# workflow-core 任务清单

> 变更域：infra（纯流程/脚本），不派 rust-backend/vue-frontend。依赖顺序：自举补丁 → 核心骨架 → 决断链 → 自适应编排 → 并行 → 命令与脚本 → 旧脚本移除 → 验证。
> **组间依赖边**：组 2（核心骨架）无前置组依赖，先行；组 3（决断链）依赖组 2 的 core.js；组 4（自适应编排）依赖组 2 的 core/run；组 5（并行）依赖组 2 的 run.js + 独立 worktree.js；组 6（命令与脚本）依赖组 2 的 run.js（薄壳调用入口存在后）；组 7（旧脚本移除）依赖组 6 完成（/pipe 已指向新核心）；组 8（验证）贯穿各组的伴随单测 + 收尾回归/PR。组内按序勾选；每批完成做 `feat(106): <任务>` 增量提交。

## 1. 自举补丁：旧脚本加 infra 三处（design.md D10）

> ✅ **已完成（commit `e4a61f3 feat(106): infra domain`，已在 main）**——旧 pipe（Workflow 工具）启动本变更时脚本已带 infra 支持。本组无需再做；仅当开发/验证阶段发现旧脚本仍有 infra 语义遗漏时补丁。此补丁只改旧脚本、随本变更删除（D9），不碰新核心。

- [x] 1.1 `.claude/workflows/music-tag-run.js`：`ARCHITECT_SCHEMA.domain` enum 加 `infra`（已验证：现 enum 为 `['backend','frontend','both','infra']`）
- [x] 1.2 开发段加 infra 分支：`infra`/`docs`/`spec` 域 → 派 1 个 `leader` 流程维护 agent 实现（scope 指 `.agents/`、`.claude/`、`openspec/`、`AGENTS.md`，`DEV_SCHEMA` 不变），避免 `devResults` 为空触发失败守卫（已验证：`if (['infra','docs','spec'].includes(domain))` 分支存在）
- [x] 1.3 验证段加 infra 分支：`infra`/`docs`/`spec` 域 → 跑 `node --test` 核心单测 + `run.js --self-check` + `openspec validate`，跳过 cargo/npm（P4 语义；已验证：verify prompt 按 domain 短路）
- [x] 1.4 提交 `feat(106): infra domain`（在 main，先于 `/pipe workflow-core` 启动）——已提交 e4a61f3

## 2. 核心骨架（design.md D1、D5、D7）

- [x] 2.1 建 `.agents/` 资产根 + `.agents/tools/pipe-core/` 目录 + 模块脚手架（run.js / core.js / state.js / schema.js / dag.js / decision.js / worktree.js / roles/ / drivers/）
- [x] 2.2 `roles/`：7 角色定义单源（leader/architect/rust-backend/vue-frontend/cr-agent/verify-agent/tester，systemPrompt + sandbox + allowedTools）；**迁移来源**：`.claude/agents/*.md` 既有定义作为生成参考，迁移完成后不再作为运行时来源、不与 roles/ 重复维护（D7）
- [x] 2.3 `drivers/claude.js`：`claude -p --output-format json --json-schema ... --append-system-prompt-file roles/<role>.md [--cwd] [--permission-mode] [--allowedTools] [--model]` → 解析 `.structured_output`（D7：不用 `--agent`）
- [x] 2.4 `drivers/codex.js`：`codex exec --cd --sandbox --output-schema -o --json [--model]` → 读 `resultFile` + 核心二次校验
- [x] 2.5 `schema.js`：自研轻量 JSON Schema 校验（type/required/enum/items/properties/anyOf 子集）
- [x] 2.6 `state.js`：节点状态机 + 状态文件读写（原子写盘，仓库根锚定 `.agents/runs/<change>/state.json`）+ 缓存键 + dirty 失效 + commit SHA 落地校验 + `repoRoot()` 仓库根判定（`PIPE_CORE_REPO_ROOT` → `git rev-parse --show-toplevel` → 报错）
- [x] 2.7 `dag.js`：节点定义校验 + 拓扑排序 + 就绪集计算
- [x] 2.8 `core.js`：DAG 调度器（≤N 并发池、条件边、状态转换、driver 调用）
- [x] 2.9 `run.js`：CLI 入口（`<change> --driver claude|codex [--epic <epic>] [--resume] [--self-check]`）；环境自动感知（未指定 driver 时按环境变量判断，无法判断则要求显式）
- [x] 2.10 `.gitignore`：`.agents/runs/` 与 `.worktrees/` 不入库

## 3. 决断链（design.md D2）

- [x] 3.1 `decision.js`：节点失败 → leader 决断节点 → `{ action: retry|reroute|escalate|abort, node, reason }`
- [x] 3.2 `retry` → 重置目标节点 ready（attempts+1，标记 dirty）；`reroute` → 生成 reroute 子节点；`escalate`/`abort` → 挂起 run + 写挂起报告 + 退出 `suspended`
- [x] 3.3 涉及用户决策 → 一律 escalate 回主会话，不自动继续

## 4. 自适应编排（design.md D3）

- [x] 4.1 domain enum 扩为 `['backend','frontend','both','docs','spec','infra']`（architect 节点 schema）
- [x] 4.2 核心按 domain 分支：docs/spec → 文档同步 + openspec validate + 轻量 CR；infra → `--self-check` + openspec validate + 轻量 CR；backend/frontend/both → 既有逻辑
- [x] 4.3 开发阶段按 domain 动态组 agent；Tester/CR/Verify prompt 按 domain 调整

## 5. 子变更并行（design.md D4）

- [x] 5.1 `worktree.js`：`git worktree add .worktrees/<item> -b <branch>` + 清理 + 合并回主 + 依赖拓扑保证前置先合并
- [x] 5.2 `.worktrees/` 加入 .gitignore
- [x] 5.3 epic 执行器：读 `epic.json` `dependsOn` → 每批就绪子项 ≤3 并行；子进程 `node run.js <item> --cwd <worktree>`，派生时以 **`PIPE_CORE_REPO_ROOT` 环境变量**注入主仓库绝对路径（见 D1 仓库根判定；不用 worktree 自身 `git rev-parse` 结果作状态根）
- [x] 5.4 epic 并行状态写 `.agents/runs/<epic>/epic-state.json`（worktree 路径、批次、合并顺序、schemaVersion）；`cursor` 字段废弃，推进判定按就绪集/批次
- [x] 5.5 前置子项合回 main 后，依赖它的后续 worktree 先 `git rebase main` 刷新基准，再 `git diff main...HEAD` 与开 PR（避免合并期冲突）

## 6. 命令与脚本（design.md D8）

- [x] 6.1 `.claude/commands/pipe.md`：`/pipe` 改调 `node .agents/tools/pipe-core/run.js <change> --driver claude`
- [x] 6.2 `.claude/commands/pipe-epic.md`：`/pipe:epic` 改调 `node .agents/tools/pipe-core/run.js --epic <epic> --driver claude`；并行语义写入文档（≤3、依赖拓扑、worktree）
- [x] 6.3 `.claude/commands/pipe-init.md` / `pipe-epic-status.md`：适配新架构
- [x] 6.4 pipe skill 迁移到 `.agents/skills/pipe/SKILL.md`（物理唯一）+ `.claude/skills/pipe` → `../../.agents/skills/pipe` symlink（Claude 侧共享同一份）；文档同步新架构（核心 + driver、断点续跑、决断链、并行、决策边界）
- [x] 6.5 `.claude/workflows/pipe-preflight.sh`：前置校验改调新核心 `--self-check`（Node `node --check` + shell `bash -n`，fail-closed）
- [x] 6.6 `.claude/workflows/pipe-epic-preflight.sh`：适配并行状态（按就绪集而非 cursor 判定）
- [x] 6.7 仓库根 `AGENTS.md`（新增，P5 落地闭环）：初始化 Codex 项目级指令——项目约定 + pipe 入口触发方式（`node .agents/tools/pipe-core/run.js <change> --driver codex`、`--epic <epic>`）；只放入口指针与项目约定，不承载角色文案（roles/ 单源）
- [x] 6.8 `.claude/CLAUDE.md`：同步移除对已删除 Workflow 脚本 `.claude/workflows/music-tag-run.js` 的引用，多 Agent 协作/常用命令段指向新核心
- [x] 6.9 `openspec/config.yaml`：`workflow` 类规则补「流程脚本变更须附带 `--self-check` 通过证据」

## 7. 旧脚本移除（design.md D9）

- [x] 7.1 删除 `.claude/workflows/music-tag-run.js`（归档 commit 留档，git 历史可回溯，不保留双轨）——须在组 6 完成后执行（/pipe 已指向新核心才安全）

## 8. 验证

- [x] 8.1 核心单测（`node --test`）：DAG 调度（拓扑序/就绪集/≤N 并发）、状态机转换、缓存键与 dirty 失效、决断路由、schema 校验、worktree 路径/分支逻辑（mock git）
- [x] 8.2 driver 命令构造单测（mock 子进程）：断言 `.agents/tools/pipe-core/drivers/claude.js`/`codex.js` 的 CLI 参数拼装与 `--json-schema`/`--output-schema` 翻译、`.structured_output`/resultFile 解析、schema 重试、环境自动感知（env 检测分支 → 自动选 driver / 无法判断要求显式）
- [x] 8.3 集成测试：迷你 DAG（3 节点 + mock driver）含 resume——故意让某节点失败 → resume → 断言仅失败节点重跑、已通过节点复用
- [x] 8.4 epic 调度器单测（mock epic.json + mock git）：读 `dependsOn` → 每批就绪集 → ≤3 并发 → 按拓扑合并顺序；崩溃恢复读 epic-state.json 不重跑已合并项；仓库根判定单测（`PIPE_CORE_REPO_ROOT` 注入 → worktree 场景取主仓库状态根；缺省回退 `git rev-parse --show-toplevel`）
- [x] 8.5 `--self-check`：校验角色/节点定义、driver 契约完整性、preflight shell 静态自检（`node --check` + `bash -n`），fail-closed
- [x] 8.6 `openspec validate workflow-core --strict --no-interactive` 通过
- [x] 8.7 回归验证确认未破坏既有构建/测试：
  - [x] `cargo check --manifest-path src-tauri/Cargo.toml` + `cargo test --manifest-path src-tauri/Cargo.toml` 通过
  - [x] `npm run test` + `npm run build` 通过
- [x] 8.8 全量 `openspec validate --all` 通过（主规格未动，确认无回归）
- [x] 8.9 按 Issue #106 提交 PR：`git push -u origin workflow-core` + `gh pr create --base main --head workflow-core --body "Closes #106"`

## 9. P6 跨 Agent 产品通用化（复核追加，待实现）

> 目标：把当前“Claude/Codex 双 driver”升级为“Claude Code/Codex/OpenCode 三端通用 + 其他 runtime 可按契约扩展”。本组未完成前，文档只能宣称“模型无关核心 + Claude/Codex driver”，不能宣称“跨 Agent 通用”。依赖顺序：contract → capability → 中立脚本/命令 → OpenCode driver → 三端入口 → conformance/真实 smoke。
>
> **组内依赖边（design D12）**：9.1（contract.js）最先，是 9.2/9.3/9.4/9.9/9.10 的输入；9.2（registry + run.js 去 DRIVERS 硬编码）完成后 A 步其余与 B 步（9.5/9.6，相互独立）才完整——但 9.5/9.6 不依赖 drivers，可与 C 步并行；9.7（opencode.js）→ 9.8（入口）、9.11（fake E2E）、9.10（opencode 部分）；9.12/9.13/9.14 收尾依赖前置全部。**编排节奏：A（9.1→9.2/9.3/9.4/9.9）→ B（9.5、9.6）与 C（9.7、9.8、9.11）并行 → D（9.10 扩充、9.12、9.13、9.14）串行收尾**。状态 schema 升级（9.9）置于 A，避免运行中再改 `state.json` 形态。
>
> **现状核对（2026-09-21，组 1–8 已全部实现）**：`drivers/` 仅 claude.js+codex.js，无 contract/registry/opencode；`run.js` 硬编码 `DRIVERS` + `wrapDriver` 的 `if (driverName === …)` 角色注入分支；`roles.json` 用 Claude 工具名 `allowedTools`；`selfcheck.js` 硬编码 `DRIVER_NAMES`、静态自检固定 `.claude/workflows/*.sh`；`pipeline.js` integrate 依赖 `/opsx:archive`、preflight 默认 `.claude/workflows/` 路径；`.agents/workflows/`、`.agents/commands/` 尚未建立（preflight 实现仍在 `.claude/workflows/`，drivers 测试仅覆盖 claude/codex，无任何 P6 测试）。实现时按 A→B/C→D 推进，不重复动已实现的 P1–P5 模块；每小步伴随先行失败测试（TDD），既有 105 测试保持全绿。

- [x] 9.1 新增 `drivers/contract.js`：定义 `apiVersion`、`task/ctx/DriverResult` 校验、标准错误分类与超时终止语义。
- [x] 9.2 新增 `drivers/registry.js`：注册 claude/codex/opencode；`run.js` 从 registry 获取 driver，移除硬编码 driver 枚举与角色注入分支。
- [x] 9.3 把 role prompt 组装移至公共 wrapper；`roles.json` 使用产品无关 `capabilities`，宿主无法满足时 fail-closed，降级写入结果元数据。
- [x] 9.4 为只读节点增加节点前后 HEAD/status 落地审计；`cr-agent`/只读节点产生写入即失败。
- [x] 9.5 迁移 preflight 实现到 `.agents/workflows/`；Claude 路径保留 exec 转发壳，core/self-check 默认引用中立路径。
- [x] 9.6 新增 `.agents/commands/` 归档、PR、CI 等确定性 wrapper；`pipeline.js` 不再依赖 `/opsx:*` 或 `.claude/workflows`。
- [x] 9.7 新增 `drivers/opencode.js`：构造 CLI 参数、解析 NDJSON final assistant JSON envelope，并做 schema 二次校验。
- [x] 9.8 增加 `.opencode/commands/` 入口薄壳，更新 `.agents/skills/pipe/SKILL.md`、`AGENTS.md`、`.claude/CLAUDE.md` 的三端能力边界。
- [x] 9.9 状态 schema 升级为 v2，记录 `driverApiVersion`、`driverVersion`、权限降级；旧 v1 状态兼容迁移，resume 依赖 commit 落地校验。
- [x] 9.10 建共享 driver conformance suite，覆盖三端契约版本、OpenCode cwd/成功输出/协议错误/schema 错误及 spawn/超时分类。
- [x] 9.11 增加 OpenCode fake runtime 与完整 infra pipeline E2E；既有 epic 单测覆盖并发 worktree 隔离与状态恢复。
- [x] 9.12 增加真实 CLI smoke harness：逐端独立探测版本/认证；不可执行时显式 skip，不静默替换 driver。
- [x] 9.13 更新 `--self-check`：动态发现 registry driver、contract apiVersion、capability 映射及中立 workflow/command 脚本，fail-closed。
- [x] 9.14 本地验收：P1–P5 + P6 测试、`--self-check`、OpenSpec 校验通过；真实三端 smoke 仅保留显式 skip 证据，未更新 PR 为“跨 Agent 通用”。

## 10. CR 修复回归（2026-09-21）

- [x] 10.1 core 调度与 reroute 支持同步/Promise driver，并由 run.js await；失败经 Leader driver 决断且校验 `DECISION_SCHEMA`
- [x] 10.2 所有挂起路径写 `.agents/runs/<change>/suspension-report.json`，run.js 输出报告路径
- [x] 10.3 Claude 使用 `--append-system-prompt-file`；OpenCode 传递 capability policy，无法可靠只读时启动前返回 config
- [x] 10.4 integrate prompt 调用 `.agents/commands/create-pr.js`、`wait-ci.js`、`merge-pr.js`
- [x] 10.5 Epic `--resume` 显式恢复 failed/suspended 子项；infra verify 纳入 `tests/workflow-core/*.test.cjs`
- [x] 10.6 补充 async driver、Leader 决断/schema、挂起报告、只读 fail-closed、Epic resume 与确定性 wrapper 回归测试
