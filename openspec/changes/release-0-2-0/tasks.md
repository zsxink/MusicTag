# Tasks: v0.2.0 release

## 规格与基线

- [x] 1. 主会话核对 Issue #186、`release-0-2-0` 分支与工作区、`v0.1.5..HEAD` 提交和相关 PR、当前应用版本声明、README 及 CI/release/homebrew workflow；记录实际 Git 与远端基线证据。
- [x] 2. Architect 交付 design/tasks 后，主会话运行 spec-gate preflight 与 `npx --yes @fission-ai/openspec@1.5.0 validate release-0-2-0 --strict --no-interactive`，成功后才进入 Dev。

## Dev 与 Tester

- [x] 3. 按设计复核 PR #177/#178/#180/#183/#185 的已合并变更、归档规格、README 和现行 workflow/测试；记录所查文件、覆盖场景及结论。不得把测试补强写成用户功能。
- [x] 4. 对确认的规格内缺陷，由主会话先限定授权文件和回归任务，再实施有界修复；无缺陷则记录无需产品代码修改。范围歧义或超规格问题交主会话决定。
- [x] 5. 将 `package.json`、`package-lock.json` 的根版本和 `packages[""].version`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 中 `music-tag` 自身版本、`src-tauri/tauri.conf.json` 统一为 `0.2.0`；枚举其他实际应用/打包版本声明，避免更改第三方依赖与历史版本。对应场景：Inspect release version。
- [x] 6. 更新 README 版本徽章和 `v0.2.0` 发布说明，准确描述 Cask livecheck/卸载维护改进及全局顶栏文件夹图标入口调整；核对不夸大能力且符合产品实现。对应场景：Read v0.2.0 release notes。
- [x] 7. 主会话审计 Dev 差异与授权路径并记录提交；Tester 核对版本及说明，完成三批变更复核所需的相关既有回归与有界修复测试。存在外部 fixture 时先确认生成工具、命令、产物和 reader 解析；无 fixture 时记录不适用。主会话审计 Tester checkpoint 并保存证据。

## 独立 CR 与 Verify

- [ ] 8. 派发独立只读 CR，覆盖最终差异、PR #177/#178/#180/#183/#185 适用实现、发布场景及设计中的 Cask/UI/发布门禁；记录被审查快照、文件、场景和明确无 blocker/major 结论。问题按授权路径修复、回归并复审，最多三轮。
- [ ] 9. Verify 在最终源码快照核验应用自身版本与 README、执行当前 change 和全量 OpenSpec strict validate、CI 全部适用检查：pipe native suites、Homebrew publisher 测试、pipe self-check、`npm ci`/build/test、Rust stable `check --all-targets`/`test --all-targets`（含 workflow 配置的系统依赖）。按运行时 workflow 条件核对 Node 24、工作目录、安装步骤；逐项保存命令、退出码、验证 HEAD。失败即停，不用本机子集代替远端门禁。
- [ ] 10. 主会话保存 Verify 源码 manifest、命令证据与规格指纹，并核实均对应当前 HEAD；CR/Tester 后若源码改变，重跑受影响验证后才可集成。

## Integrate 与正式发布

- [ ] 11. 主会话按 `archive → commit → sync-main → push → get-or-create-pr → wait-required-ci → merge → verify-remote → cleanup-local` 执行并记录 typed checkpoint；PR 标题/正文关联 Issue #186，正文含 `Closes #186`。每步核对同一 Verify 源码指纹和真实远端状态，required CI 未成功不得合并。
- [ ] 12. 确认合并及 required CI 后，核对远端 main 含版本提交；检查既有 `v0.2.0` tag，核实其指向合并版本 commit；不存在时才创建并推送 tag。禁止覆盖或强推既有 tag。对应场景：Verify public release。
- [ ] 13. 等待并核实 `v0.2.0` 的 Release workflow 全部成功：记录 tag SHA、run URL、test 和四平台 job 结果；确认公开 Release 为 `draft=false`、`prerelease=false`，含 Windows、macOS arm64、macOS x64、Linux 资产，并记录 Release URL、各资产名称和大小。按设计核对/补齐公开 Release 正文为准确版本摘要。
- [ ] 14. 等待并核实该 tag 对应 Homebrew Tap workflow 同步成功，记录 run URL、tag 输入及结果。若自动派发失败，按既有 README 维护流程手动 dispatch 相同 tag 并核对成功 run；失败时保持未完成并报告，不得声称 tap 已同步。

## 完成证据

- npm、Cargo、Tauri 应用版本及 README 徽章为 `0.2.0`，锁文件第三方依赖未被改动；发布说明与已合并行为一致。
- 近期变更复核、适用回归、独立只读 CR、全量 OpenSpec 校验及 CI 适用门禁均有对应快照与命令证据。
- 版本变更已合并且 required CI 成功；远端 `v0.2.0` tag 指向合并版本提交。
- Release workflow 全部成功，GitHub Release 已正式公开并含四平台资产；Homebrew Tap workflow 已同步成功。缺少任何远端实证时，不将发布验收标记完成。
