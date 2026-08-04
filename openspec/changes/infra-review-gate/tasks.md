# infra-review-gate 任务清单

> GATE（门禁性质）：纯只读复核，无产品代码。顺序执行：确认 7 项全部合并 → 逐维度独立复核 → 汇总判定 → 通过则关闭 #48 / 不通过则挂起上报。本变更的「完成」= 整个 Epic「项目基建初始化」（#48）的收尾。

## 1. 前置确认（design.md D1：7 项已全部合并回 main）

- [ ] 1.1 运行 `git log main` 确认 7 个依赖子变更均已合并回 main：infra-repo-docs（#49）/ infra-claude-md-root（#50）/ infra-codegraph（#51）/ spec-review（#52）/ workflow-optimize（#53）/ infra-icons（#54）/ ci-release（#55）
- [ ] 1.2 对照 `openspec/epics/infra/epic.json` 7 项的 `implementationCommit`（595a2ba / d75d287 / bfb6bdf / f2426a5 / fe5a8a0 / 99fa622 / 262c3e7），逐条 `git cat-file -e <sha>` 确认提交对象存在且在 main 可达历史
- [ ] 1.3 任一子变更未合并 → 不启动复核，等待其合并后再执行本清单（本 gate 是最后一个子变更）

## 2. 维度复核（design.md D2：只读独立复核，不受实施影响）

> 每维度产出具名证据（只读命令输出摘录）；本步骤全程无 Write/Edit、无仓库文件修改。

### 2.1 规格一致性（docs 与 openspec 一致）
- [ ] 2.1.1 核对 `docs/V1-PRD.md`、`docs/design/design.md`、`openspec/`、记忆 `music-tag-v1-spec.md`（`~/.claude/projects/-Users-xian-Project-music-MusicTag/memory/music-tag-v1-spec.md`）四源：V1 关键约束（一次一首 / 选中即搜 / 结果不自动写盘 / 保存=表单全量覆盖 / 直接写盘 / MP3 统一写 ID3v2.4 / 坏标签只读 / 保存失败保留可重试 / 离线降级）表述一致、无矛盾
- [ ] 2.1.2 以 `src-tauri/src/lib.rs` 的 `generate_handler![...]` 实际注册清单（当前 11 个 command）为真值基准，交叉核对 docs/openspec 中 command 契约描述：无 `embed_cover` 之类废弃残留、无未同步的已拍板决策、无陈旧描述
- [ ] 2.1.3 交叉核对 `openspec/` 归档与主规格：无未同步的已拍板决策、无陈旧描述残留

### 2.2 工作流可运行
- [ ] 2.2.1 静态自检 `.claude/workflows/*.js` 逐个 `node --check`、`*.sh` 逐个 `bash -n`，均无报错
- [ ] 2.2.2 核对 `.claude/workflows/` 脚本、`openspec/config.yaml`、各 skill/agent 定义相互自洽：workflow prompt 引用的 skill/agent 名（如 `pipe`、`cr-agent` 等）在 `.claude/skills/` 中均存在，无引用断点
- [ ] 2.2.3 检查 pipe / CR / verify 门禁链路：入口与步骤完整可执行（`music-tag-run.js` 的 phases、`/cr`、`/verify` 均有定义且相互可到达），无失效引用

### 2.3 icons/CI 产物与 config 吻合
- [ ] 2.3.1 解析 `src-tauri/tauri.conf.json` 的 `bundle.icon` 数组（当前 5 个引用，相对 `src-tauri/` 解析），逐文件 `test -f src-tauri/<引用>` 断言存在（icons/32x32.png / icons/128x128.png / icons/128x128@2x.png / icons/icon.icns / icons/icon.ico）
- [ ] 2.3.2 校验 `.github/workflows/release.yml` YAML 语法正确（`gh workflow view` 或结构解析），与 `.github/workflows/ci.yml` 职责互补、不冲突（触发条件、jobs 名、permissions 声明比对）

### 2.4 根级与 .claude 的 CLAUDE.md 无矛盾
- [ ] 2.4.1 逐条比照根级 `CLAUDE.md` 与 `.claude/CLAUDE.md`：V1 关键约束 / 技术栈 / 常用命令 / 工作流流程两处对同一规则的**取值**一致、无相互矛盾（表述详略不同不算矛盾）
- [ ] 2.4.2 两份 CLAUDE.md 均与定稿 specs（`docs/V1-PRD.md`、`docs/design/design.md`）的已拍板决策对齐

## 3. 汇总判定（design.md D3：唯一两个出口）

- [ ] 3.1 4 个维度（2.1–2.4）**全部**通过 → 汇总判定「通过」，产出通过结论与证据
- [ ] 3.2 任一维度不通过 → 判定「挂起」（suspended），列出不通过维度与证据，**不回滚任何已合并项**，不触发修复循环

## 4. 出口动作

- [ ] 4.1 复核通过 → 通过整个 Epic 工作流，关闭 Epic Issue #48（本变更 PR `Closes #56`，合并后关闭 Epic #48）
- [ ] 4.2 复核不通过 → 挂起上报，阻断 #48 关闭，问题记录上报后按需另开变更跟进
