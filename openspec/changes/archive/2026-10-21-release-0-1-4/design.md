# Design: v0.1.4 release

## 范围与领域

领域为 `docs` + `infra`。本变更复核已经合并的 PR #160 更新检查，统一版本声明，整理 README 发布说明，并执行既有发布流程；不新增产品能力，不修改更新检查契约。适用依据为 `docs/V1-PRD.md` FR-9、验收项 15 与 `docs/design/design.md` §10.3 的更新检查设计。

如复核发现确定的规格内缺陷，主会话先记录问题、授权路径和任务，再按既有架构进行有界修复及回归验证。涉及 Rust 与 Vue 的修复按 Rust service/command → frontend api/store/component 顺序进行。产品行为歧义或超出已批准范围的修改返回主会话决策，不能顺带扩展功能。

## 更新检查复核

对 `v0.1.3` 之后的 PR #160 及其现有测试执行独立只读复核，至少覆盖：

- 启动异步检查、原生帮助菜单检查/关于入口，不阻塞编辑，监听释放正确。
- 分页查询、最高稳定 semver 选择、draft/prerelease/无效 tag 排除，以及当前版本和 build metadata 的比较语义。
- 检查中、最新、发现新版和失败状态；过期请求隔离；失败不改变歌词/封面搜索的会话离线状态。
- 非模态提示、稍后对同版持久抑制与更高版提示、关于界面的当前版本和最近结果。
- 只有用户点击详情才打开固定仓库的 HTTPS Release URL；校验 tag 与 URL 一致，拒绝凭据、其他 host/path、query/fragment；无自动下载或安装。

重点路径为 `src-tauri/src/service/update.rs`、`commands/update.rs`、`lib.rs`、capability 与 `src/api/updates.ts`、`store/updates.ts`、`App.vue`、更新提示及关于组件。复用 `src-tauri/tests/update_tests.rs` 和 co-located api/store/UI 测试；网络与 opener 必须由测试注入，不访问真实 GitHub 或启动浏览器。无缺陷时记录明确的无 blocker/major 结论，不为版本字段或文案增加镜像实现的测试。确认缺陷的修复必须有针对该行为的回归检查并独立复审。

## 版本与发布说明

以实际文件中的应用自身版本为准，统一为 `0.1.4`：

| 声明 | 修改位置 |
|---|---|
| npm | `package.json` 根版本；`package-lock.json` 根版本和 `packages[""].version` |
| Cargo | `src-tauri/Cargo.toml` 的 `[package].version`；`src-tauri/Cargo.lock` 中 `music-tag` 包版本 |
| Tauri | `src-tauri/tauri.conf.json` 的 `version` |
| README | 版本徽章及当前 `v0.1.4` 发布说明 |

枚举时核对是否还有实际应用/打包版本声明；第三方依赖版本、历史发布记录和 OpenSpec 归档不作全局替换。运行时当前版本分别来自 Tauri `getVersion()` 与 Rust `CARGO_PKG_VERSION`，版本元数据一致性验证应覆盖它们的来源。

README 发布说明准确描述稳定版更新检查、帮助菜单与关于入口、用户主动查看 Release 详情的流程，可简洁说明 Echo 推荐及 nanoid 依赖修复；不能声称具备自动下载安装能力。现有 Echo 推荐正文保留有效链接。GitHub draft Release 的说明应复用此版本摘要，不仅保留 workflow 的通用占位文案。

## 规格场景与门禁映射

| 规格场景 | 设计依据与验证 | 流水线门禁 |
|---|---|---|
| Inspect release version | 按上表读取应用版本和锁文件自身包条目，检查 README 徽章均为 `0.1.4` | Dev、Tester、CR、Verify |
| Read v0.1.4 release notes | 对照 `v0.1.3..HEAD` 的实际提交与 FR-9，人工核对更新说明、手动打开详情及无自动安装表述 | Dev、Tester、CR、Verify |
| Verify tag-triggered release | 先完成合并与 required CI，再核对 tag 指向已合并版本提交、Release workflow 与 draft 及平台产物 | Integrate 后发布核对 |

Architect 后由主会话执行 spec-gate preflight 和本变更 strict validate。Tester 完成上述版本/文案检查、更新行为的现有相关回归及 fixture 早检。之后派发独立只读 CR，审查最终差异及 PR #160 适用行为，记录场景、文件、严重级别和证据；检查状态竞态、跨模块串扰、网络/离线语义，未发现问题须明确无 blocker/major。所有确认缺陷修复重新经过 Tester 与独立 CR，遵守三轮上限。

Verify 对最终源码快照执行 `.github/workflows/ci.yml` 所有适用检查，并逐项保留退出码、验证 HEAD、源码指纹和规格指纹：

- `npx --yes @fission-ai/openspec@1.5.0 validate --all --strict --no-interactive`，另执行本变更 strict validate。
- `node --test '.agents/tools/pipe-core/test/*.test.js' 'tests/workflow-core/*.test.cjs' '.agents/tools/pipe-native/test/*.test.js'`。
- `node .agents/tools/pipe-native/self-check.js`。
- `npm ci`、`npm run build`、`npm run test`。
- `cargo check --manifest-path src-tauri/Cargo.toml --all-targets`、`cargo test --manifest-path src-tauri/Cargo.toml --all-targets`。

本仓库存在 npm 与 Cargo 清单，相关 workflow 条件均适用。CI 使用 Node 24、Rust stable；Linux job 安装 ffmpeg、WebKitGTK 4.1 等 workflow 列明依赖。测试使用外部程序生成 fixture 时，先确认工具、生成成功、文件存在及 reader 可解析，再进入业务断言；本次版本/文案变更无需新 fixture。主会话保留 CI 验证矩阵、完整 source manifest 与命令证据，不能用本机可运行的子集替代远端 Linux 门禁。

## 集成与发布时序

1. Verify 成功后，主会话依次记录 `archive → commit → sync-main → push → get-or-create-pr → wait-required-ci → merge → verify-remote → cleanup-local`。每个 checkpoint 重新核对源码指纹；归档只移动 OpenSpec，不修改已验证源码。PR 使用 `Closes #165`。
2. 确认远端 PR 已合并、required CI 成功，远端 main 包含本次版本与说明，再在相应已合并提交上创建并推送 `v0.1.4` tag。若 tag/Release 已存在，先核对对象与状态；不得覆盖或强推已有 tag。
3. 使用现有 `.github/workflows/release.yml`：tag `v*` 触发 `test`，成功后执行 `publish-tauri` 四项矩阵：Windows、macOS arm64、macOS x64、Linux。Tauri action 由版本生成 `v__VERSION__`，配置 `releaseDraft: true`、`prerelease: false`；无需另建发布 workflow。
4. 等待并核对本次 tag 的 workflow 全部结论为 success；核对 draft Release 的 tag、标题、非预发布状态、版本说明及四平台产物，记录 run URL、tag SHA、Release URL、资产名称和大小。保留 draft 状态。本规格验收至 draft 构建核对，不将创建 tag 或出现 draft 等同于发布成功。

如构建失败，记录具体 job/log 和缺失产物，有界处理已批准范围内的问题并遵守补充 CR/Verify 规则；不删除已有发布物或强改 tag 来掩盖失败。未完成远端证据前保留发布任务待完成，并如实报告。

## 文件所有权与风险

Architect 仅写本变更 `design.md`、`tasks.md`；Dev 的常规写入范围是上述六个版本/说明文件。测试和生产代码仅在主会话为已确认缺陷单独授权后写入。主会话唯一维护任务勾选、progress 与 Git/远端状态；CR/Verify 只读。

主要风险是误替换依赖版本、声明漏改、已有更新检查的异步边界，以及 tag 早于合并/required CI。通过结构化读取自身版本、针对 FR-9 的独立审查、最终快照验证和远端时序证据控制。跨平台安装包能否实际启动不由 CI 构建成功证明；如未进行安装运行检查，最终报告明确其未验证状态。
