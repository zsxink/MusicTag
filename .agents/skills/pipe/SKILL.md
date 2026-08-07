---
name: pipe
description: MusicTag 项目开发流水线（多 Agent 协作）——需求确认后由模型无关编排核心（.agents/tools/pipe-core/）自动完成前置校验、架构设计、开发、测试、CR、最终验证、合并、归档。任何新功能、行为修改、Bug 修复前的必经流程。
---

# MusicTag 多 Agent 协作流水线（pipe）

把一次开发请求（新功能 / 改行为 / 修 Bug）从**需求确认**一路自动跑到**合并归档**。由**模型无关编排核心** `.agents/tools/pipe-core/`（`node run.js`）驱动多 Agent 协作（Leader 主导、7 角色分工），目标是需求确认后无人值守，只在真卡住/挂起时停下。

**本工作流是项目总入口**。规格产出与实现用 OpenSpec 官方命令（`/opsx:*`），多 Agent 编排由核心 CLI 驱动（Claude 经 `/pipe` 薄壳、Codex 经 `AGENTS.md` 入口识别），质量保障用 superpowers skills，git 流程由核心节点编排。

**Epic 大变更**（整产品级，如 V1）：不走单变更 `/pipe`，改走 `/pipe:init <epic>`（拆子变更 + 只批一次总 PRD）+ `/pipe:epic <epic>`（并行跑 `/pipe`）。详见命令文件。

## 入口

- Claude：`/pipe <change>` → `node .agents/tools/pipe-core/run.js <change> --driver claude`；`/pipe:epic <epic>` → `node .agents/tools/pipe-core/run.js --epic <epic> --driver claude`。
- Codex：会话里说「跑 pipe <change>」→ 根 `AGENTS.md` 项目约定识别入口 → `node .agents/tools/pipe-core/run.js <change> --driver codex`。
- 断点续跑：`node .agents/tools/pipe-core/run.js <change> --resume`（从失败/挂起节点继续，已通过节点复用）。

## 架构（核心 + 薄 driver）

- **模型无关编排核心**：`.agents/tools/pipe-core/`（纯 node、零依赖）。节点定义数据（`pipeline.js`）驱动 DAG，不硬编码节点顺序。
- **节点状态机 + 断点续跑**：每节点完成原子写盘 `.agents/runs/<change>/state.json`（路径以仓库根锚定）；失败/挂起节点续跑只重跑，已通过复用；落地校验不信任自报。
- **决断链**：节点失败 → leader 决断节点 `retry / reroute / escalate / abort`。技术失败自动重试、CR 内容问题按文件所有权 reroute、需人拍板一律 escalate 挂起回主会话。
- **自适应编排**：Architect 判定变更域 `backend/frontend/both/docs/spec/infra`；docs/spec/infra 跳过业务编译门禁。
- **子变更并行**（P3）：`/pipe:epic` 按 `dependsOn` DAG 就绪集 ≤3 并行，独立 worktree + 独立分支，合并顺序保证前置先合并。
- **跨模型 driver**（P5）：claude / codex 两个薄 driver 翻译「一个节点 → CLI 子进程」；角色文案 `roles/` 单源，两端同一份。
- **环境自动感知**：未显式 `--driver` 时按环境变量判断（CLAUDECODE → claude；AI_AGENT → 对应）；无法判断要求显式。

## 七角色

| 角色 | 代理 | 职责 |
|------|------|------|
| Leader | `leader` | 编排者：调度各角色、按结果推进、决断链归类、打回/挂起决策 |
| Architect | `architect` | 读 proposal/specs 产出设计，判定变更域（6 值） |
| Rust-Dev | `rust-backend` | src-tauri/ 下 Rust 实现（TDD） |
| Vue-Dev | `vue-frontend` | src/ 下前端实现（TDD） |
| CR | `cr-agent` | **只读**审查，对照 specs/design 找问题，不改代码 |
| Verify/CI | `verify-agent` | 按域短路验证，只验证不修复 |
| Tester | `tester` | 覆盖审计、补测试、冒烟 |

协作模型：**角色独立、Leader 推进**。CR 只读，有问题经决断链 reroute 打回 Leader → Leader 重派给对应开发角色 → 修复再复审；**CR 三轮未通过 → escalate 挂起**。

## 流水线总览

```
需求确认（用户拍板）          ← 唯一强制确认点
  ↓
① PRD 确认  /opsx:propose <name>（用户批准 proposal + specs）
  ↓
② 分支      git checkout -b <name>
  ↓
③ 核心      node .agents/tools/pipe-core/run.js <change> --driver claude
     preflight → architect → dev*（按域动态组）→ tester → cr(≤3轮) → verify → integrate
  ↓
④ 结果      exit 0 success → 汇报；exit 3 suspended → 停下上报；exit 1 failed → 修后 --resume
```

## 阶段详情

### ① PRD 确认（OpenSpec，唯一参与点）
- 想法不清晰 → 先 `/opsx:explore` 澄清；已明确 → `/opsx:propose <name>`。
- **输入是 Issue** → 先 `gh issue view <id>` 取需求背景 → `/opsx:propose`。
- 生成 `openspec/changes/<name>/` 的 **PRD**：proposal.md → specs/。
- **用户只 review PRD（proposal + specs）并批准后**，才进入开发（这就是「需求确认」）。确认后即全自动。
- design.md / tasks.md 必须在进入核心前已生成并通过 OpenSpec 校验；Architect 只细化已批准设计，不可扩张需求。
- 涉及 V1 拍板决策 → 同步 `docs/V1-PRD.md` / `docs/design/design.md`。

### ② 创建分支（git）
- 从 main 开分支：`git checkout main && git checkout -b <change-name>`，每变更一分支。
- 分支名 = change 名（kebab-case）。

### ③ 运行核心（多 Agent 编排）
```bash
node .agents/tools/pipe-core/run.js <change> --driver claude
```
核心按 DAG 调度（节点级状态落盘，失败走决断链）：

1. **preflight**：只读跑 `pipe-preflight.sh`；`ready=false` 直接 failed（fail-closed，含 `--self-check` 静态自检）。
2. **架构设计**：Architect 细化 `design.md`，判定变更域（backend/frontend/both/docs/spec/infra）。
3. **开发**：按域**自适应组织**——
   - 纯后端 → 仅 rust-backend；纯前端 → 仅 vue-frontend
   - 跨前后端 → rust-backend 后 vue-frontend **串行**
   - docs/spec/infra → leader 流程维护角色（不触发业务编译门禁）
   - 全程 **TDD**：新逻辑先写失败测试再实现
   - **增量提交**：每批任务 `git add + commit`（`feat(<change>): <任务>`），进度可追溯、崩溃可恢复
4. **测试**：Tester 对照 scenarios 补齐测试、跑冒烟；任一 scenario 缺失即失败。Tester 的写入发生在 CR 前。
5. **CR（只读，最多三轮）**：
   - CR 代理**只读**审查 `git diff main...HEAD`，对照 specs/design
   - 审查维度含**复盘专项三检**（针对 #46/#47 缺陷族）：跨模块状态语义（聚合去重不破坏单源换源/防同名不同歌）、竞态与串扰（跨 kind/面板不互相作废）、网络与离线判定（区分超时/错误码与正常空结果）；不适用标「不适用」
   - 阻断/major 每项必须含 file + issue + specReference + suggestion 四要素；`pass=true` 仅当无阻断且无 major
   - 无阻断无主要问题 → 通过，进验证
   - 有问题 → 决断链 **reroute** 按文件所有权派对应开发角色修复 → 复审
   - **三轮未通过 → escalate 挂起**，上报用户决策
6. **最终验证**：Verify 代理在所有 Tester/CR 写入后按域短路——代码域跑 `cargo check` → `cargo test` → `npm run test` → `npm run build` → `openspec validate <change> --strict --no-interactive`；docs/spec/infra 跳过 cargo/npm 改跑脚本静态自检 + openspec validate。任一 fail 即 `verify_failed`，只验证不修复；涉及搜索联动（取词/换源/并发/离线判定）的变更追加**复盘回归清单**并逐项入 `verify.steps`，缺失必选项即 `verify_failed`。
7. **integrate**：归档 `/opsx:archive` → push → `gh pr create` → 等 CI → `gh pr merge --squash` → 分支清理。

### ④ 结果处理
| run.js 退出码 | 处理 |
|--------------|------|
| `0`（success） | 已含集成结果（integrate 节点完成归档/PR/合并），向用户汇报 |
| `1`（failed） | 停下报告失败原因与阶段；修复后 `--resume` 续跑 |
| `3`（suspended） | **停下上报用户**：CR 三轮未通过 / 验证反复不过 / 需求歧义，列原因与候选方案，请用户决策后 `--resume` 续跑 |
| `2`（用法错误） | 检查参数 |

## 确认点

- **唯一强制确认点**：① 的 PRD（proposal + specs）用户批准（= 需求确认）。**确认后即全自动，用户不再参与**。
- 流程中不设中间确认；**只在以下情况停下上报**（告知 + 等一句决策，不是请求干活）：
  - CR 三轮未通过（挂起，上报）
  - 验证/测试无法自动通过（修后 `--resume` 续跑，反复不过上报）
  - 需求/规格有歧义或冲突
  - 实现暴露设计缺陷
  - 用户主动打断

## 硬性门槛

- PRD（proposal + specs）未经用户批准，**禁止**进入开发；设计由 Architect 自动产出，无需用户评审。
- **归档必须先于提交 PR**：规格更新与代码同进 PR，合并后主规格即最新。
- 不在 main 上直接开发；merge PR 是回到 main 的唯一方式。
- 核心 `success` 仅表示质量门通过；integrate 节点必须归档、创建 PR、确认 CI required checks 后合并并写 checkpoint。
- **CR 只读**：审查代理不 Edit/Write 代码；问题经 Leader/决断链中转，由开发角色修复。
- **CR 复盘专项**：CR 必须含复盘专项三检维度（跨模块状态语义 / 竞态与串扰 / 网络与离线判定）；阻断/major 每项必须含 file + issue + specReference + suggestion；`pass=true` 仅当无阻断且无 major。
- **CR 三轮未通过即挂起**，不无限重试。
- **统一验证基线**：cargo check → cargo test → npm run test → npm run build → openspec validate `--strict --no-interactive`，任一 fail 即 `verify_failed`，只验证不修复；搜索联动类变更追加复盘回归清单并逐项入 `verify.steps`。
- 未写失败测试就实现 = 违规。规格改前先改文档。
- 报告结果如实：失败/挂起就停，不粉饰、不假报全绿。
