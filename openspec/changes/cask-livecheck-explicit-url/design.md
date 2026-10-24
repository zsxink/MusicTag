# Design: cask-livecheck-explicit-url

Issue #179（#176 验收遗留）· 分支 `cask-livecheck-explicit-url` · 起始 HEAD 232d0cd

## Context

#176（PR #178）交付的 livecheck 在 tap 同步后实测不可用：2026-10-24 `brew livecheck musictag` 报 "`url :stable` does not reference a checkable URL"，同 tap markflow cask 同样报错。根因：`url :stable` 展开为 cask stable URL `https://github.com/zsxink/MusicTag/releases/download/v#{version}/MusicTag_#{version}_#{arch}.dmg`，`arch` 模板化形式当前 Homebrew livecheck 无法解析为可探测 URL——#176 设计时引用的 markflow 范例本身即坏（markflow 侧同病由 MarkFlow#390 处置，不在本变更范围）。

修复方案已在本地 tap 实测：livecheck 改为显式 `url "https://github.com/zsxink/MusicTag/releases/latest"` 后，`brew livecheck musictag` 正常返回 `musictag: 0.1.5 ==> 0.1.5`（exit 0）。

已核实的仓库事实（HEAD 232d0cd）：

- `scripts/homebrew-publish.sh`：cask 模板位于 131–161 行未加引号的 `<<EOF_CASK` heredoc；livecheck 块在 146–149 行（`url :stable` 在 147 行，处于 `homepage` 与 `app` 之间）；渲染后 162 行 `ruby -c` 做语法校验；发布护栏与 tap 提交逻辑零改动。
- `tests/homebrew/publish.test.mjs`：渲染断言集中在 188–209 行用例「renders both architecture hashes and canonical public URLs without tap operations」，200 行 `assert.match(cask, /url :stable/)` 与本变更直接冲突；196 行既有断言继续锁定 stable URL 的 `#{version}`/`#{arch}` 原样存在。
- `url :stable` 在产品代码中仅上述两处（grep 核对，不含 archive 与 proposal 叙述）。
- delta spec 的 MODIFIED 表头「### Requirement: Synchronize the Cask after a release is published」与 canonical spec（openspec/specs/homebrew-release/spec.md）逐字一致，archive 不会拒。

## Goals / Non-Goals

**Goals:** 渲染产物的 livecheck 使用显式 latest-releases URL，`brew livecheck musictag` 恢复探测 tap 落后的能力（Tap lags 场景由不可用变为可用）；渲染测试断言与模板同步。

**Non-Goals:** `strategy :github_latest`、stable URL 行、uninstall/zap 段、`auto_updates` 缺省、发布护栏、tap README、markflow cask（MarkFlow#390）全部不动；无应用运行时行为变化。

## Decisions

### D1. livecheck URL 用显式 releases/latest（已实测）

147 行 `url :stable` 改为 `url "https://github.com/zsxink/MusicTag/releases/latest"`；`strategy :github_latest` 保持不变。`strategy :github_latest` 从该 URL 解析 GitHub 仓库（`zsxink/MusicTag`），再以仓库 latest release 为版本基准——与脚本「仅同步 published stable release」的护栏同源，draft/预发布不参与，不产生假阳性。实测证据见 Context。

### D2. heredoc 展开语义：URL 字面量无新增展开面

模板仍是未加引号的 `<<EOF_CASK` heredoc（shell 只展开 `$`、反引号与 `\`，`#` 为字面量）。新 URL 字面量不含 `$`、反引号、`\`，该行也无 `#{...}` Ruby 插值——无展开面变化，不需任何转义（误加 `\` 反而会破坏 URL）。改动落在 `ruby -c` 校验之前，语法门禁自动覆盖。

### D3. 测试断言同步（仅一处）

`tests/homebrew/publish.test.mjs` 200 行 `assert.match(cask, /url :stable/)` 改为正向断言锁定显式 URL，例如 `assert.match(cask, /url "https:\/\/github\.com\/zsxink\/MusicTag\/releases\/latest"/)`。其余断言不动：196 行 stable URL 断言、198 行 `doesNotMatch /no_check|auto_updates/`、199 行 `livecheck do`、201 行 `strategy :github_latest` 均保持原样；不新增测试文件、不改 fake。模板改动（1.1）与断言同步（1.2）必须同一 Dev checkpoint：模板变更后旧断言立即失败，拆开产生红色中间态。

## Risks

| 风险 | 缓解/兜底 |
| --- | --- |
| livecheck URL 硬编码 repo 归属（zsxink/MusicTag） | URL 与 `homepage`（144 行，同仓库）同源，漂移风险低；若未来仓库迁移，homepage 与 stable URL 本就需同步修改，属新变更范围 |
| markflow cask 同病（`url :stable` 不可探测） | 不在本变更范围；MarkFlow#390 处置（markdown 注明） |
| `ruby -c` 只验语法，不验 livecheck DSL 语义 | 渲染测试断言锁定字面内容；`brew livecheck musictag` 与 `brew audit --cask` 列入集成后验收（tasks 4.2，不阻塞 PR 合并），且本地 tap 已实测修复有效 |

## 验证（domain: infra，非业务验证）

- `bash -n scripts/homebrew-publish.sh` —— bash 语法门禁。
- `node --test tests/homebrew/publish.test.mjs` —— homebrew 套件的真实命令（vitest include 仅 `src/**`，vitest 不会跑 tests/ 目录）。
- `npm run test` —— 与上一条并记，确认无其他回归。
- `npx --yes @fission-ai/openspec@1.5.0 validate --all --strict --no-interactive`（钉住 1.5.0，与 archive 门禁一致）。
- 无 Rust/Vue 改动，cargo check / npm run build 不在门禁内。

## Traceability

| spec 场景 | 设计依据 |
| --- | --- |
| MODIFIED「Synchronize the Cask after a release is published」→ Tap lags behind the latest release | D1（显式 URL）+ D3（断言同步）；行为由不可用变为可用 |
| MODIFIED 场景 Draft release / Published release / Missing cross-repository credential | 不变——发布护栏与 tap 提交逻辑零改动 |

canonical spec（openspec/specs/homebrew-release/spec.md）的更新由 Leader 在归档（integrate）时套用 delta 完成，不在 Dev checkpoint 内改。
