# infra-review-gate Specification

## Purpose
TBD - created by archiving change infra-review-gate. Update Purpose after archive.
## Requirements
### Requirement: 仅当 7 个依赖子变更全部合并后才触发复核
本门禁 SHALL 仅在 dependsOn 的全部 7 个子变更（infra-repo-docs / infra-claude-md-root / infra-codegraph / spec-review / workflow-optimize / infra-icons / ci-release）都合并回 main 后才触发对最终仓库状态的复核。

#### Scenario: 依赖未全部合并则不触发
- **WHEN** 任一依赖子变更尚未合并回 main
- **THEN** 本门禁不启动复核，等待全部依赖合并

#### Scenario: 依赖全部合并后触发
- **WHEN** 7 个依赖子变更全部已合并回 main
- **THEN** 以 main HEAD 的最终仓库状态为对象启动独立复核

### Requirement: 复核为只读、独立、不受实施过程影响
复核 SHALL 以合并后的最终仓库状态为准执行，只读核验并产出证据清单，不修改任何仓库文件、不修 bug、不触发修复循环。

#### Scenario: 只读核验产出证据
- **WHEN** 对最终仓库状态执行任一维度复核
- **THEN** 只读（无 Write/Edit），产出该维度的通过/不通过判定与逐项证据

#### Scenario: 不触发修复循环
- **WHEN** 复核发现某一维度不通过
- **THEN** 不自动修复、不循环打回，仅记录证据并挂起上报

### Requirement: 规格一致性（docs 与 openspec 一致）
最终仓库状态 SHALL 满足规格四源一致：`docs/V1-PRD.md`、`docs/design/design.md`、`openspec/`、记忆 `music-tag-v1-spec.md` 无相互矛盾、无已拍板决策遗漏、无陈旧描述残留。

#### Scenario: 四源关键决策一致
- **WHEN** 比对 V1 关键约束（一次一首 / 选中即搜 / 结果不自动写盘 / 保存=表单全量覆盖 / 直接写盘 / MP3 统一写 ID3v2.4 / 坏标签只读 / 保存失败保留可重试 / 离线降级）在四源中的表述
- **THEN** 关键决策表述一致，无矛盾（spec-review 的修订已在最终状态生效）

#### Scenario: 规格与 openspec 归档一致
- **WHEN** 将 `openspec/` 中的变更/归档与 `docs/V1-PRD.md`、`docs/design/design.md` 进行交叉核对
- **THEN** 主规格与 openspec 记录一致，无未同步的已拍板决策

### Requirement: 工作流可运行
最终仓库状态 SHALL 保证工作流自洽可执行：`.claude/workflows/`、`openspec/config.yaml`、各 skill/agent 定义相互一致，pipe/CR/verify 门禁链路无断点。

#### Scenario: 工作流链路自洽
- **WHEN** 核对 `.claude/workflows/` 脚本、`openspec/config.yaml`、skill/agent 定义之间的引用与契约
- **THEN** 相互一致、无引用断点（workflow-optimize 的优化已在最终状态生效）

#### Scenario: 门禁可执行
- **WHEN** 检查 pipe / CR / verify 门禁链路的入口与步骤
- **THEN** 链路完整可执行，无缺失步骤或失效引用

### Requirement: icons/CI 产物与 config 吻合
最终仓库状态 SHALL 满足 `tauri.conf.json` 的 `bundle.icon` 数组每个引用的图标文件均存在，且 `.github/workflows/release.yml` 语法正确、与既有 `ci.yml` 不冲突。

#### Scenario: bundle.icon 引用文件齐全
- **WHEN** 核对 `tauri.conf.json` 的 `bundle.icon` 数组与 `src-tauri/icons/` 实际文件
- **THEN** 数组中的每个引用文件均存在（infra-icons 的三端图标产物已在最终状态生效）

#### Scenario: release.yml 语法正确且不冲突
- **WHEN** 校验 `.github/workflows/release.yml`（YAML 语法）并核对与 `.github/workflows/ci.yml` 的关系
- **THEN** release.yml 语法正确，与 ci.yml 职责互补、不冲突（ci-release 的 CI 产物已在最终状态生效）

### Requirement: 根级与 .claude 的 CLAUDE.md 无矛盾
最终仓库状态 SHALL 保证根级 `CLAUDE.md` 与 `.claude/CLAUDE.md` 逐条比照无相互矛盾，V1 关键约束、技术栈、常用命令、工作流流程两处表述一致。

#### Scenario: 两份 CLAUDE.md 逐条一致
- **WHEN** 逐条比照根级 `CLAUDE.md` 与 `.claude/CLAUDE.md` 的规则章节
- **THEN** 两处无相互矛盾（infra-claude-md-root 的根级文件已在最终状态生效）

#### Scenario: 与定稿 specs 对齐
- **WHEN** 将两份 CLAUDE.md 与 `docs/V1-PRD.md`、`docs/design/design.md` 的已拍板决策对照
- **THEN** 两份 CLAUDE.md 均与定稿 specs 对齐、无矛盾

### Requirement: 复核通过则通过 Epic 并关闭 #48
当且仅当 4 个复核维度全部通过时，本门禁 SHALL 判定 Epic「项目基建初始化」通过，关闭 Epic Issue #48。

#### Scenario: 全维度通过 → 关闭 #48
- **WHEN** 4 个维度（规格一致性 / 工作流可运行 / icons+CI 与 config 吻合 / CLAUDE.md 无矛盾）全部判定通过
- **THEN** 汇总判定「通过」，通过整个 Epic 工作流并关闭 Epic Issue #48

### Requirement: 复核不通过则挂起上报、阻断关闭 #48
当任一复核维度不通过时，本门禁 SHALL 挂起上报（suspended），阻断 Epic Issue #48 的关闭，列出不通过维度与证据；**不回滚任何已合并项**。

#### Scenario: 任一维度不通过 → 挂起阻断
- **WHEN** 任一复核维度判定不通过
- **THEN** 挂起上报、阻断 #48 关闭，列出不通过维度与证据，已合并的 7 项产物保持原样不回滚

#### Scenario: 不通过不触发返工循环
- **WHEN** 复核不通过后
- **THEN** 不自动重试修复、不循环打回；缺口以记录上报，后续按需另开变更跟进

