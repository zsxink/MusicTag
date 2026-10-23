# Tasks: v0.1.5 release

## 规格与基线

- [x] 1. 主会话核对 Issue #173、同名分支/工作区、`v0.1.4..HEAD` 提交与 PR #169/#171/#172 基线；记录实际版本声明、README 发布说明和 CI/release/homebrew workflow 条件清单。
- [x] 2. Architect 交付设计与任务后，主会话执行 spec-gate preflight 和 `npx --yes @fission-ai/openspec@1.5.0 validate release-0-1-5 --strict --no-interactive`，记录成功证据后进入 Dev。

## Dev 与 Tester

- [x] 3. 对照 PRD FR-9/FR-10、技术设计 §10.3 与现行 capability specs，复核 PR #169、#171、#172 三批变更及现有测试：#169 的 `homebrew-publish.sh` 校验、tap 同步时序与 `tests/homebrew/publish.test.mjs`；#171 的 7×24 小时节流与持久化、原生菜单动作与状态同步、非模态提示与稍后抑制、URL 校验与显式打开；#172 的 LICENSE 自洽、数据披露、EULA 要点、逐源合规记录、第三方归属清单与全源 HTTPS。记录复核文件、场景和结论。
- [x] 4. 对确认的规格内缺陷，由主会话先明确任务和路径再实施有界修复及必要回归测试；无缺陷则记录无需生产代码修改。涉及双方时按 Rust → Vue 顺序完成，不扩大产品范围。
- [x] 5. 将 `package.json`、`package-lock.json` 自身版本、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 的 `music-tag` 版本、`src-tauri/tauri.conf.json` 统一为 `0.1.5`；枚举并核对其他实际应用/打包版本声明，不替换第三方依赖、历史版本或维护者示例。对应场景：Inspect release version。
- [x] 6. 更新 README 版本徽章与 `v0.1.5` 发布说明，准确概括 `v0.1.4` 之后 Homebrew 安装渠道、原生应用菜单、更新检查节流与合规整改；核对 Echo 链接，不声称自动下载安装。对应场景：Read v0.1.5 release notes。
- [x] 7. 主会话审计 Dev 授权路径与差异、提交并记录 SHA；Tester 核对版本/锁文件自身条目和发布说明，运行三批复核涉及的现有相关回归及有界修复的针对性测试。fixture 需外部生成时先查工具、生成命令、文件存在与 reader 可解析；无新增 fixture 时明确记录。Tester checkpoint 由主会话审计、提交并记证据。

## 独立 CR 与 Verify

- [x] 8. 派发独立只读 CR，覆盖最终差异与 PR #169/#171/#172 适用行为、两项规格场景和设计中的节流/离线/菜单/URL/合规边界；记录被审查快照、文件、场景及明确无 blocker/major 结论。发现问题则在授权范围修复、Tester 回归并独立复审，最多三轮，不绕过门禁。
- [x] 9. Verify 在最终源码快照核对全部版本均为 `0.1.5`、README 与实际提交一致，执行当前变更和 `--all` OpenSpec strict validate、三组 pipe 原生测试、Homebrew publisher 测试、self-check、`npm ci`、前端 build/test、Rust `check --all-targets` / `test --all-targets`。记录 workflow 条件、Node/Rust/系统及 fixture 依赖、逐命令退出码和验证 HEAD，不以本机子集代替远端必需检查。
- [x] 10. 主会话保存 Verify 完整源码 manifest 与命令证据，确认其源码/规格指纹对应当前 HEAD；CR/Tester 后新增差异使旧 Verify 失效，重新完成受影响门禁后才集成。

## Integrate 与 tag 发布

- [ ] 11. 主会话按 `archive → commit → sync-main → push → get-or-create-pr → wait-required-ci → merge → verify-remote → cleanup-local` 顺序执行并记录 typed checkpoint；PR 使用 `Closes #173`，每步核对 Verify 源码指纹及实际远端事实，required CI 未通过不得合并。
- [ ] 12. 确认 PR 已远端合并、required CI 成功且版本提交可从 main 到达后，核对无冲突已有 tag/Release，在已合并版本提交上创建并推送 `v0.1.5`；已有对象则核实复用，不覆盖或强推。对应场景：Verify tag-triggered release。
- [ ] 13. 等待现有 Release workflow 的 `test` 与四项 `publish-tauri` 矩阵成功，核对 tag SHA、run URL、draft Release URL/标题/版本说明、`draft=true`、`prerelease=false` 与 Windows/macOS arm64/macOS x64/Linux 资产名称和大小；补全版本说明并保留 draft，主会话记录远端发布证据后完成任务。Homebrew tap 同步由 Release 发布事件另行触发，不在本变更验收边界内，不得为验证 tap 而发布 draft。未成功或缺产物时保留待完成并报告具体失败。

## 完成证据

- 三个 release 规格场景均有可追溯的命令、人工复核或远端证据。
- PR #169/#171/#172 独立 CR 无 blocker/major；任何修复有针对性回归和独立复审。
- 所有应用版本、锁文件自身条目及 README 徽章为 `0.1.5`，发布说明不暗示自动安装。
- 当前快照的 OpenSpec、CI 对齐验证与远端 required checks 全部成功；Verify 指纹贯穿集成。
- 合并后 `v0.1.5` tag 的 Release workflow 与四平台 draft 构建核对完成；没有证据不宣称发布成功，tap 同步与实际安装运行未验证则明确报告。
