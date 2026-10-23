## Context

Issue #175 修复 v0.1.5 发版事故:`release.yml` 以 `releaseDraft: true` 产出草稿,而 `homebrew.yml` 只监听 `release: published`;草稿忘记人工 publish 时 tap 停在旧版本,`brew install/upgrade` 得到 "already installed" 且全程无提醒。本变更是 **infra** 域:只改 `.github/workflows/release.yml`(新增一个 job)与 `README.md`(维护者说明),不触碰 Rust/Vue/Tauri 运行时,不改 `homebrew.yml` 与 `scripts/homebrew-publish.sh`。

已核实的仓库事实(HEAD 5e945ac):

- `release.yml`:顶层 `permissions: contents: read`;`test` job 先行;`publish-tauri`(`needs: test`)以 4 个 matrix 条目(windows-latest / macos-latest aarch64 / macos-latest x86_64 / ubuntu-22.04)、`fail-fast: false` 运行 tauri-action,`releaseDraft: true` 创建草稿,job 内 `permissions: contents: write`。
- `homebrew.yml`:监听 `release: published` 与 `workflow_dispatch`(required 输入 `tag`),concurrency 组 `homebrew-musictag`(`cancel-in-progress: false`)串行化;源代码 checkout 仓库默认分支。
- `scripts/homebrew-publish.sh` 在任何 tap 变更前强制校验:release 已发布(`isDraft=false`、`isPrerelease=false`)、`MusicTag_<版本>_aarch64.dmg` 与 `MusicTag_<版本>_x64.dmg` 双架构资产各恰好一个、公开可达、字节数与 SHA-256 一致。该护栏在本变更后继续生效。
- README「维护者:Homebrew 发布」一节(约第 63–67 行)写明「确认两个 macOS DMG 已上传后,由维护者在 GitHub 上手动发布该 draft」,即本次要修改的措辞。

关键平台事实(2026-10-24 依 GitHub 官方文档核实,与 2026-10-22 `add-homebrew-tap` design D1 的预判一致):用仓库 `GITHUB_TOKEN` 作出的事件**不会创建新的 workflow run**,例外只有 `workflow_dispatch` 与 `repository_dispatch`。因此 `publish-release` job 用 `GITHUB_TOKEN` 把草稿转正后,`release: published` 事件虽会发生,但**不会**触发 `homebrew.yml`。若只做"转正"不做显式联动,链路仍会断,且比事故原状更隐蔽(看似全自动,实则静默断链)。

## Goals / Non-Goals

**Goals:** 三端产物上传齐备后自动把草稿 Release 转正;转正后无需人工操作即触发 tap 同步;重跑幂等;任一平台失败或发布步骤失败时失败闭合为草稿态,人工兜底路径保留;README 与实际行为一致。

**Non-Goals:** 不改 `releaseDraft: true`(草稿先行是已批准规格);不改 `homebrew.yml`、`scripts/homebrew-publish.sh`、tauri-action 其余配置与 tag 触发条件;不新增任何凭据/Secret;不做 publish-release 内的资产枚举校验;不做历史残留草稿的自动清理;不改 `ci.yml`。

## Decisions

### D1. publish-release job 形态与触发条件

新增 job id `publish-release`:`needs: publish-tauri`,无 matrix,`runs-on: ubuntu-latest`,`timeout-minutes: 10`。

- 触发条件依赖 `needs` 的默认 success 语义:4 个 matrix 条目全部成功才执行;任一失败或被跳过即自动跳过,不需要额外 `if`。`publish-tauri` 现有 `if: startsWith(github.ref, 'refs/tags/v')` 原样保留作防御。
- 权限:job 级 `permissions: { contents: write, actions: write }`。`contents: write` 是 `gh release edit` 的最小要求;`actions: write` 是 `gh workflow run`(workflow dispatch)的最小要求,仅限该 job。顶层保持 `contents: read`,`publish-tauri` 保持仅 `contents: write`,canonical spec「workflow 权限与配置正确」场景不变。
- tag 来源:`env: RELEASE_TAG: ${{ github.ref_name }}`(tag push 事件下即 `v*`),run 块内一律 `"$RELEASE_TAG"` 引用,避免注入。

### D2. 发布步骤、幂等与有界重试

- 幂等闸:先 `gh release view "$RELEASE_TAG" --json isDraft,tagName,isPrerelease`。若已非草稿(`isDraft=false`)则打印 "already published; nothing to do" 并退出 0——不依赖 GitHub API 对已发布 release 执行 edit 的边界语义,让「重跑幂等」成为显式行为。
- 转正:有界重试(3 次,2s/4s 退避,复用 `scripts/homebrew-publish.sh` 的 retry 形态)执行 `gh release edit "$RELEASE_TAG" --draft=false`。不传 `--latest`、不改 title/body/prerelease,最小变更。
- 3 次重试后仍失败:步骤失败、job 失败,Release 保留草稿态,走 D4 人工兜底。
- 不在 publish-release 里枚举校验资产:matrix leg 成功即代表该 leg 的 tauri-action 上传成功;双 DMG 齐全由 `scripts/homebrew-publish.sh` 在 tap 同步前继续把关。重复维护一份资产清单属于范围扩张且易腐化。

### D3. 与 homebrew.yml 的联动时序

1. 4 个 matrix leg 各自上传资产到同一草稿并成功结束(fail-fast: false 下互不拖累)。
2. `publish-release` 经幂等闸后执行 `gh release edit --draft=false`,草稿转正(该动作由 `GITHUB_TOKEN` 作出)。
3. GitHub 发出 `release: published` 事件;因 `GITHUB_TOKEN` 抑制规则,该事件**不**触发 `homebrew.yml`——这是已核实的平台行为,不是回归。
4. 同一 job 内显式 `gh workflow run homebrew.yml -f tag="$RELEASE_TAG"`。`workflow_dispatch` 是 `GITHUB_TOKEN` 抑制的例外,必然创建 run;`homebrew.yml` 已有 required 输入 `tag`,接口零改动。省略 `--ref` 时 gh 默认派发到仓库默认分支,与 `homebrew.yml` 内部「源代码 checkout 默认分支」的信任模型一致。
5. `homebrew.yml` 的 `sync-tap` 以默认分支代码运行 `homebrew-publish.sh`:校验「已发布 + 双架构 DMG 齐全 + 公开可达」后推送 tap;concurrency 组串行化,与并行发布或人工 dispatch 互不踩踏。
6. `release: published` 触发器保留:人工 publish 兜底路径(D4)仍走事件触发;`homebrew.yml` 与脚本零改动,proposal 的 Impact 承诺成立。

`publish-release` 不 `gh run watch` 等待 tap 同步结果:tap 同步失败有自己的可见失败与既有重试路径(Actions 中以同 tag 手动运行 Homebrew Tap),与 proposal「脚本校验继续作为护栏」一致。

> 规格注记:spec 场景「自动发布触发 tap 同步」THEN 中的「`release: published` 事件触发」字面机制被上述平台事实否决;需求级陈述「SHALL NOT 依赖人工 publish 才触发下游 tap 同步」由显式 dispatch 完全满足,产品可观察行为(自动转正 + 自动同步 tap + 无需人工)不变。本设计选择该机制因为它不需要新凭据、不改 `homebrew.yml`,且复用其既有公开接口。spec-gate 与 Leader 应知悉此注记;若认为 spec 文本需按实际机制修订,由 Leader 走规格变更,本实现不因此阻塞。

### D4. 失败行为与人工兜底

| 失败点 | 结果 | 兜底 |
| --- | --- | --- |
| 任一 matrix 条目构建/上传失败 | `publish-release` 跳过,Release 保留草稿 | 修复后重跑 workflow;或人工 publish(发布事件照常触发 tap) |
| `gh release view/edit` 瞬时故障 | 重试 3 次后 job 失败,草稿保留 | 人工 publish 兜底(README 保留说明) |
| 转正成功但 dispatch 失败 | Release 已发布、tap 未同步 | Actions 手动运行 Homebrew Tap 输入同 tag 重试(README 既有指引) |
| tap 同步失败 | 既有脚本护栏拦住,不影响已发布 Release | 既有 dispatch 重试路径(不变) |

README「维护者:Homebrew 发布」相应改写:常规路径为「三端构建成功后自动 publish 并自动同步 tap」;人工 publish 与手动 dispatch 降级为失败兜底说明;保留 Secret 权限边界、资产命名(`MusicTag_<版本>_aarch64.dmg` / `_x64.dmg`)与「同步失败不影响已发布 Release」的表述。

### D5. 替代方案取舍

- **tauri-action 直接 `releaseDraft: false`** — 拒绝。第一个完成的 matrix leg 会立即创建并公开 Release,此时其余平台资产尚未上传,用户可见半成品发行;且 `published` 事件在创建时即刻发出,tap 同步大概率因 DMG 缺失被脚本护栏拒绝,变成必现的红色噪声。直接违反已批准 MODIFIED 场景「GitHub Release 先以草稿(Draft)状态承载资产」。草稿态是刻意的完成前缓冲区。
- **publish 步骤改用 PAT / GitHub App token,让 `release: published` 事件自然触发 `homebrew.yml`** — 拒绝为默认方案。需要新增仓库 Secret 与维护者前置配置(proposal Impact 未含新增凭据);若 Secret 未配置,自动发布直接失败,特性默认退化为旧事故形态。可作为后续独立改进,不进入本变更。
- **给 `homebrew.yml` 增加 `repository_dispatch` 触发器配合 `GITHUB_TOKEN`** — 拒绝。`repository_dispatch` 虽同为例外,但需要修改 `homebrew.yml`(proposal 明确不改);其既有 `workflow_dispatch` 输入可直接复用。

## Risks

- **R1 tauri-action 并发竞争创建同 tag 草稿**:4 个 leg 同时按 tag 查找/创建 Release,tauri-action 内部有查找与重试逻辑,但历史上存在并发创建冲突的先例。后果闭合:个别 leg 失败 → `fail-fast: false` 其余继续 → `publish-release` 因 needs 不满足而跳过 → 草稿保留可人工兜底,无更坏状态。本设计不依赖 tauri-action 内部实现细节。
- **R2 gh API 瞬时故障**:view/edit 均有 3 次退避重试;最终失败保留草稿。
- **R3 转正成功但 dispatch 失败或 homebrew run 失败**:Release 已发布、tap 停旧版;「已发布但资产缺失/未发布」会被 `homebrew-publish.sh` 拒绝而非错误同步;人工重试路径既有且有文档。属于 proposal 已声明的残余风险类。
- **R4 同 tag 历史残留多个草稿**:`gh release view/edit` 按tag 解析可能出现歧义 → job 失败闭合,人工清理一次即可;不做自动清理(超范围)。
- **R5 平台事实变化**:若 GitHub 未来放宽 `GITHUB_TOKEN` 抑制,显式 dispatch 依然幂等安全(`homebrew-publish.sh` 对同版本 tap 变更是 no-op);行为不依赖平台假设,结构断言钉住显式联动。

## 验证(domain: infra,非业务验证)

- 新增 `tests/workflow-core/release-publish-contract.test.cjs`(Node 24 `node:test` + `node:assert/strict`,与 `native-entry-contract.test.cjs` 同风格;纯文本/正则结构断言,零第三方依赖、不引 YAML 库)。断言要点:`publish-release` 存在且 `needs: publish-tauri`;`publish-tauri` 的 `releaseDraft: true` 与 4 条 matrix 保留不回退;`--draft=false` 转正 + `isDraft` 幂等闸;有界重试;显式 `gh workflow run homebrew.yml` 携带 `tag` 输入;job 级 `contents: write` + `actions: write` 且顶层保持 read;`homebrew.yml` 触发器接口(`types: [published]` + `workflow_dispatch` inputs.tag)未被破坏;README 不再要求常规人工 publish 且含兜底措辞;ci.yml 与 release.yml 的 `tests/workflow-core/*.test.cjs` glob 保持一致(三处门禁同集)。
- 该文件落在 `tests/workflow-core/` 下,被 ci.yml 与 release.yml 现有 glob 自动收集,**无需改 workflow 即进 CI**,满足 canonical spec「与 ci.yml 门禁一致」。
- Verify 命令清单与 CI 对齐(见 tasks 4.2):openspec validate --all --strict、pipe 原生套件、homebrew publish 套件、self-check、npm ci/build/test、cargo check/test --all-targets,外加两个 workflow 的 YAML 语法解析(本机与 CI 均未装 actionlint/yamllint;用可用解释器 `ruby -ryaml` 或 python3+PyYAML 解析,Verify 记录实际所用工具;安装 actionlint 可作增强,不作门禁)。
- 端到端行为(真实 `v*` tag → 自动转正 → tap 自动同步)只能在合并后下一次真实发版验证,按存档惯例标记为 **rollout check**,不计入本地 Verify 结论。

## Traceability

- 全部平台成功后自动发布 → D1、D2。
- 任一平台失败不发布 → D1、D4。
- 重跑幂等 → D2。
- 自动发布触发 tap 同步 → D3(含机制注记)。
- Release 草稿自动转正(MODIFIED)→ D1、D2、D5(拒绝 `releaseDraft: false` 的依据)。
- 权限与配置正确(canonical 既有要求)→ D1;测试门禁一致 → 验证节。
