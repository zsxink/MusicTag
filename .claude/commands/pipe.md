---
name: "Pipe"
description: 多 Agent 协作全自动流水线——前置校验→架构设计→开发→测试→CR(三轮)→最终验证，需求确认后一条龙跑完
category: Workflow
tags: [workflow, automation, multi-agent, pipeline]
---

# Pipe — 多 Agent 协作全自动流水线

**触发**：用户明确一个需求/变更，要求「自动完成后续」。输入可能是：GitHub Issue 号/链接（如 `#12`、`https://github.com/zsxink/MusicTag/issues/12`）、变更名（kebab-case）、或一段需求描述。

**目标**：需求确认后，由 **Workflow 工具**编排多 Agent（Leader 主导）无人值守跑完开发闭环，只在真卡住/挂起时停下。

## 与 `/opsx:run` 的区别

- `/opsx:run` 保留原样：单 Agent 串行流水线。
- `/pipe` 是新的多 Agent 协作流水线：7 角色分工、自适应组织、CR 只读三轮挂起。
- 两条都能跑完整闭环；**新变更默认走 `/pipe`**。

## 总览

```
需求确认（用户拍板）          ← 唯一强制确认点
  ↓
① PRD 确认  /opsx:propose <name>（proposal→specs 用户批准；design 由 Architect 自动产出）
  ↓
② 分支      git checkout -b <name>（每变更一分支）
  ↓
③ Workflow  .claude/workflows/music-tag-run.js（多 Agent 编排）
     前置校验 → 架构设计 → 开发(按依赖串行) → 测试 → CR(只读,最多三轮) → 最终验证
  ↓
④ 结果处理  success → 进 ⑤；verify_failed / test_failed → 修后重跑；suspended → 上报用户
  ↓
⑤ 归档      /opsx:archive <name>（规格更新进分支，随 PR 一起合回 main）
  ↓
⑥ 提交 PR   git add + commit → push → gh pr create
  ↓
⑦ 合并      merge PR 回 main → git branch -d <name>
```

## 七角色

| 角色 | 代理 | 职责 |
|------|------|------|
| Leader | `leader` | 编排者：调度各角色、按结果推进、打回/挂起决策 |
| Architect | `architect` | 读 proposal/specs 产出设计，判定变更域（纯后端/纯前端/跨前后端） |
| Rust-Dev | `rust-backend` | src-tauri/ 下 Rust 实现（TDD） |
| Vue-Dev | `vue-frontend` | src/ 下前端实现（TDD） |
| CR | `cr-agent` | **只读**审查，对照 specs/design 找问题，不改代码 |
| Verify/CI | `verify-agent` | cargo check/test + npm run build + openspec validate，只验证不修复 |
| Tester | `tester` | 覆盖审计、补测试、冒烟 |

## 执行步骤

### ① PRD 确认（唯一参与点）
- **输入是 Issue** → 先 `gh issue view <id>` 取 Issue 内容作需求背景 → `/opsx:propose` 生成 PRD。
- 输入是需求描述 → `/opsx:propose <name>`：确认理解 → `openspec new change <name>` → 生成 **PRD（proposal + specs）** → **用户只 review PRD 并批准**。
- 输入已是变更名 → 跳过 propose，直接进入 ②。
- design.md / tasks.md 必须在进入 Workflow 前已生成并通过 OpenSpec 校验；Architect 只细化已批准设计，不可扩张需求。
- 涉及 V1 拍板决策 → 先同步 `docs/V1-PRD.md` / `docs/design/design.md`。

### ② 创建分支
```bash
git checkout main    # 若不在 main
git checkout -b <change-name>   # 分支名 = change 名
```

### ③ 运行 Workflow（多 Agent 编排）
先执行 `.claude/workflows/pipe-preflight.sh <change-name>`；仅成功时才调用 Workflow 工具执行 `.claude/workflows/music-tag-run.js`，参数 `args.name=<change-name>`。

Workflow 内部由 Leader 主导：
1. **架构设计**：Architect 产出/细化 `design.md`，判定变更域（backend/frontend/both）。
2. **开发**：按变更域自适应组织——
   - 纯后端 → 仅 Rust-Dev
   - 纯前端 → 仅 Vue-Dev
   - 跨前后端 → Rust-Dev 后 Vue-Dev **串行**；当前 Workflow 不创建 worktree，禁止在同一分支并写
   - 全程 TDD：新逻辑先写失败测试再实现；增量提交 `feat(<name>): <任务>`。
3. **测试**：Tester 对照 scenarios 补齐测试、跑冒烟；任一 scenario 缺失即失败。Tester 的写入发生在 CR 前。
4. **CR（只读，最多三轮）**：CR 代理只读审查 diff（`git diff main...HEAD`），对照 specs/design；问题按文件所有权定向打回。
   - 无阻断无主要问题 → 通过，进验证。
   - 有问题 → **打回 Leader** → Leader 重新派给对应开发角色修复 → 再复审。
   - **三轮未通过 → 挂起（suspended）**，上报用户决策。
5. **最终验证**：Verify 代理在所有 Tester/CR 写入后跑 cargo check/test、npm run build、openspec validate。失败 → 打回修复重跑。

### ④ 结果处理
| Workflow 返回 | 处理 |
|--------------|------|
| `success` | 进 ⑤ 归档（由外层 Leader 执行受控集成步骤） |
| `verify_failed` | 打回开发修复，重跑 Workflow（可续跑，不重头） |
| `test_failed` | 同上 |
| `suspended` | **停下上报用户**：CR 三轮未通过，列出各轮问题与分歧，请用户决策（改规格/人工修复/继续放行） |
| `failed` | 停下报告失败原因与阶段 |

### ⑤ 归档（规格随 PR 一起合回）
- `/opsx:archive <name>` 归档变更、更新主规格（`openspec/specs/`）。
- **在分支上执行**：归档产生的规格改动随分支提交，与代码一起进 PR，合并后主规格原子更新。

### ⑥ 提交 PR
- **Issue 驱动**：开发提交用 `feat(<issue>): <任务>`；PR 关联 Issue。
```bash
git add . && git commit -m "feat(<name>): <变更摘要>"
git push -u origin <name>
gh pr create --base main --head <name> --title "feat(<name>): <变更摘要>" --body "Closes #<issue>"   # 有对应 Issue 时
```

### ⑦ 合并 PR
```bash
git checkout main && git pull
gh pr merge <name> --squash    # 合回 main；关联的 Issue 自动关闭（或按项目约定 --merge）
git branch -d <name>           # 清理已合并分支
```

## 确认点

- **唯一强制确认点**：① 的 PRD（proposal + specs）用户批准（= 需求确认）。**确认后即全自动，用户不再参与**。
- 流程中不设中间确认；**只在以下情况停下上报**（告知 + 等一句决策，不是请求干活）：
  - CR 三轮未通过（挂起，上报）
  - 验证/测试无法自动通过（修后重跑，反复不过上报）
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
- CR **只读**：审查代理不 Edit/Write 任何代码；问题经 Leader 打回，由开发角色修复。
- CR 三轮未通过 → **挂起**，不无限重试。
- **归档必须先于提交 PR**：规格更新与代码同进 PR，合并后主规格即最新。
- 不在 main 上直接开发；merge PR 是回到 main 的唯一方式。
- Workflow 的 `success` 仅表示质量门通过；Leader 必须按 ⑤–⑦ 的显式检查清单归档、创建 PR、确认 CI required checks 后合并并写 checkpoint。
- 报告如实：失败/挂起就停，不粉饰、不假报全绿。
