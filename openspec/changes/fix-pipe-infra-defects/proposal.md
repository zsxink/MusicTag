## Why

关联 GitHub Issue：#147（`[Infra] pipe 工作流基建既有缺陷汇总`）。

pipe 工作流的四项既有基建缺陷（Issue #147）在最近一次完整跑通 bootstrap → integrate 时暴露，都会让主 Agent 拿到**错误的事实**并据此误判：归档 wrapper 报出的 `Rules for 'all' must be an array of strings` 与 openspec 版本无关，真因是 `openspec/config.yaml` 的规则写法在 YAML 层就失效了；`source-fingerprint.js` 的指纹随「删除是否已提交」漂移，导致 Verify 记录值与 integrate 复算值不一致而使整条验证作废；`wait-ci.js` 对瞬时网络错误不重试且与真实 CI 失败同码同形；仓库 CI 从不运行 pipe 自身的 13 个原生测试套件，使这些质量门在远端完全不可见。四项彼此独立，但都属同一类问题——**工具给出不可复核或不可区分的结果**，故合为一个 infra 变更统一排期。

## What Changes

- **修复 `openspec/config.yaml` 规则失效**：给 `rules.all` 首条含 `feat(<issue>): <任务>` 的项加引号（冒号+空格被 YAML 解析为嵌套映射，导致整组 rules 被静默忽略），使 warning 消失、artifact 规则重新生效。
- **统一 openspec CLI 版本固定点**：抽出共享版本常量，把 `.agents/commands/archive-change.js`（唯一裸调 PATH `openspec` 的位置）、`verify.js`、`pipe-preflight.sh`、`pipe-epic-preflight.sh` 的调用统一到与 CI 同源的 `1.5.0`；散文指令面（`AGENTS.md`、`.claude/CLAUDE.md`、`WORKFLOW.md`、角色规则、`.opencode` 权限白名单、legacy opsx 命令与 `openspec-*` skill）同样固定，自检对散文裸形态 fail-closed，使版本漂移不可能静默复发。
- **消除源码指纹的提交状态漂移**：让指纹只由工作区内容决定——「已跟踪但当前不存在」的文件不再产生 `kind: "deleted"` 条目；同步更新 `progress.js` 的 kind 白名单、WORKFLOW.md 与 canonical spec 的表述，并补一条「删除 tracked 文件在提交前后指纹相同」的回归测试。
- **`wait-ci.js` 对瞬时网络错误有界退避重试**：对 `gh` 的 EOF / 连接重置 / 超时 / 5xx 等可重试错误做有上限的退避重试；输出增加 `errorKind` 以区分「取不到远端事实」与「required CI 真的未通过」，两者不再同码同形。顺带把 15 秒忙等换成定时器等待。
- **CI 运行 pipe 原生测试套件**：`ci.yml` 的 `validate` job 追加运行 `node --test`（pipe-core + workflow-core + pipe-native 三组，含 glob 形式以规避 Node 24 的 `MODULE_NOT_FOUND`）与 `self-check.js`；`release.yml` 的 `test` job 追加同一门禁；并补 `verify.js` infra 计划遗漏的 `.agents/tools/pipe-native/test/*.test.js`。

以上均不改变 MusicTag 产品行为（不触碰 `docs/V1-PRD.md` / `docs/design/design.md` 定义的标签读写契约、一次一首边界或搜索行为）。

## Capabilities

### New Capabilities
（无 —— 本变更不引入新能力，仅修正既有能力的既有缺陷。）

### Modified Capabilities
- `pipe-native`: 新增「工具版本固定与 rules 有效性」要求（版本固定点、rules 失效检测）；修改「跨宿主复算源码指纹」相关要求，使指纹不再依赖 Git 提交状态。
- `workflow-core`: 修改「中立工作流与确定性命令」，要求 wrapper 与 preflight 的 openspec 调用固定版本且瞬时网络失败可重试并可区分；修改「统一验证基线」，要求原生测试套件进入 CI 与验证计划。
- `ci-release`: 修改「test 门禁先行」与「与 ci.yml 校验门禁互补」，要求 `release.yml` 的 `test` job 同样运行 pipe 原生测试套件与自检。

## Impact

- **配置**：`openspec/config.yaml`（rules 引号修复）。
- **pipe 命令 wrapper**：`.agents/commands/archive-change.js`、`wait-ci.js`（`.agents/commands/` 下无共享模块，需各自内聚或新增一个共享小模块）。
- **pipe 原生工具**：`.agents/tools/pipe-native/source-fingerprint.js`、`progress.js`（kind 白名单）、`self-check.js`（新增版本固定点检查）、`.agents/tools/pipe-core/verify.js`（infra 计划补测试套件）。
- **工作流脚本**：`.agents/workflows/pipe-preflight.sh`、`.agents/workflows/pipe-epic-preflight.sh`。
- **CI**：`.github/workflows/ci.yml`、`.github/workflows/release.yml`。
- **文档**：`.agents/skills/pipe/WORKFLOW.md`（指纹 kind 表述、openspec 版本固定要求）。
- **测试**：`.agents/tools/pipe-core/test/commands.test.js`（新增版本固定与 wait-ci 重试用例）、`.agents/tools/pipe-native/test/progress.test.js`、`tests/workflow-core/native-entry-contract.test.cjs`（指纹删除回归、CI workflow 门禁断言）。
- **不影响**：MusicTag 产品代码（`src/`、`src-tauri/`）、PRD 与技术设计文档。