## Why

Epic「项目基建初始化」（总 Issue #48）的 7 个子变更（infra-repo-docs / infra-claude-md-root / infra-codegraph / spec-review / workflow-optimize / infra-icons / ci-release）分别落地了 README、根级 CLAUDE.md、codegraph 索引、spec 复核修订、工作流优化、三端图标与发布 CI。单个子变更的 PR 合并只证明「该 diff 自身正确」，无法证明**合并后的最终仓库状态**整体自洽：规格三处文档（docs 与 openspec）是否一致、工作流是否真能跑通、icons/CI 产物是否与 config 吻合、根级与 `.claude` 的 CLAUDE.md 是否有矛盾，都只在 7 项全部合并回 main 后才有意义。

本变更作为 Epic 的**收尾把关 GATE**：在 7 项全部合并后，对最终仓库状态做一次只读独立复核（不受实施影响），复核通过才判定整个 Epic 完成并关闭 #48；不通过则挂起上报、阻断关闭。它是纯门禁，不是功能子变更，不修 bug、不触发修复循环、不回滚任何已合并项。

## What Changes

- **复核时机**：7 个 dependsOn 子变更全部合并回 main 后触发；以最终仓库状态（main HEAD）为准，不受任何实施过程影响。
- **复核方式**：只读独立复核（read-only subagent 对照规格与清单逐维度核验），仅产出「通过 / 不通过 + 证据清单」，不写代码、不修 bug、不触发修复循环。
- **复核维度（4 个）**：
  1. **规格一致性**：`docs/V1-PRD.md`、`docs/design/design.md`、`openspec/`、记忆 `music-tag-v1-spec.md` 四源一致，无陈旧/矛盾描述（spec-review 的产出在最终状态上复核）。
  2. **工作流可运行**：`.claude/workflows/`、`openspec/config.yaml`、各 skill/agent 定义自洽；pipe/CR/verify 门禁链路可执行（workflow-optimize 的产出在最终状态上复核）。
  3. **icons/CI 产物与 config 吻合**：`src-tauri/icons/` 全套齐全且 `tauri.conf.json` 的 `bundle.icon` 数组每个引用都存在；`.github/workflows/release.yml` 语法正确、与 `ci.yml` 不冲突（infra-icons / ci-release 的产出在最终状态上复核）。
  4. **CLAUDE.md 无矛盾**：根级 `CLAUDE.md` 与 `.claude/CLAUDE.md` 逐条比对无矛盾（infra-claude-md-root 的产出在最终状态上复核）。
- **判定与动作**：
  - **复核通过** → 汇总判定「通过」，通过整个 Epic 工作流，关闭 Epic Issue #48（本变更的 PR 引用 `Closes #56`）。
  - **复核不通过** → 挂起上报（suspended），阻断 #48 关闭，列出不通过维度与证据；**不回滚任何已合并项**（7 项已合并产物保留，问题记录上报后按需另开变更处理）。

## Capabilities

### New Capabilities
- `infra-review-gate`: 整条 Epic 合并后的只读整体终审门禁——4 维复核（规格一致性 / 工作流可运行 / icons+CI 与 config 吻合 / CLAUDE.md 无矛盾）+ 通过关闭 #48 / 不通过挂起阻断的判定动作

### Modified Capabilities
（无）

## 关联 Issue

- GitHub Issue：`#56`（Epic「项目基建初始化」总 Issue #48 的收尾子变更；分支提交 `feat(56): ...`、PR `Closes #56`，合并后关闭 Epic #48）
- 依赖：全部 7 项（infra-repo-docs `#49` / infra-claude-md-root `#50` / infra-codegraph `#51` / spec-review `#52` / workflow-optimize `#53` / infra-icons `#54` / ci-release `#55`）

## Impact

- **纯门禁、零功能变更**：不产生任何产品代码、不碰 Rust 后端 / Vue 前端 / Tauri command 契约 / 构建配置；不新增依赖。
- **可写动作面极窄**：复核通过时仅执行「关闭 Epic Issue #48」；不通过时仅「挂起上报 + 阻断关闭」。本变更自身不修改仓库任何文件（产出为只读复核报告）。
- **Epic 收尾锚点**：本变更的「完成」= 整个 Epic「项目基建初始化」的完成——是最后一个子变更，其结果决定 #48 能否关闭。
- **风险隔离**：复核不通过不触发修复循环、不回滚已合并项，避免「门禁演化成返工流水线」；任何缺口以新 Issue 方式跟进，保持已合并产物稳定。
