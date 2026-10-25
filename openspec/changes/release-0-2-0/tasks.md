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

- [x] 8. Dev 按 CR major 的唯一批准修复，在 `.github/workflows/release.yml` 的 `publish-release` job-level `env` 增加 `GH_REPO: ${{ github.repository }}`；只在 `tests/workflow-core/release-publish-contract.test.cjs` 增加对该 job context 的契约断言。不得改触发、matrix、权限、发布顺序、Homebrew workflow 或其他测试契约。
- [x] 9. Dev 修正文 README v0.2.0 Cask 描述，区分普通 `uninstall`（退出应用）与用户选择 `zap`（清理列明的应用数据目录）；不得称普通卸载会清理数据。范围对应 PR #178/#180 的既有 Cask 模板。
- [x] 10. 主会话审计第二轮 Dev 授权路径与 diff；Tester 核实 `GH_REPO` 确实来自 `${{ github.repository }}`、新增契约断言锁定 job-level env 且未放宽/改变旧发布契约，并验证 README 的普通卸载/zap 描述。运行 `node --test tests/workflow-core/release-publish-contract.test.cjs` 和相关 Homebrew publisher 回归；再运行 CI 与 release workflow 中 workflow-core suite 的完整命令，保留退出码与 HEAD。无 fixture 变更；如发现使用外部 fixture 的既有测试，按 fixture 早检要求先行检查。
- [x] 11. round 2 CR 为独立只读审查，核对唯一允许的 workflow/test 修改、变量值/作用域，以及 README 语义；同时复核 PR #177/#178/#180/#183/#185 相关实现和先前 CR findings。逐项检查全部 `.github/workflows/ci.yml` 与 `.github/workflows/release.yml` 验证门禁、job 依赖/条件及四平台矩阵未被改变；记录快照、文件、测试/门禁证据和明确无 blocker/major 结论。发现问题回到授权路径修复、Tester 回归并重新 CR，不越过三轮限制。
- [ ] 12. Verify 在最终源码快照核验版本与 README，执行当前 change 和全量 OpenSpec strict validate、CI 所有适用检查：三组 pipe native suites（必须包含新增 release publish contract）、Homebrew publisher 测试、pipe self-check、`npm ci`/build/test、Rust stable `check --all-targets`/`test --all-targets`（含 workflow 配置的系统依赖）。按 workflow 条件核对 Node 24、工作目录与安装步骤；逐项保存命令、退出码、验证 HEAD。失败即停，不以单测或本机子集替代 CI 门禁。
- [ ] 13. Verify 只读核对 `.github/workflows/release.yml` 的 tag trigger、test 门禁、publish-tauri 四项 matrix、`publish-release` 对 `publish-tauri` 的依赖和权限保持原样；确认仅增加 `GH_REPO` job env 且新增断言覆盖该值。主会话保存 Verify 源码 manifest、命令证据与规格指纹并核对对应当前 HEAD；CR/Tester 后若源码变化，受影响验证重跑后才可集成。

## Integrate 与正式发布

- [ ] 14. 主会话按 `archive → commit → sync-main → push → get-or-create-pr → wait-required-ci → merge → verify-remote → cleanup-local` 执行并记录 typed checkpoint；PR 标题/正文关联 Issue #186，正文含 `Closes #186`。每步核对同一 Verify 源码指纹和真实远端状态，required CI 未成功不得合并。
- [ ] 15. 确认合并及 required CI 后，核对远端 main 含版本提交；检查既有 `v0.2.0` tag，核实其指向合并版本 commit；不存在时才创建并推送 tag。禁止覆盖或强推既有 tag。对应场景：Verify public release。
- [ ] 16. 等待并核实 `v0.2.0` 的 Release workflow 全部成功：记录 tag SHA、run URL、test 与四平台 job 结果，并确认 `publish-release` 命令在无 checkout runner 成功定位仓库；确认公开 Release 为 `draft=false`、`prerelease=false`，含 Windows、macOS arm64、macOS x64、Linux 资产，记录 Release URL、各资产名称和大小。按设计核对/补齐公开 Release 正文为准确版本摘要。
- [ ] 17. 等待并核实该 tag 对应 Homebrew Tap workflow 同步成功，记录 run URL、tag 输入及结果。若自动派发失败，按既有 README 维护流程手动 dispatch 相同 tag 并核对成功 run；失败时保持未完成并报告，不得声称 tap 已同步。

## 完成证据

- npm、Cargo、Tauri 应用版本及 README 徽章为 `0.2.0`，锁文件第三方依赖未被改动；发布说明与已合并行为一致。
- README 准确区分 Homebrew 普通卸载和 `zap` 的数据清理行为。
- `publish-release` 仅新增 job-level `GH_REPO: ${{ github.repository }}`，唯一新增测试断言覆盖该契约；发布触发、matrix、权限、控制流、顺序与 Homebrew workflow 保持批准基线。
- 近期变更复核、Tester 回归、round 2 独立只读 CR、全量 OpenSpec 校验及 CI/Release workflow 适用门禁均有对应快照与命令证据。
- 版本变更已合并且 required CI 成功；远端 `v0.2.0` tag 指向合并版本提交。
- Release workflow 全部成功，GitHub Release 已正式公开并含四平台资产；Homebrew Tap workflow 已同步成功。缺少任何远端实证时，不将发布验收标记完成。
