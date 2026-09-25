# MusicTag 项目规则

## 产品与规格

MusicTag 是 Tauri 2 + Rust + Vue 3 的本地单曲标签编辑器。产品行为以 `docs/V1-PRD.md` 为准，技术契约以 `docs/design/design.md` 为准，变更规格位于 `openspec/changes/<name>/`。改变产品行为前，同步前两份文档。

必须保留：一次一首、选中时只搜索缺失歌词/封面、候选手动选择后才填入、保存全量覆盖、直接写原文件、MP3 ID3v2.4、坏标签只读、保存失败可重试、全源网络失败后的会话离线降级。

## OpenSpec 与 Git

- 新变更先创建 GitHub Issue 和 OpenSpec change；proposal/specs 经用户确认后才进入开发。
- 分支名等于 change 名，从 main 创建；不得在 main 直接开发。
- 归档发生在创建 PR 前；PR 使用 `Closes #<issue>`，等待 required CI 后合并。
- 子 Agent 不执行 `git add`、`git commit`、push、PR 或 merge；当前主会话审计授权路径后执行这些动作。

## pipe

`/pipe <change>`、`/pipe:init`、`/pipe:epic` 和 `/pipe:epic:status` 均由当前 Claude 主会话执行。先读取 `.agents/skills/pipe/SKILL.md` 与 `.agents/skills/pipe/WORKFLOW.md`，公共角色规则位于 `.agents/tools/pipe-core/roles/`。

- 当前主会话是 Leader，负责阶段推进、问题裁决、进度记录、提交和集成；不要创建 `leader` 子 Agent。
- 用 Claude 原生 Agent 工具派发 Architect、Dev、Tester、CR、Verify。不要使用任何 CLI driver、Agent CLI 或完整子流水线进程。
- 主会话是 `openspec/changes/<change>/tasks.md` 开发勾选和 `.agents/runs/<change>/progress.md` 的唯一写入者。恢复时核对 Git、worktree、PR 与 CI 事实，不信任旧标记。
- 子 Agent 只能改主会话授予的路径；CR 必须只读。子 Agent 以 `DONE`、`NEEDS_PARENT_DECISION` 或 `FAILED` 加证据回报。
- 已批准规格内的技术问题由主会话回答并写进 progress；规格冲突、范围变化、不可逆外部动作或无法判断的问题升级给用户。宿主权限确认仍由宿主处理。
- CR 至多三轮；验证或 CR 不能有证据通过时挂起。不得跳过任何质量门。
- Epic 依据 `epic.json` 的 `dependsOn`，用独立 worktree 最多并行三个就绪子变更，且以前置项远端已合并为解锁条件。

运行确定性 preflight、OpenSpec、Git、构建、测试和 GitHub 命令时直接使用主会话的命令工具。无法提供角色所需的原生最小权限时，在写入前停止，不回退到旧 CLI 调度。

## 验证

代码域依序运行 `cargo check --manifest-path src-tauri/Cargo.toml`、`cargo test --manifest-path src-tauri/Cargo.toml`、`npm run test`、`npm run build` 与 `npx openspec validate <change> --strict --no-interactive`。docs/spec/infra 域运行适用脚本检查和 OpenSpec 校验。报告如实使用中文。
