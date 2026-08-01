---
name: pipe
description: MusicTag 项目开发流水线（多 Agent 协作）——需求确认后自动完成架构设计、开发、CR、验证、测试、合并、归档。任何新功能、行为修改、Bug 修复前的必经流程。
---

# MusicTag 多 Agent 协作流水线（pipe）

把一次开发请求（新功能 / 改行为 / 修 Bug）从**需求确认**一路自动跑到**合并归档**。由 **Workflow 工具**编排多 Agent 协作（Leader 主导、7 角色分工），目标是需求确认后无人值守，只在真卡住/挂起时停下。

**本工作流是项目总入口**。规格产出与实现用 OpenSpec 官方命令（`/opsx:*`），多 Agent 编排由 `/pipe` 命令调用 Workflow 脚本执行，质量保障用 superpowers skills，git 流程由本流水线编排。

## 何时使用

- 「加个 X 功能」「把 X 改成 Y」「这里好像有个 bug」——任何需要改代码的请求
- **GitHub Issue 驱动的变更**（`/pipe <issue号或链接>`）
- **用户明确需求**并期待「自动完成后续」时，用本流水线全自动执行

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

协作模型：**角色独立、Leader 推进**。CR 只读，有问题打回 Leader → Leader 重新派给架构/开发 → 修复再复审；**CR 三轮未通过 → 挂起**。

## 流水线总览

```
需求确认（用户拍板）          ← 唯一强制确认点
  ↓
① PRD 确认  /opsx:propose <name>（用户批准）
  ↓
② 分支      git checkout -b <name>
  ↓
③ Workflow  /pipe <name> 或直接调用 .claude/workflows/music-tag-run.js
     架构设计 → 开发(按域串行/并行) → CR(只读,最多三轮) → 验证 → 测试
  ↓
④ 结果处理  success → 进 ⑤；失败/挂起 → 停下上报
  ↓
⑤ 归档      /opsx:archive <name>（规格更新进分支，随 PR 一起合回 main）
  ↓
⑥ 提交 PR   git add + commit → push → gh pr create
  ↓
⑦ 合并      merge PR 回 main → git branch -d <name>
```

## 阶段详情

### ① PRD 确认（OpenSpec，唯一参与点）
- 想法不清晰 → 先 `/opsx:explore` 澄清；已明确 → `/opsx:propose <name>`。
- **输入是 Issue** → 先 `gh issue view <id>` 取需求背景 → `/opsx:propose`。
- 生成 `openspec/changes/<name>/` 的 **PRD**：proposal.md → specs/。
- **用户只 review PRD（proposal + specs）并批准后**，才进入开发（这就是「需求确认」）。确认后即全自动。
- design.md / tasks.md 由 Architect 在 Workflow 内自动产出/细化，用户不参与评审。
- 涉及 V1 拍板决策 → 同步 `docs/V1-PRD.md` / `docs/design/design.md`。

### ② 创建分支（git）
- 从 main 开分支：`git checkout main && git checkout -b <change-name>`，每变更一分支。
- 分支名 = change 名（kebab-case）。

### ③ Workflow（多 Agent 编排）
调用 `.claude/workflows/music-tag-run.js`，`args.name=<change-name>`。Leader 主导推进：

1. **架构设计**：Architect 产出/细化 `design.md`，判定变更域（backend/frontend/both）。
2. **开发**：按变更域**自适应组织**——
   - 纯后端 → 仅 Rust-Dev；纯前端 → 仅 Vue-Dev
   - 跨前后端 → Rust-Dev + Vue-Dev **并行**（worktree 隔离，互不冲突）
   - 全程 **TDD**：新逻辑先写失败测试再实现（`superpowers:test-driven-development`）
   - Rust 侧 lofty 读写、网易云加密、封面压缩必须有测试
   - **增量提交**：每批任务 `git add + commit`（`feat(<name>): <任务>`），进度可追溯、崩溃可恢复
3. **CR（只读，最多三轮）**：
   - CR 代理**只读**审查 `git diff main...HEAD`，对照 specs/design
   - 无阻断无主要问题 → 通过，进验证
   - 有问题 → **打回 Leader** → Leader 重派对应开发角色修复 → 再复审
   - **三轮未通过 → 挂起**，上报用户决策
4. **验证**：Verify 代理跑 `cargo check` + `cargo test` + `npm run build` + `openspec validate`，只验证不修复；失败 → 打回修复重跑。
5. **测试**：Tester 代理对照 specs scenarios 审计覆盖、补齐缺失测试、跑核心链路冒烟。

### ④ 结果处理
| Workflow 返回 | 处理 |
|--------------|------|
| `success` | 进 ⑤ 归档 |
| `verify_failed` / `test_failed` | 打回开发修复，重跑 Workflow（可续跑） |
| `suspended` | **停下上报用户**：CR 三轮未通过，列各轮问题，请用户决策 |
| `failed` | 停下报告失败原因与阶段 |

### ⑤ 归档（规格随 PR 一起合回）
- `/opsx:archive <name>` 归档变更、更新主规格（`openspec/specs/`）。
- **在分支上执行**：归档产生的规格改动随分支提交，与代码一起进 PR，合并后主规格原子更新。

### ⑥ 提交 PR（git）
- **Issue 驱动**：开发提交用 `feat(<issue>): <任务>`；合并前处理 main 上可能的冲突提交（rebase 或人工）。
- `git push -u origin <name>` → `gh pr create --base main --head <name> --body "Closes #<issue>"`（有对应 Issue 时）。

### ⑦ 合并 PR
- `gh pr merge <name> --squash` 合回 main，关联 Issue 自动关闭。
- `git branch -d <name>` 清理已合并分支。

## 确认点

- **唯一强制确认点**：① 的 PRD（proposal + specs）用户批准（= 需求确认）。**确认后即全自动，用户不再参与**。
- 流程中不设中间确认；**只在以下情况停下上报**（告知 + 等一句决策，不是请求干活）：
  - CR 三轮未通过（挂起，上报）
  - 验证/测试无法自动通过（修后重跑，反复不过上报）
  - 需求/规格有歧义或冲突
  - 实现暴露设计缺陷
  - 用户主动打断

## 硬性门槛

- PRD（proposal + specs）未经用户批准，**禁止**进入开发；设计由 Architect 自动产出，无需用户评审。
- **归档必须先于提交 PR**：规格更新与代码同进 PR，合并后主规格即最新。
- 不在 main 上直接开发；merge PR 是回到 main 的唯一方式。
- **CR 只读**：审查代理不 Edit/Write 代码；问题经 Leader 中转，由开发角色修复。
- **CR 三轮未通过即挂起**，不无限重试。
- 未写失败测试就实现 = 违规。规格改前先改文档。
- 报告结果如实：失败/挂起就停，不粉饰、不假报全绿。
