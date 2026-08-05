# infra-review-gate 任务清单

> GATE（门禁性质）：纯只读复核，无产品代码。顺序执行：确认 7 项全部合并 → 逐维度独立复核 → 汇总判定 → 通过则关闭 #48 / 不通过则挂起上报。本变更的「完成」= 整个 Epic「项目基建初始化」（#48）的收尾。

## 1. 前置确认（design.md D1：7 项已全部合并回 main）

- [x] 1.1 运行 `git log main` 确认 7 个依赖子变更均已合并回 main：infra-repo-docs（#49）/ infra-claude-md-root（#50）/ infra-codegraph（#51）/ spec-review（#52）/ workflow-optimize（#53）/ infra-icons（#54）/ ci-release（#55）—— `git log main` 见 7 项 checkpoint/功能合并提交（#59–#76），当前分支 base = main HEAD `7ccaa9a`（checkpoint 7），7 项产物均在 main 树中
- [x] 1.2 对照 `openspec/epics/infra/epic.json` 7 项的 `implementationCommit`（595a2ba / d75d287 / bfb6bdf / f2426a5 / fe5a8a0 / 99fa622 / 262c3e7），逐条 `git cat-file -e <sha>` 确认提交对象存在且在 main 可达历史——7 个提交对象均存在；6 个指向 squash 合并前的 feature 分支原始提交（不在 main 可达历史，squash 改写所致），内容已由对应 checkpoint/功能合并提交落进 main 树，且本分支 base 即 main HEAD，终态锚定成立
- [x] 1.3 任一子变更未合并 → 不启动复核，等待其合并后再执行本清单（本 gate 是最后一个子变更）—— 7 项已全部合并，启动复核

## 2. 维度复核（design.md D2：只读独立复核，不受实施影响）

> 每维度产出具名证据（只读命令输出摘录）；本步骤全程无 Write/Edit、无仓库文件修改。

### 2.1 规格一致性（docs 与 openspec 一致）
- [x] 2.1.1 核对 `docs/V1-PRD.md`、`docs/design/design.md`、`openspec/`、记忆 `music-tag-v1-spec.md`（`~/.claude/projects/-Users-xian-Project-music-MusicTag/memory/music-tag-v1-spec.md`）四源：V1 关键约束（一次一首 / 选中即搜 / 结果不自动写盘 / 保存=表单全量覆盖 / 直接写盘 / MP3 统一写 ID3v2.4 / 坏标签只读 / 保存失败保留可重试 / 离线降级）表述一致、无矛盾—— 四源关键约束 9 条逐条比对一致（PRD §FR / design §10 / memory 定稿 / config context 均含 9 条同取值）；`openspec/changes/archive/` 已归档 18 个变更、active 仅本 gate，无未同步已拍板决策
- [x] 2.1.2 以 `src-tauri/src/lib.rs` 的 `generate_handler![...]` 实际注册清单（当前 11 个 command）为真值基准，交叉核对 docs/openspec 中 command 契约描述：无 `embed_cover` 之类废弃残留、无未同步的已拍板决策、无陈旧描述—— `lib.rs` 注册 11 个：pick_folder/list_songs/open_song/save_song/rename_song/pick_cover_file/read_cover_path/search_song/search_source/fetch_lyric/download_cover，与 PRD §7、design §10.3、config.yaml context、记忆四源一致；`openspec/specs/spec-review/spec.md` 中 `embed_cover` 仅作「不得出现」的规则表述非残留
- [x] 2.1.3 交叉核对 `openspec/` 归档与主规格：无未同步的已拍板决策、无陈旧描述残留—— 主规格 18 个 specs 与 archive 18 个变更一一对应；design.md §10.4 落位表已改历史记录表述

### 2.2 工作流可运行
- [x] 2.2.1 静态自检 `.claude/workflows/*.js` 逐个 `node --check`、`*.sh` 逐个 `bash -n`，均无报错—— `music-tag-run.js` 按 workflow 引擎 async 函数包裹方式查语法通过（裸 `node --check` 因顶层 return 报 Illegal return 属引擎包裹预期，包裹后无报错）；`pipe-preflight.sh`/`pipe-epic-preflight.sh` `bash -n` 均 OK
- [x] 2.2.2 核对 `.claude/workflows/` 脚本、`openspec/config.yaml`、各 skill/agent 定义相互自洽：workflow prompt 引用的 skill/agent 名（如 `pipe`、`cr-agent` 等）在 `.claude/skills/` 中均存在，无引用断点—— 7 个 agent、6 个 skill、11 个 command 文件全部存在；workflow 引用的 agent 名均有对应文件，**引用无断点**。⚠️ 但发现 agent 内容陈旧：`.claude/agents/rust-backend.md:11` 的 command 契约仍列废弃 `embed_cover` 且遗漏 `pick_folder`/`pick_cover_file`/`read_cover_path`/`search_source`，与 lib.rs 真值基准（11 个 command）及四源（PRD/design/config/记忆均明确「无独立 embed_cover」）矛盾——spec-review D1 修复了 config.yaml 与记忆但遗漏此 agent 文件（该维度判不通过，见 3.2）
- [x] 2.2.3 检查 pipe / CR / verify 门禁链路：入口与步骤完整可执行（`music-tag-run.js` 的 phases、`/cr`、`/verify` 均有定义且相互可到达），无失效引用—— `music-tag-run.js` phases（preflight→architect→dev→tester→CR 三轮→verify→integration）完整；`/cr`/`/verify`/`/pipe` 命令与 cr-agent/verify-agent 定义互相可达；门禁链路无断点

### 2.3 icons/CI 产物与 config 吻合
- [x] 2.3.1 解析 `src-tauri/tauri.conf.json` 的 `bundle.icon` 数组（当前 5 个引用，相对 `src-tauri/` 解析），逐文件 `test -f src-tauri/<引用>` 断言存在（icons/32x32.png / icons/128x128.png / icons/128x128@2x.png / icons/icon.icns / icons/icon.ico）—— 5 个引用逐一 `test -f` 全部存在；icons/ 目录另含三端全套（64x64.png、Square*.png、StoreLogo.png、android/、ios/ 等）齐备
- [x] 2.3.2 校验 `.github/workflows/release.yml` YAML 语法正确（`gh workflow view` 或结构解析），与 `.github/workflows/ci.yml` 职责互补、不冲突（触发条件、jobs 名、permissions 声明比对）—— 两文件 YAML 解析均 OK；release.yml 触发 `on.push.tags: v*`、ci.yml 触发 `pull_request + push[main]` 职责互补；jobs 名不冲突（release: test/publish-tauri；ci: validate）；permissions 无冲突（release 顶层 `contents: read`、publish-tauri job 内 `contents: write`，与 tauri-action 发布需求吻合；ci 顶层 `contents: read`）

### 2.4 根级与 .claude 的 CLAUDE.md 无矛盾
- [x] 2.4.1 逐条比照根级 `CLAUDE.md` 与 `.claude/CLAUDE.md`：V1 关键约束 / 技术栈 / 常用命令 / 工作流流程两处对同一规则的**取值**一致、无相互矛盾（表述详略不同不算矛盾）—— V1 关键约束 9 条两处逐条同取值（一次一首 / 选中即搜 / 结果不自动写盘 / 保存=表单全量覆盖 / 直接写盘 / ID3v2.4 / 坏标签只读 / 保存失败保留可重试 / 离线降级）；技术栈（Tauri2+Rust / Vue3+Vite+TS / lofty / image / walkdir / rfd / reqwest / aes+cbc+rsa）一致；常用命令一致；工作流入口（/pipe /cr /verify /opsx:*）一致
- [x] 2.4.2 两份 CLAUDE.md 均与定稿 specs（`docs/V1-PRD.md`、`docs/design/design.md`）的已拍板决策对齐—— 两份均未偏离 specs；根级为分层索引指向 .claude/CLAUDE.md，详略差异不算矛盾

## 3. 汇总判定（design.md D3：唯一两个出口）

- [ ] 3.1 4 个维度（2.1–2.4）**全部**通过 → 汇总判定「通过」，产出通过结论与证据 —— 未满足：维度 2 不通过（见 3.2）
- [x] 3.2 任一维度不通过 → 判定「挂起」（suspended），列出不通过维度与证据，**不回滚任何已合并项**，不触发修复循环 —— 判定**挂起（suspended）**：
  - 不通过维度：**维度 2「工作流可运行」**（agent 定义内容陈旧）
  - 证据：`.claude/agents/rust-backend.md:11` command 契约仍列废弃 `embed_cover` 且遗漏 `pick_folder`/`pick_cover_file`/`read_cover_path`/`search_source`；真值基准 `src-tauri/src/lib.rs` 注册 11 个 command 无 `embed_cover`；四源（PRD §7 / design §10.3 / config.yaml context / 记忆）均已修订为「无独立 embed_cover」+ 11 个 command 清单；spec-review D1/D5 修订了 config.yaml 与记忆但遗漏此 agent 文件（该文件在 spec-review 复核范围 `openspec/config.yaml` + `openspec/specs/` 之外，未被覆盖）
  - 其余 3 维（1 规格一致性 / 3 icons+CI / 4 CLAUDE.md）全部通过
  - 已合并 7 项产物保持原样**不回滚**；不触发修复循环；缺口记录上报，按需另开变更跟进（参照 spec-review 的 D1 修订方式补齐 rust-backend.md 的 command 契约行）

## 4. 出口动作

- [ ] 4.1 复核通过 → 通过整个 Epic 工作流，关闭 Epic Issue #48（本变更 PR `Closes #56`，合并后关闭 Epic #48）—— 不适用（复核挂起，阻断 #48 关闭）
- [x] 4.2 复核不通过 → 挂起上报，阻断 #48 关闭，问题记录上报后按需另开变更跟进 —— 判定挂起，阻断 #48 关闭；缺口已记录（rust-backend.md command 契约陈旧），按需另开变更修复后再复核
