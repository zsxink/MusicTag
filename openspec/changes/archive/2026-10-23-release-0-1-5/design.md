# Design: v0.1.5 release

## 范围与领域

领域为 `docs` + `infra`。本变更复核 `v0.1.4..HEAD` 已合并的三批变更——PR #169 Homebrew tap 安装渠道（`5d27335`）、PR #171 原生应用菜单与更新检查节流（`89bd98b`）、PR #172 发行前合规整改（`a2b3010`），统一版本声明至 `0.1.5`，整理 README 发布说明，并执行既有 tag-triggered 发布流程；不新增产品能力，不扩展自动下载或安装更新能力，不调整与发布无关的流程。适用依据为 `docs/V1-PRD.md` FR-9（应用菜单与更新检查）、FR-10（发行前合规与数据披露）、`docs/design/design.md` §10.3（`get_last_update_check_at` / `save_last_update_check_at` / `sync_menu_state` command 契约）与现行 capability specs `update-check`、`app-menu`、`homebrew-release`、`compliance-disclosure`、`search-sources`、`pre-release-check`。

如复核发现确定的规格内缺陷，主会话先记录问题、授权路径和任务，再按既有架构进行有界修复及回归验证。涉及 Rust 与 Vue 的修复按 Rust service/command → frontend api/store/component 顺序进行。产品行为歧义或超出已批准范围的修改返回主会话决策，不能顺带扩展功能。

## 三批复核边界

对 `v0.1.4..HEAD` 的三批变更及现有测试执行独立只读复核。`git log v0.1.4..HEAD --oneline` 恰为三批变更加本次范围批准提交（`cc3039e`），复核基线即当前分支 HEAD。

**PR #169 Homebrew tap 渠道**，对照 `homebrew-release` capability spec：

- `scripts/homebrew-publish.sh` 仅接受已发布且含两个 macOS DMG 资产的稳定 Release，按架构匹配资产并计算 SHA-256；draft 或资产缺失时不产生指向不可用 Release 的 Cask 条目。
- `.github/workflows/homebrew.yml` 由 release `published` 事件（或手动 dispatch 传入稳定 tag）触发；同步代码取自默认分支，`HOMEBREW_TAP_TOKEN` 仅要求对 tap 仓库的 Contents: read and write，并发组不取消进行中的同步。
- `tests/homebrew/publish.test.mjs` 覆盖 Release 校验与 Cask 渲染逻辑；README「macOS Homebrew 安装」及维护者发布说明与实际机制一致。

**PR #171 原生应用菜单与更新检查节流**，对照 FR-9 与 `update-check`/`app-menu` specs：

- 启动时仅在无成功检查时间或距上次成功至少 7×24 小时时异步检查；成功时间以 UTC RFC3339 持久化到 config.json，网络失败不更新；无效、缺失或未来时间视为未检查。帮助菜单「检查更新…」不受间隔限制，成功结果写入时间。
- 原生 File/Edit/View/Help 菜单三端齐备；WebView 可消费 action ID 与 §10.3 契约一致，`sync_menu_state` 快照同步，未知/重复 ID 报错且不改变已有状态；菜单动作按 EULA、当前歌曲和 dirty 状态启用或禁用，事件分发时重新复核；macOS 保留系统应用菜单且 About 经 EULA guard。
- 检查中、最新、发现新版、失败状态反馈明确；请求序号隔离过期结果；失败不改变歌词/封面搜索的会话离线状态。非模态提示 15 秒（发现新版）/5 秒（已是最新）自动关闭、错误仅手动关闭，关闭不清除结果，顶栏品牌与路径间的无障碍小红点可恢复提示；「稍后」持久抑制同版、更高版仍提示；只有用户主动打开固定仓库的 HTTPS Release URL，无自动下载或安装。
- 重点路径为 `src-tauri/src/commands/menu.rs`、`commands/update.rs`、`lib.rs`、`service/config.rs` 与 `src/api/updates.ts`、`src/store/updates.ts`、`App.vue`、`AppBar.vue`、`UpdateToast.vue`；复用 `src-tauri/tests/menu_action_tests.rs`、`menu_config_tests.rs` 与 co-located api/store/UI 测试。网络与 opener 必须由测试注入，不访问真实 GitHub 或启动浏览器。

**PR #172 发行前合规整改**，对照 FR-10 与 `compliance-disclosure`/`search-sources` specs：

- LICENSE 采用 MusicTag Personal Learning License，与 README 协议章节、EULA 弹窗零矛盾，不再出现 Business Source License 1.1 表述。
- README「外部 API 声明」披露发送字段、接收方域名、触发时机、不发送音频内容与本地路径、超时与会话离线降级；EULA 弹窗协议要点含数据披露一条。
- `docs/compliance/search-sources.md` 逐源记录域名与调用方式、发送字段、用途边界、公开条款链接与核实状态；未决事项单列且不表述为已完成或已获授权。
- `THIRD-PARTY-NOTICES.md` 由 `scripts/generate-third-party-notices.mjs` 生成（仅 Node 内置能力 + `cargo metadata`，不新增依赖），生成幂等，经 tauri bundle resources 随安装包分发，覆盖 Cargo 依赖闭包、npm 运行时与构建工具链及内嵌素材。
- 五源生产请求全部 HTTPS，代码无明文 `http://` 生产端点，响应内派生资源 URL 升级后再使用；复用 `src-tauri/tests/searcher_https_tests.rs` 与各 searcher 测试。

复核逐批记录文件、场景与结论；无缺陷时记录明确的无 blocker/major 结论，不为版本字段或文案增加镜像实现的测试。确认缺陷的修复必须有针对该行为的回归检查并独立复审。

## 版本与发布说明

以实际文件中的应用自身版本为准，统一为 `0.1.5`：

| 声明 | 修改位置 |
|---|---|
| npm | `package.json` 根版本；`package-lock.json` 根版本和 `packages[""].version` |
| Cargo | `src-tauri/Cargo.toml` 的 `[package].version`；`src-tauri/Cargo.lock` 中 `music-tag` 包版本 |
| Tauri | `src-tauri/tauri.conf.json` 的 `version` |
| README | 版本徽章及当前 `v0.1.5` 发布说明 |

枚举时核对是否还有实际应用/打包版本声明；第三方依赖版本、历史发布记录（如 `v0.1.4 更新` 小节）与 OpenSpec 归档不作全局替换。README 维护者小节中的 `v0.1.4` tag/资产名属说明性示例，不在强制替换清单内。运行时当前版本分别来自 Tauri `getVersion()` 与 Rust `CARGO_PKG_VERSION`，版本元数据一致性验证应覆盖它们的来源。

README 发布说明新增 `v0.1.5 更新` 小节，准确概括 Homebrew 安装渠道（`brew install zsxink/tap/musictag`，Release 发布且 tap 同步成功后可升级）、三端原生应用菜单与帮助菜单入口、更新检查节流（距上次成功检查至少 7×24 小时才自动检查、手动检查不受限）与合规整改（个人学习许可、外部 API 数据披露、第三方归属清单、传输加密）；不能声称具备自动下载安装能力。旧版说明的取舍沿用现行结构（当前仅保留最近两版）。推荐 Echo 的正文与链接保留有效。GitHub draft Release 的说明应复用此版本摘要，不仅保留 workflow 的通用占位文案（`releaseBody: 'MusicTag 发布'`）。

## 规格场景与门禁映射

| 规格场景 | 设计依据与验证 | 流水线门禁 |
|---|---|---|
| Inspect release version | 按上表读取应用版本和锁文件自身包条目，检查 README 徽章均为 `0.1.5` | Dev、Tester、CR、Verify |
| Read v0.1.5 release notes | 对照 `v0.1.4..HEAD` 的实际提交与 FR-9/FR-10、`homebrew-release` spec，人工核对 Homebrew 渠道、原生菜单、节流与合规表述及无自动安装声称 | Dev、Tester、CR、Verify |
| Verify tag-triggered release | 先完成合并与 required CI，再核对 tag 指向已合并版本提交、Release workflow 与 draft 及四平台产物 | Integrate 后发布核对 |

Architect 后由主会话执行 spec-gate preflight 和本变更 strict validate。Tester 完成上述版本/文案检查、三批复核中确认修改项的回归及 fixture 早检；本变更不新增 fixture 时明确记录。之后派发独立只读 CR，审查最终差异及三批变更适用行为，记录场景、文件、严重级别和证据；检查状态竞态、跨模块串扰、网络/离线语义，未发现问题须明确无 blocker/major。所有确认缺陷修复重新经过 Tester 与独立 CR，遵守三轮上限。

Verify 对最终源码快照执行 `.github/workflows/ci.yml` 所有适用检查，并逐项保留退出码、验证 HEAD、源码指纹和规格指纹：

- `npx --yes @fission-ai/openspec@1.5.0 validate --all --strict --no-interactive`，另执行本变更 strict validate。
- `node --test '.agents/tools/pipe-core/test/*.test.js' 'tests/workflow-core/*.test.cjs' '.agents/tools/pipe-native/test/*.test.js'`。
- `node --test tests/homebrew/publish.test.mjs`（#169 新增的 CI 步骤）。
- `node .agents/tools/pipe-native/self-check.js`。
- `npm ci`、`npm run build`、`npm run test`。
- `cargo check --manifest-path src-tauri/Cargo.toml --all-targets`、`cargo test --manifest-path src-tauri/Cargo.toml --all-targets`。

本仓库存在 npm 与 Cargo 清单，相关 workflow 条件均适用。CI 使用 Node 24、Rust stable；Linux job 安装 ffmpeg、WebKitGTK 4.1 等 workflow 列明依赖。测试使用外部程序生成 fixture 时，先确认工具、生成成功、文件存在及 reader 可解析，再进入业务断言。主会话保留 CI 验证矩阵、完整 source manifest 与命令证据，不能用本机可运行的子集替代远端 Linux 门禁。

## 集成与发布时序

1. Verify 成功后，主会话依次记录 `archive → commit → sync-main → push → get-or-create-pr → wait-required-ci → merge → verify-remote → cleanup-local`。每个 checkpoint 重新核对源码指纹；归档只移动 OpenSpec，不修改已验证源码。PR 使用 `Closes #173`。
2. 确认远端 PR 已合并、required CI 成功，远端 main 包含本次版本与说明，再在相应已合并提交上创建并推送 `v0.1.5` tag。若 tag/Release 已存在，先核对对象与状态；不得覆盖或强推已有 tag。
3. 使用现有 `.github/workflows/release.yml`：tag `v*` 触发 `test`（含 pipe 原生测试、Homebrew publisher 测试、self-check、npm 与 Rust 检查），成功后执行 `publish-tauri` 四项矩阵：Windows、macOS arm64、macOS x64、Linux。Tauri action 由版本生成 `v__VERSION__`，配置 `releaseDraft: true`、`prerelease: false`；无需另建发布 workflow。
4. 等待并核对本次 tag 的 workflow 全部结论为 success；核对 draft Release 的 tag、标题、非预发布状态、版本说明及四平台产物，记录 run URL、tag SHA、Release URL、资产名称和大小。保留 draft 状态。`.github/workflows/homebrew.yml` 由 release `published` 事件触发，维护者手动发布 draft 才会同步 tap：该事件与 tap 同步结果均在本变更验收边界之外，不得为验证 tap 而发布 Release。本规格验收至 draft 构建核对，不将创建 tag 或出现 draft 等同于发布成功。

如构建失败，记录具体 job/log 和缺失产物，有界处理已批准范围内的问题并遵守补充 CR/Verify 规则；不删除已有发布物或强改 tag 来掩盖失败。未完成远端证据前保留发布任务待完成，并如实报告。

## 文件所有权与风险

Architect 仅写本变更 `design.md`、`tasks.md`；Dev 的常规写入范围是上述六个版本/说明文件。测试和生产代码仅在主会话为已确认缺陷单独授权后写入。主会话唯一维护任务勾选、progress 与 Git/远端状态；CR/Verify 只读。

主要风险是误替换依赖版本（`package-lock.json`/`Cargo.lock` 中大量第三方条目）、声明漏改、三批复核遗漏跨模块边界（菜单动作与编辑态、节流时间与搜索离线状态、合规文案与 LICENSE/EULA 一致性），以及 tag 早于合并/required CI。通过结构化读取自身版本、对照 FR-9/FR-10 与 capability specs 的独立审查、最终快照验证和远端时序证据控制。跨平台安装包能否实际启动不由 CI 构建成功证明；Homebrew tap 同步与实际安装不在本次验收边界内，如未进行安装运行检查，最终报告明确其未验证状态。
