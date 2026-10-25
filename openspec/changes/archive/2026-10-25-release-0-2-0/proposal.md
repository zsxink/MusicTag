# 发布 v0.2.0

## 背景

`v0.1.5` 发布后，项目合入 Homebrew Cask 的 livecheck 与卸载清理改进、文件夹入口位置调整，以及三端构建成功后自动发布 Release 并触发 tap 同步的流程。本次准备 `v0.2.0`，复核近期用户可见变化、更新版本声明与发布说明，并在合并后走现有自动发布流程。

GitHub Issue：#186

## 范围

- 复核 `v0.1.5..HEAD` 已合入的用户可见变更及发布流程改动，检查实现、文档和现有验证是否一致。
- 修复现有 `publish-release` job 在无 checkout 的 runner 上缺少 GitHub CLI 仓库上下文的问题，并增加对应契约回归；不改变 tag 触发、构建矩阵、发布顺序或 Homebrew 同步机制。
- 将应用自身版本元数据和 README 版本徽章统一更新为 `0.2.0`。
- 汇总 `v0.1.5` 之后的用户可见变化，更新 README 发布说明。
- 合并后在版本提交上推送 `v0.2.0` 标签，核对四平台构建、正式 Release 发布和 Homebrew tap 同步。

## 非目标

- 不增加新的产品功能。
- 不改变标签触发条件、Release 构建矩阵、发布顺序或 tap 同步机制；仅显式传递现有仓库上下文以使发布命令能在新 runner 执行。
- 不调整与本次发布无关的产品行为或开发流程。

## 验收

- npm、Cargo、Tauri 与 README 的应用版本均为 `0.2.0`，第三方依赖版本不被改动。
- README 准确概括 `v0.1.5` 之后实际合入的用户可见变化。
- 对近期变更完成独立复核，无未解决 blocker/major；确认的规格内缺陷须有回归证据并复审。
- OpenSpec 全量校验和当前 CI workflow 适用的验证通过。
- `publish-release` 在无本地 Git checkout 的 runner 中为 `gh` 命令显式提供当前仓库，且契约回归覆盖该条件。
- 合并后 `v0.2.0` 标签的 Release workflow 全部成功，公开 Release 含四平台产物，Homebrew 同步 workflow 成功。
