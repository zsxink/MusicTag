## Why

Issue [#145](https://github.com/zsxink/MusicTag/issues/145)：当前每次跑 pipe 都在 `.worktrees/<change>` 新建 linked worktree，主目录与 worktree 各有一份 `node_modules` / `target/`，占磁盘且需要在两个目录之间来回切换。而真正需要 worktree 隔离的场景只有 Epic 的多子项并行——单变更串行开发并不需要第二份工作树。`--worktree` 参数记录的语义本就是「实际代码工作树」，主工作树同样满足。

## What Changes

- pipe 默认在**当前目录**从 main 切出同名 change 分支直接开发，不再新建 worktree。
- 新增确定性分支判断：在 main 上直接切分支；在其它开发分支上提示用户三选一（切分支 / 改用 worktree / 中止）；工作区不干净且需切分支时停下，**不自动 stash**；从非 main 分支切出前校验 `main` 是其祖先。
- Epic 主会话仍在当前目录（停在 main），每个就绪子变更按需新建独立分支与 worktree，保持「最多三个并行」。
- integrate 收尾切回 main 并删除已合并的 change 分支。
- `worktreeRemoved` / `worktreeDeleted` 保留字段名，语义重定义为「不再存在该 change 的 linked worktree」；原地模式下记为 `true`。
- `--worktree` 参数保留，原地模式下记录主仓根；由此 `progress.js` / `progress-cli.js` / `epic-preflight.js` 的既有校验与状态机**无需改动**，历史 progress.md 保持可恢复。
- 同步 `.agents/skills/pipe/WORKFLOW.md`、`progress-template.md`、各宿主入口文档与 canonical 规格。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `workflow-core`: 阶段状态机的进度记录从「linked worktree」改为模式中立的工作区记录与清理语义；`both` 域的跨语言写入串行从「同一 worktree」改为「同一工作区」；新增「变更工作区与分支选择」要求，定义默认原地开发、分支判断决策、Epic 子项隔离与收尾语义。P3（Epic 子变更并行）与 P6（指纹跨 cwd 稳定）语义未变，不改。

## 关联 Issue

- GitHub Issue：[#145](https://github.com/zsxink/MusicTag/issues/145)（分支提交使用 `feat(optimize-pipe-in-place-branch): ...`，PR 使用 `Closes #145`）。

## Impact

- 影响 `.agents/workflows/`：新增 `assert-pipe-workspace.sh`（双模式工作区断言）与 `pipe-branch-check.sh`（分支判断）；改 `pipe-preflight.sh` 调用点；退役 `assert-linked-worktree.sh`。
- 影响 `.agents/tools/pipe-native/self-check.js`（必检文件清单）、`progress-template.md`、`.agents/skills/pipe/WORKFLOW.md`、各宿主入口（`AGENTS.md`、`.claude/CLAUDE.md`、`.claude/commands/*`、`.opencode/commands/*`）。
- `.claude/settings.json` 补 `Bash(git worktree:*)` 权限项，供 Epic 派发子项 worktree。
- `progress.js` / `progress-cli.js` / `epic-preflight.js` 不改；历史 progress.md 保持可恢复。
- 不改变 MusicTag 产品功能、Tauri command、Rust/Vue 业务实现或 V1 已拍板行为。
- 验证基线：`bash -n`、`node --check`、`node .agents/tools/pipe-native/self-check.js`、`node --test .agents/tools/pipe-core/test/*.test.js tests/workflow-core/*.test.cjs`、**`node --test .agents/tools/pipe-native/test/*.test.js`**（infra 默认计划遗漏此项）、`npx --yes @fission-ai/openspec@1.5.0 validate --all --strict --no-interactive`。
