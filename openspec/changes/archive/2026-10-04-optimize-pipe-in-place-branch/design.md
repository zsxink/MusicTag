# Design: pipe 默认原地切分支

## 领域

`infra`（纯流程/脚本），不派 rust-backend / vue-frontend，不运行 cargo / 前端业务编译。

## 1. 原生 Agent 边界

本变更**不改变** pipe 的调度模型：

- 当前与用户对话的主会话仍是唯一 Leader，负责阶段推进、问题裁决、`tasks.md` 勾选、`progress.md` 写入、全部 Git 写入与集成。
- 子 Agent 仍只通过宿主原生 Agent 工具派发（Architect / Dev / Tester / CR / Verify），不引入任何 CLI driver、`run.js` 或完整子流水线进程。
- 新增的两个脚本都是**确定性只读 shell**，由主会话的命令工具直接调用，不包装 git/gh/openspec，不派生 Agent。
- 分支选择是一次**主会话决断**：在非 main 分支上时经 AskUserQuestion 向用户升级，符合「涉及用户决策回主会话」的既有原则。

变更是**工作区（在哪写代码）与清理语义**，不是调度语义。

## 2. Markdown 恢复

核心设计目标是**不改动 `progress.js` 的状态机与校验**，从而不破坏历史 `progress.md` 的可恢复性：

- `--worktree` 参数保留，原地模式下传主仓根。该字段语义本就是「实际代码工作树」，主工作树满足。
- 由 `progress-cli.js:137/140` 的必填校验、`progress.js:1041` 的 `worktree` 等值比较、`progress.js:1106` 的 Epic 基线比较、`epic-preflight.js:55-59` 的基线核对**全部原样成立**——两边都记录/比对同一个主仓根。
- `cleanup-local` 的 `worktreeRemoved` 与终态恢复的 `worktreeDeleted` **保留字段名**，语义重定义为「不再存在该 change 的 linked worktree」。原地模式收尾后该事实为真，故仍记 `true`，`progress.js:893` 与 `progress.js:1024-1028` 的判定不变。
- 工作区模式（`in-place` / `worktree`）由 `assert-pipe-workspace.sh` 打印，主会话写入 bootstrap 阶段的 evidence 文本，不新增机器字段、不改 schema。

结论：**历史 progress.md 无需迁移**，进行中的 change 可跨本变更恢复。

## 3. 分支判断（新增 `pipe-branch-check.sh`）

只读脚本，输出状态供主会话解析，自身不做任何 Git 写入。

```
pipe-branch-check.sh <change> [--main <branch>]
# stdout: <state>\t<current-branch>\t<clean|dirty>
```

| state | 条件 | 主会话动作 |
|---|---|---|
| `already-on-change` | 当前分支 == change | 工作区 clean 则直接进 bootstrap |
| `on-main` | 当前分支 == main | `git switch -c <change>`（分支已存在则 `git switch <change>`） |
| `on-other` | 其它分支 | AskUserQuestion 三选一 |
| `detached` | detached HEAD | 同 `on-other` |

「切分支」选项的前置校验：`git merge-base --is-ancestor <main> HEAD` 成立才允许从当前分支切出；不成立则只提供「改用 worktree / 中止」。

「改用 worktree」执行 `git worktree add .worktrees/<change> -b <change> <main>`（分支已存在则去掉 `-b`）——与已退役 `pipe-core/worktree.js:13-15` 的约定一致，`.worktrees/` 已在 `source-fingerprint.js:13` 的排除列表内。

dirty 工作区：只读报告，**不自动 stash、不自动 commit**，由用户处理。

## 4. 工作区断言（`assert-pipe-workspace.sh` 取代 `assert-linked-worktree.sh`）

- 保留既有能力：`git_dir != common_dir` → linked worktree，通过。
- 新增能力：`git_dir == common_dir` → 主工作树，也通过，并打印 `in-place`。
- 仍然 fail-closed 的场景：当前分支不是 change 名。该断言在 `pipe-preflight.sh:9`，本变更**保留不动**——它已经挡住「在 main 上直接开发」。
- `self-check.js:141` 的必检文件清单同步换成新脚本名，避免 fail-closed 误报。

## 5. Epic

- Epic 主会话原地停在 main：`pipe-epic-preflight.sh:9`（要求当前分支 == main）与 `:68`（把 `$PWD` 当 worktree 传给 `epic-preflight.js`）**无需改动**。
- `epic-init --worktree <主仓根>`，与 `$PWD` 等值，基线比较成立。
- 子变更仍各自 `git worktree add .worktrees/<item> -b <item> main`，保住「最多三个并行」。子变更在其 worktree 内跑 pipe 时，`pipe-branch-check.sh` 返回 `already-on-change`，`assert-pipe-workspace.sh` 返回 `worktree`，两条路径都通。

## 6. 收尾

integrate 的 `cleanup-local`：删除 worktree（若为 worktree 模式）→ 切回 main → 删除已合并的 change 分支。原地模式下即 `git switch main && git branch -d <change>`。

## 7. 验证计划

脚本语法与静态自检：

- `bash -n`：`assert-pipe-workspace.sh`、`pipe-branch-check.sh`、`pipe-preflight.sh`、`pipe-epic-preflight.sh`
- `node --check`：`self-check.js`（及其余被改动的 JS，若有）
- `node .agents/tools/pipe-native/self-check.js`

测试：

- `node --test .agents/tools/pipe-core/test/*.test.js tests/workflow-core/*.test.cjs`（infra 默认基线）
- `node --test .agents/tools/pipe-native/test/*.test.js`（默认基线遗漏，必须显式补；Node v24 必须用 glob 形式，不能传目录）
- 新增 `pipe-branch-check.sh` 的 shell 层用例，覆盖 `already-on-change` / `on-main` / `on-other` / `detached` / dirty

规格：

- `npx --yes @fission-ai/openspec@1.5.0 validate --all --strict --no-interactive`

端到端：

- 在 main 上执行 `pipe-branch-check.sh <change>` 得 `on-main`；在临时分支上得 `on-other`；dirty 时标记正确。
- 在临时目录用一次性仓库验证 `assert-pipe-workspace.sh` 的双模式与 fail-closed 分支，避免污染主仓。
- 用一个小 change 实跑 pipe，确认 bootstrap 原地通过、`cleanup-local` 通过、收尾停在干净 main。

## 8. 风险与取舍

- **丢失隔离**：主目录不再干净于 pipe 之外。bootstrap 第 11 行的 `git status --porcelain` 非空门禁保留，因此跑 pipe 前必须清理工作区；不自动 stash 是刻意的，避免动用户未提交的工作。
- **Epic 并行仍需 worktree**：一个目录只能 checkout 一个分支，故 Epic 子项保留 worktree 是能力要求而非习惯。
- **权限**：`.claude/settings.json` 现无 `Bash(git worktree:*)`，Epic 派发子项会弹权限，故补入允许列表。
- **`.agents/tools/pipe-core/worktree.js`** 属遗留死码（`self-check.js:37-45,144-146` 已 fail-closed 拦截 pipe-core 引用），本变更不触碰。
