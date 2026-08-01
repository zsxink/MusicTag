# MusicTag 项目规则

## 项目是什么

MusicTag 是一个跨平台桌面应用：**一次一首**地给本地裸 FLAC/MP3 补全元数据（歌名、作者、专辑、封面、歌词）。工具线 · 自用 · 纯本地取向。

目标播放器：用户自研播放器 + Slat Player。无批量（批量是 V2）、无在线曲库、无账号。

## 定稿规格（最终权威）

全部已拍板决策在以下两份文档，**实现前必须先读、实现时必须服从**：

- `docs/V1-PRD.md` —— 产品需求文档（含验收标准）
- `docs/design/design.md` —— 技术设计（Tauri command 契约 §10、前端结构等）
- 记忆 `music-tag-v1-spec.md` —— V1 定稿规格摘要（`/grill-me` 审定）

新增/修改产品行为时，先同步这两份文档再动手改代码。

## V1 关键约束（已拍板，勿违反）

- **一次一首**：无批量编辑。
- **选中即搜**：选中歌曲那一刻，仅对缺失的歌词/封面自动联网搜索（网易云+QQ+咪咕并发聚合）；已有则不搜；删除后不自动再触发。
- **结果不自动写盘**：候选一律列表展示、手动点选才填入；切歌即弃。
- **保存 = 表单全量覆盖**：填了就存、不填即清空删除；无空字段保护、无自动继承/补全。
- **直接写盘**：无备份、无撤销；标签始终写回原路径；改名是独立动作；撞名拒绝覆盖。
- **MP3 统一写 ID3v2.4**（lofty 默认，勿用 `use_id3v23`）。
- **坏标签只读**：`open_song` 读标签失败 → 表单只读禁用，提示「标签损坏，只读」。
- **保存失败**：表单内容保留可重试，顶栏标「✕ 保存失败：原因」，dirty 保持 true，绝不假报已保存。
- **离线降级**：会话内首次自动搜索全源失败 → 标记离线，后续选中不再自动搜，只留手动搜索按钮。

## 技术栈

- 外壳 Tauri 2 + Rust；前端 Vue 3 + Vite + TypeScript（`<script setup>`，单 store 不用 Pinia）
- 标签读写 **lofty**（MP3 写 ID3v2.4；FLAC Vorbis `LYRICS`/PICTURE、MP3 USLT/APIC 全支持）
- 其余：`image`（封面压缩）、`walkdir`（遍历）、`rfd`（对话框）、`reqwest`+`serde_json`（搜索）、`tokio`（并发）、`aes`+`cbc`+`rsa`+`rand`（网易云加密，无 JS 引擎）
- 封面跨 IPC 用 base64 data URL，写盘时 Rust 解码回原始字节

## 常用命令

```sh
# 前端
npm run dev          # 启动 Vite（浏览器态）
npm run build        # 前端构建
npm run tauri dev    # 起 Tauri 开发窗口（外壳）
npm run tauri build  # 打包

# 后端（Rust）
cargo check          # 快速类型检查
cargo test           # 单元/集成测试（lofty 读写、网易云加密、压缩）
cargo clippy         # lint
cargo fmt            # 格式化
```

## 规格与变更管理（OpenSpec）

- 变更生命周期由 **OpenSpec** 管理：`openspec/` 是规格根目录，schema 为 spec-driven。
- 命令：`/opsx:explore`（探索/澄清）、`/opsx:propose <name>`（生成 proposal→specs→design→tasks）、`/opsx:apply <name>`（按任务实现）、`/opsx:sync`（回写规格）、`/opsx:archive <name>`（归档、更新主规格）；`/opsx:run` 仅兼容保留，新变更使用 `pipe`。
- 变更在 `openspec/changes/<name>/`；V1 定稿规格（`docs/V1-PRD.md`、`docs/design/design.md`）保持权威，**拍板决策变更须同步这两份文档**。
- 项目语境与规则已注入 `openspec/config.yaml`（context + 每类 artifact 的 rules）。

## 开发流水线（需求确认后自动完成）

- **总入口**：`pipe` skill —— 需求确认后自动跑完「前置校验 → 架构设计 → 开发 → 测试 → CR → 最终验证 → 归档 → 提交 PR → 合并」。
- **一键全自动（多 Agent 协作）**：`/pipe <name>` —— 由 Workflow 工具编排多 Agent（Leader 主导，7 角色分工），完整闭环。
- **兼容单 Agent 流程**：`/opsx:run <name>` —— 仅用于既有变更，且不得绕过 `pipe` 的前置校验、最终验证和 CI 门禁。
- **Epic 大变更拆分**（如 V1 整个产品，通用可复用 V2）：
  - `/pipe:init <epic> [来源]` —— Architect 自动拆成多个子变更并生成/校验完整 OpenSpec artifacts，**用户只批一次总 PRD**；`openspec/epics/<epic>/epic.json` 受版本控制
  - `/pipe:epic <epic>` —— 串行实施：逐个子变更跑完整 `/pipe`（前置校验→架构→开发→测试→CR→最终验证→归档→PR→合并），前一个合回 main 再开下一个；中断可续跑
  - `/pipe:epic:status <epic>` —— 查看进度/断点
  - 子变更内部 **100% 复用 `/pipe`**（一 change 一分支一 PR）；Epic 状态放 `openspec/epics/`，独立于 openspec 变更生命周期
- **分步命令**：
  - `/cr <name>` —— 自动代码审查（只读 subagent 对照规格审查 diff；有问题打回 Leader 重派开发角色修复）
  - `/verify <name>` —— 自动验证（cargo check/test + npm run build + openspec validate）
  - `/opsx:apply <name>`、`/opsx:archive <name>` —— openspec 官方步骤
- **唯一强制确认点**：PRD（proposal + specs）用户批准（= 需求确认）。**确认后即全自动，用户不再参与**；设计由 Architect 自动产出。流程中不设中间确认，只在歧义/缺陷/验证不过/CR 三轮挂起/用户打断时停下上报。

## 多 Agent 协作（pipe 流水线）

- **7 角色**：Leader（编排）、Architect（设计+变更域判定）、Rust-Dev（`rust-backend`）、Vue-Dev（`vue-frontend`）、CR（`cr-agent`，只读）、Verify/CI（`verify-agent`）、Tester（`tester`）。
- **编排**：Workflow 脚本 `.claude/workflows/music-tag-run.js`，`/pipe <name>` 调用，`args.name=<变更名>`。
- **自适应组织**：Architect 判定变更域——纯后端仅 Rust-Dev、纯前端仅 Vue-Dev、跨前后端按 Rust→Vue 串行；未显式创建 worktree 时禁止并写。
- **CR 只读、Leader 中转**：CR 只读审查（不 Edit/Write 代码），问题打回 Leader → Leader 重派对应开发角色修复 → 再复审。
- **CR 三轮未通过 → 挂起**：不再自动重试，停下上报用户决策。
- **Workflow 返回**：`success` 表示质量门通过，Leader 再执行归档→提交 PR→确认 CI→合并；`verify_failed`/`test_failed` 打回修复重跑；`suspended`/`failed` 停下上报。

## GitHub（远程 + Issue 驱动）

- **远程仓库**：`git@github.com:zsxink/MusicTag.git`（SSH）。`git init` 后 `git remote add origin git@github.com:zsxink/MusicTag.git`。
- **Issue 驱动**：需求/变更建议优先提 GitHub Issue；`/pipe` 支持从 Issue 号或 Issue 链接出发。
- **Issue 关联**：变更分支用 `feat(<issue>): <任务>` 提交；PR 描述引用 `Closes #<issue>`，PR 合并即自动关闭对应 Issue。
- **PR 基分支**：一律 `--base main`。
- `gh` CLI 已白名单（`gh:*`）。

## Git 约定

- **每变更一分支**：分支名 = change 名（kebab-case），从 main 开，`git checkout -b <name>`。
- 不在 main 上直接开发；**merge PR 是回到 main 的唯一方式**。
- 开发期间**增量提交**（`feat(<name>): <任务>`），进度可追溯、崩溃可恢复。
- **归档在提交 PR 前**：`/opsx:archive <name>` 的规格改动进分支，与代码一起进 PR，合并后主规格即最新。
- PR 合并前必须等待 GitHub CI required checks；本地 Verify 不能替代远端门禁。
- **提交 PR**：`git push -u origin <name>` + `gh pr create --base main --head <name>`；**合并**：`gh pr merge <name> --squash`。
- 合并后 `git branch -d <name>` 清理已合并分支（`-d` 只删已合并）。
- 现有 git 相关 superpowers skills：`using-git-worktrees`（需要隔离工作区时）、`finishing-a-development-branch`（合并决策）。

## 工作流约定

- 有 CodeGraph 索引的项目用 `codegraph_explore`（MCP）或 `codegraph explore`（shell）定位/理解代码，优先于 grep/find。本项目暂未建索引（`.codegraph/` 不存在时跳过）。
- 只读研究、独立分析、并行搜索交给 subagent，主会话只保留编辑与多轮对话（见全局 CLAUDE.md）。
- 新功能/改行为 → 走项目级 `pipe` skill；一键 `/pipe <name>` 或 `/opsx:run <name>`。
- 遇到 bug：先 `superpowers:systematic-debugging`，再谈修复。
- 测试驱动：新逻辑先写失败测试，再实现到绿。
- CR 审查对照规格，不只查 bug；发现的问题自动修复再复审。

## 语言与沟通

- 代码标识符、注释遵循周围既有风格；UI 文案用中文。
- 与用户沟通默认中文。

## 验证

改完代码后运行对应验证：Rust 侧 `cargo check --manifest-path src-tauri/Cargo.toml` + `cargo test --manifest-path src-tauri/Cargo.toml`；前端 `npm run test` + `npm run build`；涉及跨端契约改动时跑 `npm run tauri dev` 人工确认。报告结果要如实——失败就报失败并附输出，不粉饰。
