## Why

GitHub Issue: #175

v0.1.5 发布时暴露:release workflow 以 `releaseDraft: true` 创建 Release,而 Homebrew tap 同步 workflow 只监听 `release: published`。草稿一旦忘记人工 publish,tap 就停留在旧版本,brew 用户执行 `brew install/upgrade` 会得到 "already installed" 而拿不到新版。该断点没有任何提醒,完全依赖维护者记忆,每次发版都会重现。

## What Changes

- 在 `.github/workflows/release.yml` 新增 `publish-release` 收尾 job:`needs: publish-tauri`,全部 matrix(Windows / macOS aarch64 / macOS x86_64 / Linux)构建与资产上传成功后,用 `gh release edit <tag> --draft=false` 自动把草稿转正。
- 幂等:对已发布的 Release 重跑该 job 不得报错;任一平台失败时 job 不执行,Release 保留草稿态,人工 publish 作为兜底路径保留。
- 更新 README 维护者说明,把"发布后手动 publish"改为"构建成功后自动 publish,失败时人工兜底"。
- 自动发布后由 `publish-release` job 显式 `workflow_dispatch` 复用 `homebrew.yml` 既有 dispatch 接口同步 tap(GitHub 对 `GITHUB_TOKEN` 作出的事件有抑制规则,`workflow_dispatch` 是例外);`release: published` 触发器保留供人工 publish 兜底,链路端到端闭环,常规路径无需人工操作。

## Capabilities

### Modified Capabilities

- `ci-release`:三端产物挂载 Release 后,草稿不再依赖人工核对发布,而是在全部平台构建成功后自动转正;新增 publish-release job 的等待、幂等、失败保留与联动 tap 同步要求。

## Impact

- `.github/workflows/release.yml`(新增一个 job)、`README.md`(维护者说明)。
- `homebrew.yml` 与 `scripts/homebrew-publish.sh` 不改代码:联动复用其既有 `workflow_dispatch` 接口,`release: published` 触发器保留给人工兜底;脚本自带的"已发布 + 双架构 DMG 齐全"校验继续作为护栏。
- 无应用运行时行为变化;发版用户可见变化是 brew 渠道及时拿到新版。
- 残余风险:publish job 自身失败(如 GitHub API 瞬时故障)时仍需人工 publish,README 保留该说明。
