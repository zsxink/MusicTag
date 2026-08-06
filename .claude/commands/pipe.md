---
name: "Pipe"
description: 多 Agent 协作全自动流水线——前置校验→架构设计→开发→测试→CR(三轮)→最终验证→集成，需求确认后由 pipe-core 核心一条龙跑完
category: Workflow
tags: [workflow, automation, multi-agent, pipeline]
---

# Pipe — 多 Agent 协作全自动流水线

**触发**：用户明确一个需求/变更，要求「自动完成后续」。输入可能是：GitHub Issue 号/链接（如 `#12`、`https://github.com/zsxink/MusicTag/issues/12`）、变更名（kebab-case）、或一段需求描述。

**目标**：需求确认后，由 **模型无关编排核心**（`.agents/tools/pipe-core/`，`node run.js`）驱动多 Agent（Leader 主导）无人值守跑完开发闭环，只在真卡住/挂起时停下。

## 入口

`/pipe` 是薄壳，转发到核心：

```bash
node .agents/tools/pipe-core/run.js <change> --driver claude
```

- `--driver claude`：Claude 环境默认；`--driver codex` 在 Codex 会话用（`AGENTS.md` 入口识别）。
- `--resume`：续跑已存在状态（从失败/挂起节点继续，已通过节点复用）。
- 退出码：`0` 成功 / `1` 失败 / `2` 用法错误 / `3` 挂起（交主会话决策）。

## 与 `/opsx:run` 的区别

- `/opsx:run` 保留原样：单 Agent 串行流水线。
- `/pipe` 是新的多 Agent 协作流水线：7 角色分工、节点状态机断点续跑、决断链、CR 只读三轮挂起。
- 两条都能跑完整闭环；**新变更默认走 `/pipe`**。

## 总览

```
需求确认（用户拍板）          ← 唯一强制确认点
  ↓
① PRD 确认  /opsx:propose <name>（proposal→specs 用户批准；design 由 Architect 自动产出）
  ↓
② 分支      git checkout -b <name>（每变更一分支）
  ↓
③ 核心驱动  node .agents/tools/pipe-core/run.js <change> --driver claude
     preflight → architect(判定 domain) → dev*（按域动态组） → tester → cr(只读,≤3轮) → verify → integrate
     （节点级状态落盘 .agents/runs/<change>/state.json，失败走决断链 retry/reroute/escalate）
  ↓
④ 结果处理  success → 进 ⑤；verify_failed / test_failed → 修后 --resume 续跑；suspended → 上报用户
  ↓
⑤ 归档      /opsx:archive <name>（规格更新进分支，随 PR 一起合回 main）
  ↓
⑥ 提交 PR   git push -u origin <name> → gh pr create（integrate 节点完成）
  ↓
⑦ 合并      gh pr merge --squash 回 main → git branch -d <name>（integrate 节点完成）
```

## 七角色

| 角色 | 代理 | 职责 |
|------|------|------|
| Leader | `leader` | 编排者：调度各角色、按结果推进、决断链归类、打回/挂起决策 |
| Architect | `architect` | 读 proposal/specs 产出设计，判定变更域（backend/frontend/both/docs/spec/infra） |
| Rust-Dev | `rust-backend` | src-tauri/ 下 Rust 实现（TDD） |
| Vue-Dev | `vue-frontend` | src/ 下前端实现（TDD） |
| CR | `cr-agent` | **只读**审查，对照 specs/design 找问题，不改代码 |
| Verify/CI | `verify-agent` | 按域短路验证（代码域五步基线 / docs·spec·infra 跳过 cargo/npm），只验证不修复 |
| Tester | `tester` | 覆盖审计、补测试、冒烟 |

角色文案单一来源：`.agents/tools/pipe-core/roles/`（claude 经 `--append-system-prompt` 注入、codex 拼入 prompt，同一份）。

## 执行步骤

### ① PRD 确认（唯一参与点）
- **输入是 Issue** → 先 `gh issue view <id>` 取 Issue 内容作需求背景 → `/opsx:propose` 生成 PRD。
- 输入是需求描述 → `/opsx:propose <name>`：确认理解 → `openspec new change <name>` → 生成 **PRD（proposal + specs）** → **用户只 review PRD 并批准**。
- 输入已是变更名 → 跳过 propose，直接进入 ②。
- design.md / tasks.md 必须在进入核心前已生成并通过 OpenSpec 校验；Architect 只细化已批准设计，不可扩张需求。
- 涉及 V1 拍板决策 → 先同步 `docs/V1-PRD.md` / `docs/design/design.md`。

### ② 创建分支
```bash
git checkout main    # 若不在 main
git checkout -b <change-name>   # 分支名 = change 名
```

### ③ 运行核心（多 Agent 编排）
先执行 `.claude/workflows/pipe-preflight.sh <change-name>`（preflight 节点亦只读执行同一脚本，fail-closed）；通过后运行：

```bash
node .agents/tools/pipe-core/run.js <change> --driver claude
```

核心按 `preflight → architect → dev* → tester → cr → verify → integrate` 的 DAG 调度：

1. **preflight**：只读跑 `pipe-preflight.sh`；`ready=false` 直接 failed（fail-closed）。
2. **架构设计**：Architect 判定变更域（backend/frontend/both/docs/spec/infra），按域动态展开开发节点。
3. **开发**：按域自适应组织——
   - 纯后端 → 仅 rust-backend；纯前端 → 仅 vue-frontend
   - 跨前后端 → rust-backend 后 vue-frontend **串行**
   - docs/spec/infra → leader 流程维护角色（自适应编排，不触发业务编译门禁）
   - 全程 TDD：新逻辑先写失败测试再实现；增量提交 `feat(<change>): <任务>`。
4. **测试**：Tester 对照 scenarios 补齐测试、跑冒烟；任一 scenario 缺失即失败。Tester 的写入发生在 CR 前。
5. **CR（只读，最多三轮）**：CR 代理只读审查 diff（`git diff main...HEAD`），对照 specs/design；问题按文件所有权定向打回（reroute）。
   - 无阻断无主要问题 → 通过，进验证。
   - 有问题 → 决断链 `reroute` → 派对应开发角色修复 → 复审。
   - **三轮未通过 → 决断链 `escalate` 挂起**，上报用户决策。
6. **最终验证**：Verify 代理按域短路——代码域跑 `cargo check → cargo test → npm run test → npm run build → openspec validate`；docs/spec/infra 跳过 cargo/npm 改跑脚本静态自检 + openspec validate。失败 → 打回修复续跑。
7. **integrate**：归档 `/opsx:archive` → push → `gh pr create` → 等 CI → `gh pr merge --squash` → 分支清理。

### ④ 结果处理
| run.js 退出码 | 处理 |
|--------------|------|
| `0`（success） | 已含集成结果（integrate 节点完成归档/PR/合并），向用户汇报 |
| `1`（failed） | 停下报告失败原因与阶段；修复后 `--resume` 续跑 |
| `3`（suspended） | **停下上报用户**：CR 三轮未通过 / 验证反复不过 / 需求歧义，列原因与候选方案，请用户决策后 `--resume` 续跑 |
| `2`（用法错误） | 检查参数 |

### ⑤–⑦ 归档/PR/合并（由 integrate 节点完成）
核心 `integrate` 节点（leader 角色）依次执行受控集成：

1. **归档**：`/opsx:archive <name>` 归档变更、更新主规格。**在分支上执行**——归档产生的规格改动随分支提交，与代码一起进 PR，合并后主规格原子更新。
2. **提交 PR**（Issue 驱动：开发提交用 `feat(<issue>): <任务>`；PR 关联 Issue）：
   ```bash
   git push -u origin <name>
   gh pr create --base main --head <name> --title "feat(<name>): <变更摘要>" --body "Closes #<issue>"   # 有对应 Issue 时
   ```
3. **等 CI required checks 通过** → 合并：
   ```bash
   gh pr merge <name> --squash    # 合回 main；关联的 Issue 自动关闭
   git branch -d <name>           # 清理已合并分支
   ```

## 确认点

- **唯一强制确认点**：① 的 PRD（proposal + specs）用户批准（= 需求确认）。**确认后即全自动，用户不再参与**。
- 流程中不设中间确认；**只在以下情况停下上报**（告知 + 等一句决策，不是请求干活）：
  - CR 三轮未通过（挂起，上报）
  - 验证/测试无法自动通过（修后 `--resume` 续跑，反复不过上报）
  - 需求/规格有歧义或冲突（规格层问题，需澄清 PRD）
  - 用户主动打断

## 完成报告

结束后汇报：
- 变更名、变更域判定、改动摘要
- 各角色结果（架构设计要点 / 开发摘要 / CR 轮数与结论 / 验证 / 测试覆盖）
- 合并方式、分支清理情况
- 归档后的主规格变更

## Guardrails

- PRD（proposal + specs）未经用户批准，**禁止**进入开发；设计由 Architect 自动产出，无需用户评审。
- CR **只读**：审查代理不 Edit/Write 任何代码；问题经决断链 reroute 打回，由开发角色修复。
- CR 三轮未通过 → **挂起**，不无限重试。
- **归档必须先于提交 PR**：规格更新与代码同进 PR，合并后主规格即最新。
- 不在 main 上直接开发；merge PR 是回到 main 的唯一方式。
- 核心 `success` 仅表示质量门通过；integrate 节点必须按 ⑤–⑦ 的显式检查清单归档、创建 PR、确认 CI required checks 后合并并写 checkpoint。
- 报告如实：失败/挂起就停，不粉饰、不假报全绿。
