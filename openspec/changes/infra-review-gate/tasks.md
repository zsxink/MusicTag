# infra-review-gate 任务清单

> GATE（门禁性质）：纯只读复核，无产品代码。顺序执行：确认 7 项全部合并 → 逐维度独立复核 → 汇总判定 → 通过则关闭 #48 / 不通过则挂起上报。本变更的「完成」= 整个 Epic「项目基建初始化」（#48）的收尾。

## 1. 前置确认（design.md D1：7 项已全部合并回 main）

- [ ] 1.1 运行 `git log main` 确认 7 个依赖子变更均已合并回 main：infra-repo-docs（#49）/ infra-claude-md-root（#50）/ infra-codegraph（#51）/ spec-review（#52）/ workflow-optimize（#53）/ infra-icons（#54）/ ci-release（#55）
- [ ] 1.2 任一子变更未合并 → 不启动复核，等待其合并后再执行本清单（本 gate 是最后一个子变更）

## 2. 维度复核（design.md D2：只读独立复核，不受实施影响）

### 2.1 规格一致性（docs 与 openspec 一致）
- [ ] 2.1.1 核对 `docs/V1-PRD.md`、`docs/design/design.md`、`openspec/`、记忆 `music-tag-v1-spec.md` 四源：V1 关键约束（一次一首 / 选中即搜 / 结果不自动写盘 / 保存=表单全量覆盖 / 直接写盘 / MP3 统一写 ID3v2.4 / 坏标签只读 / 保存失败保留可重试 / 离线降级）表述一致、无矛盾
- [ ] 2.1.2 交叉核对 `openspec/` 归档与主规格：无未同步的已拍板决策、无陈旧描述残留

### 2.2 工作流可运行
- [ ] 2.2.1 核对 `.claude/workflows/` 脚本、`openspec/config.yaml`、各 skill/agent 定义相互自洽，无引用断点
- [ ] 2.2.2 检查 pipe / CR / verify 门禁链路：入口与步骤完整可执行，无失效引用

### 2.3 icons/CI 产物与 config 吻合
- [ ] 2.3.1 核对 `tauri.conf.json` 的 `bundle.icon` 数组与 `src-tauri/icons/` 实际文件：每个引用的图标文件均存在
- [ ] 2.3.2 校验 `.github/workflows/release.yml` YAML 语法正确，且与 `.github/workflows/ci.yml` 职责互补、不冲突

### 2.4 根级与 .claude 的 CLAUDE.md 无矛盾
- [ ] 2.4.1 逐条比照根级 `CLAUDE.md` 与 `.claude/CLAUDE.md`：V1 关键约束 / 技术栈 / 常用命令 / 工作流流程两处表述一致、无相互矛盾
- [ ] 2.4.2 两份 CLAUDE.md 均与定稿 specs（`docs/V1-PRD.md`、`docs/design/design.md`）的已拍板决策对齐

## 3. 汇总判定（design.md D3：唯一两个出口）

- [ ] 3.1 4 个维度（2.1–2.4）**全部**通过 → 汇总判定「通过」，产出通过结论与证据
- [ ] 3.2 任一维度不通过 → 判定「挂起」（suspended），列出不通过维度与证据，**不回滚任何已合并项**，不触发修复循环

## 4. 出口动作

- [ ] 4.1 复核通过 → 通过整个 Epic 工作流，关闭 Epic Issue #48（本变更 PR `Closes #56`，合并后关闭 Epic #48）
- [ ] 4.2 复核不通过 → 挂起上报，阻断 #48 关闭，问题记录上报后按需另开变更跟进
