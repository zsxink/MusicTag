# Design: cask-livecheck-uninstall

Issue #176 · 分支 `cask-livecheck-uninstall` · 起始 HEAD faab408

## Context

tap 中 `Casks/m/musictag.rb` 是生成物，由 `scripts/homebrew-publish.sh` 131–148 行的 heredoc 模板渲染。与同 tap 的 markflow cask（`gh api repos/zsxink/homebrew-tap/contents/Casks/m/markflow.rb` 只读核对）相比缺两块：无 `livecheck`（`brew livecheck musictag` 探测不到 tap 落后于 GitHub latest release——#175 的 draft 卡同步正是这类问题，排查时少一个探针），也无 `uninstall quit:` / `zap trash:` 卸载清理段。cask 是生成物，手改 tap 会被下个版本同步覆盖，必须改本仓库模板。

已核实的仓库事实（HEAD faab408）：

- `scripts/homebrew-publish.sh`：cask 模板在 131–148 行未加引号的 `<<EOF_CASK` heredoc 内，渲染后 149 行 `ruby -c` 做语法校验；模板之后的发布护栏（draft/预发布拒绝、双架构资产唯一性与公开可达、SHA-256 与 size 校验、tap 版本降级拒绝、单文件 commit）在本变更后零改动。
- `tests/homebrew/publish.test.mjs`：198 行 `assert.doesNotMatch(cask, /no_check|auto_updates|zap|uninstall/)` 与本变更直接冲突，必须反转为正向断言（D5）；渲染断言集中在 188–202 行用例；fake 的 gh/curl/git 与本变更无关，不需改动。
- bundle id：`com.musictag.desktop`（src-tauri/tauri.conf.json）。
- 2026-10-24 本机实测（应用安装并启动后）真实存在的数据目录：`~/Library/Application Support/MusicTag`（内含 dir-memory 写入的 config.json）、`~/Library/Caches/com.musictag.desktop`、`~/Library/WebKit/com.musictag.desktop`；Preferences plist、HTTPStorages、Saved Application State、Logs 均未观测到。
- markflow 参照：`livecheck do url :stable; strategy :github_latest end` 位于 `homepage` 与 `app` 之间，`uninstall quit:` / `zap trash:` 位于 `app` 之后；markflow 另有 `auto_updates true`，本变更不复制（见 D2）。

## Goals / Non-Goals

**Goals:** 模板渲染出的 cask 含 livecheck 块（url :stable + strategy :github_latest）与 uninstall/zap 清理段；`brew livecheck musictag` 具备探测 tap 落后的能力；卸载时退出运行中的应用、zap 只清理实测存在的数据；渲染测试断言与模板同步反转，正向锁定新增内容。

**Non-Goals:** 不添加 `auto_updates`（D2）；不改 `.github/workflows/*`（homebrew.yml 只是调用脚本，接口零变化）、README、tap 仓库任何其他文件（含 markflow.rb 与 tap README，c7e1837 已统一 `--cask` 写法，无需再改）；不改发布护栏与测试 fake；无应用运行时行为变化。

## 边界与数据流

**边界：** 只允许改两个文件——`scripts/homebrew-publish.sh` 仅限 cask heredoc 模板（131–148 行区域，模板之外不新增任何 shell 逻辑，`ruby -c` 校验继续覆盖全部渲染产物），`tests/homebrew/publish.test.mjs` 仅限 188–202 行渲染用例的断言部分。其余一切只读。

**数据流（模板 → tap）：**

```
scripts/homebrew-publish.sh heredoc 模板(131–148)
  → 渲染 $temp_dir/musictag.rb(shell 展开 $version/${hashes[i]}; #{version}/#{arch} 原样保留给 Ruby)
  → ruby -c 语法校验(门禁)
  → --output 本地渲染(测试读取并断言) / --publish 经临时 worktree 推 zsxink/homebrew-tap main(单文件 diff)
```

tap 侧生效时机：下一次 release 自动同步，或合并后手动重跑 Homebrew Tap workflow（tag=当前已发布版本）提前带出；两条路径渲染同一模板，无迁移步骤。

## Decisions

### D1. livecheck 块：与 markflow 同构，插在 homepage 与 app 之间

在模板 `homepage` 行之后、`app` 行之前插入：

```ruby
  livecheck do
    url :stable
    strategy :github_latest
  end
```

- 写法与同 tap markflow cask 完全一致（proposal 明确要求），也符合 Homebrew 官方 cask stanza 顺序（livecheck 在 homepage 之后、app 之前）。
- `url :stable` 复用 cask 自身 stable url（GitHub releases 下载地址），`strategy :github_latest` 以仓库 latest release 为版本基准；两者组合使 `brew livecheck musictag` 能报出 tap 落后于最新已发布版本的情形，作为 tap 同步问题的探针。
- 只看 latest 标记的 release，draft/预发布不参与，与脚本「仅同步 published stable release」的护栏同源，不会产生预发布假阳性。

### D2. 不添加 auto_updates 的理由

markflow 声明了 `auto_updates true`，但 MarkFlow 具备应用内自动更新而 MusicTag 没有。声明该字段的 cask 会被 `brew upgrade` 默认跳过（需 `brew upgrade --greedy` 才覆盖），而 MusicTag 的升级完全由 tap 版本驱动——加它会让用户显式 `brew upgrade musictag` 静默无效。delta spec 的 MODIFIED requirement 明文「SHALL NOT declare `auto_updates`」，测试断言同步锁定其不存在。

### D3. uninstall/zap 段：bundle id 与「只列实测存在项」的证据约束

在模板 `app "MusicTag.app"` 之后追加：

```ruby
  uninstall quit: "com.musictag.desktop"

  zap trash: [
    "~/Library/Application Support/MusicTag",
    "~/Library/Caches/com.musictag.desktop",
    "~/Library/WebKit/com.musictag.desktop",
  ]
```

- `uninstall quit:` 的 bundle id 取自 `src-tauri/tauri.conf.json`（`com.musictag.desktop`），卸载时先请求退出运行中的应用再移除 bundle。
- `zap trash:` 只列 2026-10-24 本机实测「安装并启动后确认存在」的三项；`trash` 动作进回收站、可恢复，符合 Homebrew zap 惯例。
- Preferences plist、HTTPStorages、Saved Application State、Logs 未观测到，**不列入**——delta spec 场景「the trash list contains no location that has not been observed for this app」是硬约束，宁缺勿滥；后续若有新实测目录，走新变更扩表，不在本变更内预留。

### D4. heredoc 展开语义（实现要点，防回归）

- 模板是未加引号的 `<<EOF_CASK` heredoc：shell 只展开 `$`、反引号与 `\`，`#` 是字面量。因此 `# frozen_string_literal: true` 注释与 Ruby 插值 `#{version}`、`#{arch}` 无需转义、必须原样保留——这是渲染正确性的命门：误加 `\` 或改写成 `${version}` 都会让 Homebrew 运行时插值失效（测试 196 行既有 url 断言继续锁 `#{version}`/`#{arch}` 原样存在）。
- 新增段落（livecheck/uninstall/zap）不含 `$` 与反引号，不引入新的展开面。
- 新增行全部落在 `ruby -c` 校验之前，语法门禁自动覆盖。

### D5. 测试断言反转与新增断言清单

`tests/homebrew/publish.test.mjs` 198 行 `assert.doesNotMatch(cask, /no_check|auto_updates|zap|uninstall/)` 反转，改动只发生在既有用例「renders both architecture hashes and canonical public URLs without tap operations」内，不新增测试文件、不改 fake：

| 断言 | 形态 |
| --- | --- |
| `livecheck do` 存在 | 正向（正则或 includes） |
| `url :stable`、`strategy :github_latest` 存在 | 正向 |
| `uninstall quit: "com.musictag.desktop"` 存在 | 正向，精确匹配 bundle id |
| zap trash 三条路径逐一存在（`~/Library/Application Support/MusicTag`、`~/Library/Caches/com.musictag.desktop`、`~/Library/WebKit/com.musictag.desktop`） | 正向 |
| `no_check`、`auto_updates` 不存在 | 负向，收窄为 `/no_check\|auto_updates/` |

模板改动（tasks 1.1/1.2）与断言反转（tasks 2.1）必须同一 Dev checkpoint 落地：模板变更后旧负向断言立即失败，拆开会产生红色中间态。

## Risks

| 风险 | 缓解/兜底 |
| --- | --- |
| `ruby -c` 只验 Ruby 语法，不验 cask DSL 语义（stanza 拼错、livecheck 参数非法也能通过） | 渲染测试断言锁定新增段落字面内容；合并后 `brew audit --cask zsxink/tap/musictag` 是语义权威检查、`brew livecheck musictag` 验证探测行为，列入集成后验收任务（不阻塞 PR 合并） |
| heredoc 展开语义被未来改动破坏（给 heredoc 加引号、转义 `#{`） | D4 注记；既有 url 断言与本次新增断言共同锁住 `#{version}`/`#{arch}` 与新增段落原样存在 |
| zap 清单基于单机实测，个别用户机器可能出现未观测目录（如 Preferences plist） | 已批准范围与 spec 场景明确「只列实测存在项」，本设计遵循；差异属规格级取舍，不私下扩表 |
| livecheck 对 GitHub latest release 语义的依赖 | `strategy :github_latest` 只看 latest 标记的 release，与脚本只同步 published stable 的护栏一致，不产生 draft/预发布假阳性；真实探测效果由集成后 `brew livecheck musictag` 实测确认 |

## 验证（domain: infra，非业务验证）

- `bash -n scripts/homebrew-publish.sh` —— bash 语法门禁。
- `node --check` 不适用：tests/homebrew/publish.test.mjs 是 .mjs、由 vitest 运行，不做独立语法检查。
- `npm run test`（vitest run）的 homebrew 套件 `tests/homebrew/publish.test.mjs` 全绿，含反转后的渲染断言；无 Rust/Vue 改动，cargo check / npm run build 不在门禁内。
- `npx --yes @fission-ai/openspec@1.5.0 validate --all --strict --no-interactive`（钉住 1.5.0，与 archive 门禁一致；全局 CLI 1.13.2 会拒）。
- 可选（需 gh auth 与网络）：`scripts/homebrew-publish.sh v<当前已发布版本> --output <临时文件>` 本地渲染后 `ruby -c`，肉眼核对 livecheck/uninstall/zap 的渲染位置。

## Traceability

| spec 场景 | 设计依据 |
| --- | --- |
| MODIFIED「Synchronize the Cask after a release is published」→ Tap lags behind the latest release | D1（livecheck）+ D2（不加 auto_updates） |
| MODIFIED 场景 Draft release / Published release / Missing cross-repository credential | 不变——发布护栏与 tap 提交逻辑零改动 |
| ADDED「Clean up app data on uninstall」→ Quit the app on uninstall | D3（`uninstall quit:`） |
| ADDED → Zap removes confirmed app data | D3（zap trash 恰三项 + 未观测路径禁入） |
| 渲染产物验证（无独立场景，支撑以上全部） | D5（断言反转清单） |

delta 的 MODIFIED 表头与 canonical spec（openspec/specs/homebrew-release/spec.md）逐字一致，archive 不会拒。
