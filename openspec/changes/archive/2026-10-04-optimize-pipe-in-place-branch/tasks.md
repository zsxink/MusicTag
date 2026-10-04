# Tasks: pipe 默认原地切分支

Domain：infra

## 1. 脚本改动

- [x] T1 新增 `.agents/workflows/assert-pipe-workspace.sh`：`git_dir == common_dir` → 主工作树，打印 `in-place` 并通过；否则打印 `worktree` 并通过。（owner: Dev；路径：`.agents/workflows/assert-pipe-workspace.sh`）
- [x] T2 新增 `.agents/workflows/pipe-branch-check.sh <change> [--main <branch>]`：只读，输出 `<state>\t<current-branch>\t<clean|dirty>`，state ∈ `already-on-change` / `on-main` / `on-other` / `detached`；不做任何 Git 写入、不 stash。（owner: Dev；路径：`.agents/workflows/pipe-branch-check.sh`；依赖 T1）
- [x] T3 退役 `.agents/workflows/assert-linked-worktree.sh`，并把 `pipe-preflight.sh:10` 的调用点换成 `assert-pipe-workspace.sh`；`pipe-preflight.sh:9` 的 `branch == change` 断言保留不动。（owner: Dev；路径：`.agents/workflows/pipe-preflight.sh`、删除 `assert-linked-worktree.sh`；依赖 T1）
- [x] T4 同步 `self-check.js:141` 的必检文件清单：`assert-linked-worktree.sh` → `assert-pipe-workspace.sh`（漏改会 fail-closed）。（owner: Dev；路径：`.agents/tools/pipe-native/self-check.js`；依赖 T1、T3）
- [x] T5 新增 `pipe-branch-check.sh` 的 shell 层用例，覆盖 `already-on-change` / `on-main` / `on-other` / `detached` 与 dirty 标记，且在一次性临时仓库中运行，不污染主仓。（owner: Tester；路径：`.agents/tools/pipe-native/test/pipe-branch-check.test.js`；依赖 T2）

## 2. 文档与规格同步

- [x] T6 更新 `.agents/skills/pipe/WORKFLOW.md`：`:7` 不变量 1（工作区默认原地、Epic 子项才用 worktree）、`:15` §1 插入分支判断、`:17` 恢复事实、`:25`、`:44` bootstrap 门禁表、`:69` 指纹、`:71` §5 cleanup 语义（`worktreeRemoved` 重定义）、`:75` §6 Epic。（owner: Dev；路径：`.agents/skills/pipe/WORKFLOW.md`）
- [x] T7 更新 `.agents/tools/pipe-native/progress-template.md`：`:7` 的 `worktree:` 说明改为「实际代码工作区（原地模式为主仓根）」、`:50` 恢复核对措辞。（owner: Dev；路径：`.agents/tools/pipe-native/progress-template.md`）
- [x] T8 更新宿主入口文档：`.claude/CLAUDE.md:22,26`、`AGENTS.md:33,41`、`.claude/commands/pipe-epic.md:12,13`、`.claude/commands/pipe-epic-status.md:12`、`.claude/commands/pipe-init.md:13`、`.opencode/commands/pipe.md:7`、`.opencode/commands/pipe-epic.md:5`。（owner: Dev；依赖 T6）
- [ ] T9 归档时由本 change 的 spec delta 落到 canonical 规格 `openspec/specs/workflow-core/spec.md`：P1 改写为模式中立的工作区记录与清理语义，并新增 `变更工作区与分支选择` 要求。P3（Epic 子项并行仍用独立 worktree，语义未变，不改）、P6（指纹跨 cwd/工作区稳定，语义未变，不改）无需改动；`pipe-native` 的 `worktree` 字段名与语义仍成立，不改。（owner: 主会话；依赖 T6、T7、T8 定稿；归档阶段执行）

## 3. 配置

- [x] T10 `.claude/settings.json` 权限列表补 `Bash(git worktree:*)`（Epic 派发子项 worktree 需要；`git switch/checkout/merge` 已在列表内）。（owner: Dev；路径：`.claude/settings.json`）

## 4. 验证

- [x] T11 `bash -n` 全部改动脚本（`assert-pipe-workspace.sh`、`pipe-branch-check.sh`、`pipe-preflight.sh`、`pipe-epic-preflight.sh`）。（owner: Verify）
- [x] T12 `node --check .agents/tools/pipe-native/self-check.js` 与 `node .agents/tools/pipe-native/self-check.js`。（owner: Verify；依赖 T4）
- [x] T13 `node --test .agents/tools/pipe-core/test/*.test.js tests/workflow-core/*.test.cjs`（infra 默认基线）。（owner: Verify）
- [x] T14 `node --test .agents/tools/pipe-native/test/*.test.js`（**infra 默认计划遗漏此项，必须显式补**；Node v24 必须用 glob 形式，不能传目录）。45/45 通过。（owner: Verify；依赖 T5）
- [x] T15 `npx --yes @fission-ai/openspec@1.5.0 validate --all --strict --no-interactive`。（owner: Verify）
- [x] T16 端到端干跑：在一次性临时仓库验证 `pipe-branch-check.sh` 四种 state（含 dirty 标记与 `--main` 覆盖、用法错误 exit 2）与只读性；验证 `assert-pipe-workspace.sh` 双模式（主工作树 `in-place`、linked worktree `worktree`，均 exit 0）。fail-closed 由 `pipe-preflight.sh:9` 的 `branch == change` 断言继续承担。（owner: Verify；依赖 T1、T2）

## 依赖与顺序

T1 是脚本层前置；T2、T3、T4 依赖 T1，T3 必须先于 T4。T5 依赖 T2，T14 依赖 T5。文档组 T6 先行，T7、T8 依 T6 定稿，T9 在归档阶段落到 canonical 规格。T10 独立。验证组 T11–T16 在实现完成后依序执行，T14 必须显式运行。

## 备注

- 本变更自身仍须用**现有**流程（worktree）开发，合并后才对新 change 生效。
- `progress.js` / `progress-cli.js` / `epic-preflight.js` 不改；历史 progress.md 保持可恢复。
- `.agents/tools/pipe-core/worktree.js` 属遗留死码（`self-check.js:37-45,144-146` 已 fail-closed 拦截），不触碰。
- CR 发现 #4（既有惯例，非本变更引入，本 change 不改）：CI 的 `validate` job 只跑 openspec / `npm run test`（vitest）/ cargo，不跑 `node --test` 的 pipe 原生测试（`pipe-core`、`workflow-core`、`pipe-native`）。这些测试目前靠 Verify 手工门禁执行，`progress.test.js` 同样如此。若要改为 CI 强制，应另开 change 一并纳入三个 glob，不在本变更范围内。
