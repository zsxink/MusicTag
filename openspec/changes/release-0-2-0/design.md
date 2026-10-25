# Design: v0.2.0 release

## 范围与领域

领域为 `docs` + `infra`。本变更复核 `v0.1.5..HEAD` 的已合并内容，统一应用版本声明为 `0.2.0`，更新 README 当前版本和发布说明，并在版本提交合并后使用现有 tag-triggered workflow 发布。范围依据 Issue #186 与本 change 的 proposal/spec；不新增产品能力、不改变发布工作流实现、不调整无关行为。

基线提交为 `8babefd`，发布基线是 `v0.1.5`。审查提交包括：PR #177 的 Release 构建成功后自动发布及显式派发 Homebrew Tap workflow；PR #178 的 Cask `livecheck` 与卸载清理段；PR #180 的显式 `releases/latest` livecheck URL；PR #183 将打开文件夹入口移至全局顶栏紧凑图标并保留无障碍名称、提示和快捷键；PR #185 仅补强文件夹图标测试断言。只复核用户可见行为、发布说明和发布链路，不把测试补强描述为用户功能。

如独立复核发现已批准规格内的确定缺陷，由主会话先明确授权路径与回归任务，再进行有界修复和复审；涉及产品范围或规格歧义时停止并交主会话决策，不自行扩展。

## 已合并变更复核

对照当前实现、README、OpenSpec 归档和相关 workflow，逐项记录文件、规格场景、现有测试和结论：

- **PR #177 自动发布**：复核 `.github/workflows/release.yml` 的 `test → publish-tauri → publish-release` 依赖、四平台 matrix、只有所有构建成功才将 draft 转正式发布的门槛、失败保留 draft 的行为，以及成功后通过 `workflow_dispatch` 派发 tap 同步。复核说明与当前发布流程一致，重复运行的幂等保护不被移除。
- **PR #178/#180 Cask 维护**：复核 `scripts/homebrew-publish.sh` 生成的 Cask `livecheck` 显式指向 `releases/latest`，并包含卸载清理段；对照 `.github/workflows/homebrew.yml` 和 `tests/homebrew/publish.test.mjs`，确认自动/手动触发及 Release/tag 校验与描述相符。README 只概括维护改进，不承诺额外安装或升级能力。
- **PR #183 文件夹入口**：对照 `docs/V1-PRD.md`、`docs/design/design.md`、`src/components/AppBar.vue`、`SongList.vue` 及相关组件测试，确认入口在顶栏显示为紧凑图标，具有“打开文件夹”无障碍名称和提示，快捷键及既有目录切换拦截仍适用；不再显示路径或在侧栏显示入口。
- **PR #185 测试补强**：检查相关验证确实断言 SVG 图标存在；发布说明不将其列为用户可见功能。

本复核不预设结论。Tester/CR 应报告实际核查的提交、文件、场景及任何发现；无 blocker/major 时明确记录结论。

## 版本元数据与 README

把应用自身版本声明统一到 `0.2.0`：

| 声明 | 位置 |
|---|---|
| npm | `package.json` 根版本；`package-lock.json` 根版本和 `packages[""].version` |
| Cargo | `src-tauri/Cargo.toml` 的 package 版本；`src-tauri/Cargo.lock` 中 `music-tag` 包自身版本 |
| Tauri | `src-tauri/tauri.conf.json` 的 version |
| README | 版本徽章和当前 `v0.2.0` 发布说明 |

Dev 应枚举实际应用/打包版本声明并核实一致性；不得全局替换第三方依赖版本、历史版本记录、维护者段落中的示例 tag/资产名或其他无关文案。运行时版本来源应保持与 Tauri `getVersion()` 和 Rust `CARGO_PKG_VERSION` 对应。

README 当前发布说明应准确概括 `v0.1.5` 后的用户可见变化：Cask 的版本检查与卸载清理维护改进，以及全局顶栏文件夹图标入口调整。若提及更新入口，准确说明无障碍名称/提示及快捷键仍可用；不把 PR #177/#185 的自动化和测试变化写成应用功能。保留适用的旧版本说明和项目现有 README 结构。正式 GitHub Release 使用自动生成的通用说明时，Integrate 应在发布后核对并将 Release 正文补为与 README 对齐的简短版本说明；不得为此改动 `.github/workflows/release.yml`。

## 验证矩阵

| 场景 | 检查 | 阶段 |
|---|---|---|
| Inspect release version | 检查 npm、Cargo、Tauri、lockfile 中应用自身条目和 README 徽章均为 `0.2.0`，第三方依赖版本未被改动 | Dev / Tester / CR / Verify |
| Read v0.2.0 release notes | 对照 `v0.1.5..HEAD` 提交、README、PRD 和 Cask/UI 实现，核实表述范围及准确性 | Dev / Tester / CR / Verify |
| Review shipped changes | 对 PR #177/#178/#180/#183/#185 的相关实现、归档规格、workflow 与已有回归进行独立复核 | Tester / CR |
| Verify public release | 合并后 tag 指向已合并版本提交；Release workflow 四个平台成功；公开 Release 正式发布并含四平台资产；Homebrew Tap workflow 同步成功 | Integrate |

## CI 与验证门禁

Verify 读取当时的 `.github/workflows/ci.yml`、受影响 workflow，并按 job 条件、runner、工作目录、版本、安装步骤运行全部适用检查。当前 CI 的 `validate` job 对本仓库实际适用的命令包括：

- `npx --yes @fission-ai/openspec@1.5.0 validate --all --strict --no-interactive`（另运行当前 change strict validate）。
- `node --test '.agents/tools/pipe-core/test/*.test.js' 'tests/workflow-core/*.test.cjs' '.agents/tools/pipe-native/test/*.test.js'`。
- `node --test tests/homebrew/publish.test.mjs` 与 `node .agents/tools/pipe-native/self-check.js`。
- `npm ci`、`npm run build`、`npm run test`。
- Linux workflow 安装所需 Tauri 系统依赖（包括 `ffmpeg`），Rust stable 下运行 `cargo check --all-targets` 与 `cargo test --all-targets`，工作目录为 `src-tauri`。

CI 使用 Node 24；具体命令和条件以验证时 workflow 为准。release workflow 的 tag 触发 `test` 使用同一组相关命令，后续 `publish-tauri` 构建 Windows、macOS aarch64、macOS x86_64、Ubuntu Linux。Verify 对代码快照的命令记录退出码、HEAD、源码指纹和规格指纹；所有适用检查失败即停止集成，不以未运行的命令或排队中的 CI 声称通过。版本文案本身采用结构化读取和人工对照验证，不为纯版本字段镜像实现增加无关测试。

本 change 不引入 fixture。若复核到的既有测试使用外部生成 fixture，遵循 pipe 的 fixture 早检要求，并记录生成命令、所需工具、目标文件存在性与目标 reader 可解析证据；具体是否适用由 Tester 核实。

## 集成与发布顺序

主会话在 Verify 成功后按 pipe 顺序执行 `archive → commit → sync-main → push → get-or-create-pr → wait-required-ci → merge → verify-remote → cleanup-local`。PR 正文使用 `Closes #186`。每个 checkpoint 先核对事实，绑定同一 Verify 源码指纹；源码变化使 Verify 失效。不得在版本变更合并和 required CI 成功之前推 tag。

合并后执行发布门禁：

1. 核实远端 main 已包含版本提交、PR 已合并且 required CI 成功；检查 `v0.2.0` tag/Release 是否已存在。tag 已存在时核实其 commit SHA，不覆盖、不强推、不移动既有 tag；不存在则在已合并版本提交创建并推送 `v0.2.0`。
2. 等待本 tag 对应的 `.github/workflows/release.yml` 所有 job 结束并成功，核对 run URL、tag SHA、`test` 结果及 Windows、macOS arm64、macOS x64、Linux 构建/上传成功。
3. 核对 GitHub Release 已为公开正式发布（`draft=false`、`prerelease=false`），tag/标题正确，含四平台资产；记录 Release URL、资产名称与大小。自动发布发生前不要手动发布 draft；现行 workflow 会在所有构建成功后自动发布并派发 Homebrew Tap workflow。
4. 将公开 Release 正文核对并补齐为准确的 v0.2.0 摘要，保持与 README 内容一致；核实更新后的 Release 正文及公开状态。
5. 等待并核实该 tag 对应的 `.github/workflows/homebrew.yml` run 成功，记录 run URL、输入 tag 与 tap 同步结果。只允许使用现有 workflow；若自动派发失败，在范围内按 README 维护说明手动 dispatch 相同 tag 重试，并核对最终成功 run。

发布场景只有在远端 Release 正式公开、四平台资产齐备且 Homebrew tap 同步成功后才通过。tag、Release workflow、Release 页面或 tap workflow 任一事实缺少或失败时保留任务待完成，报告实际状态和证据；不把本地构建或 workflow queued 声称为公开发布完成。跨平台安装包实际启动/安装不由构建成功证明，除非另有实测，不宣称完成该检查。

## 权限与风险

Architect 仅写本 change 的 `design.md` 与 `tasks.md`；Dev 的版本/README 写入范围限于上表中的应用元数据、锁文件自身版本和 README。发布后 Release 编辑仅由主会话在 Integrate 阶段操作。Tester、CR、Verify 不得写入实现；CR 与 Verify 只读。主会话唯一维护 tasks 勾选、progress、Git 与远端发布状态。

主要风险是误改第三方锁版本、漏掉实际应用版本源、README 与应用行为不一致、错误 tag 指向、将 draft 或构建完成误判为公开发布，以及将 Homebrew workflow 派发误判为同步成功。通过精确版本字段核对、已有 workflow 条件审查、tag SHA 和各远端状态核验控制风险。
