## 1. publish-release 收尾 job(infra)

- [ ] 1.1 在 `.github/workflows/release.yml` 新增 `publish-release` job:`needs: publish-tauri`(默认 success 语义,任一 matrix 条目失败或跳过即不执行)、`runs-on: ubuntu-latest`、`timeout-minutes: 10`、job 级 `permissions: contents: write` + `actions: write`(顶层与其余 job 权限不动);tag 经 `env: RELEASE_TAG: ${{ github.ref_name }}` 注入并在 run 块内引用。保留 `publish-tauri` 的 `releaseDraft: true`、4 条 matrix 与既有权限。Owner: Dev infra;files: `.github/workflows/release.yml`。Design: D1。覆盖场景:任一平台失败不发布;权限与配置正确。
- [ ] 1.2 实现自动发布步骤:先 `gh release view "$RELEASE_TAG" --json isDraft,tagName,isPrerelease` 作幂等闸(已发布则 no-op 退出 0),再以 3 次 2s/4s 退避重试执行 `gh release edit "$RELEASE_TAG" --draft=false`;重试耗尽即 job 失败,Release 保留草稿态。Owner: Dev infra;files: 同 1.1。Depends on 1.1。Design: D2。覆盖场景:全部平台成功后自动发布;重跑幂等;Release 草稿自动转正(MODIFIED)。
- [ ] 1.3 实现 tap 联动步骤:发布成功后 `gh workflow run homebrew.yml -f tag="$RELEASE_TAG"`(gh 默认派发到仓库默认分支);`homebrew.yml`、`scripts/homebrew-publish.sh` 与 `release: published` 触发器零改动,不等待 tap 同步结果。Owner: Dev infra;files: 同 1.1。Depends on 1.2。Design: D3。覆盖场景:自动发布触发 tap 同步。

## 2. README 维护者说明(docs)

- [ ] 2.1 改写 README「维护者:Homebrew 发布」一节:常规路径改为「三端构建成功后自动 publish 并自动触发 tap 同步,无需人工操作」;人工 publish 与在 Actions 手动运行 Homebrew Tap 保留为失败兜底说明;保留 `HOMEBREW_TAP_TOKEN` 权限边界、资产命名(`MusicTag_<版本>_aarch64.dmg` / `_x64.dmg`)与「同步失败不影响已发布 Release」表述;面向用户的安装/升级章节不改。Owner: Dev docs;files: `README.md`。Depends on 1.3(措辞与实际行为一致)。Design: D4。

## 3. 结构断言测试与本地验证(Tester)

- [ ] 3.1 新增 `tests/workflow-core/release-publish-contract.test.cjs`(`node:test` + `node:assert/strict`,纯文本/正则结构断言,零第三方依赖、不引 YAML 库,风格对齐 `tests/workflow-core/native-entry-contract.test.cjs`):断言 1.1–1.3 与 2.1 的结构契约——job 存在、needs、timeout、job 级权限(contents: write + actions: write)且顶层保持 read、`releaseDraft: true` 与 4 条 matrix 保留、`isDraft` 幂等闸、`--draft=false` 有界重试、显式 `gh workflow run homebrew.yml` 携带 `tag` 输入、`homebrew.yml` 触发器接口(`types: [published]` + `workflow_dispatch` inputs.tag)未被破坏、README 新措辞与兜底说明、ci.yml 与 release.yml 的 `tests/workflow-core/*.test.cjs` glob 一致。该文件由两个 workflow 既有 glob 自动收集进 CI,不改 workflow。Owner: Tester;files: `tests/workflow-core/release-publish-contract.test.cjs`。Depends on 1.1–1.3、2.1。Design: 验证节。
- [ ] 3.2 本地跑通并记录:新增测试与既有 workflow-core 套件(`node --test 'tests/workflow-core/*.test.cjs'`)、`node --test tests/homebrew/publish.test.mjs`、`node .agents/tools/pipe-native/self-check.js`;用可用解释器(`ruby -ryaml` 或 python3+PyYAML)对 `.github/workflows/release.yml` 与 `homebrew.yml` 做 YAML 语法解析(actionlint/yamllint 未安装则如实记录;可选 `bash -n` 校验新增 run 块)。记录每条命令与退出码。Owner: Tester;evidence 仅写授权路径。Depends on 3.1。

## 4. 独立审查与最终验证

- [ ] 4.1 CR(只读):对照已批准 spec 的 5 个场景逐条审 release.yml diff、README 与测试断言;重点核对未扩大范围(`homebrew.yml`/`scripts/homebrew-publish.sh` 零改动、`releaseDraft: true` 保留、无新增凭据)与 design D3 的事件抑制机制注记;问题按 file + issue + specReference + suggestion 回报,修复经 Leader 重派。Owner: CR;no writes。Depends on 3.2。
- [ ] 4.2 Verify(与 CI 门禁对齐的完整清单):`npx --yes @fission-ai/openspec@1.5.0 validate --all --strict --no-interactive`;`node --test '.agents/tools/pipe-core/test/*.test.js' 'tests/workflow-core/*.test.cjs' '.agents/tools/pipe-native/test/*.test.js'`;`node --test tests/homebrew/publish.test.mjs`;`node .agents/tools/pipe-native/self-check.js`;`npm ci && npm run build && npm run test`;`cargo check --manifest-path src-tauri/Cargo.toml --all-targets` 与 `cargo test --manifest-path src-tauri/Cargo.toml --all-targets`;两个 workflow 的 YAML 语法解析。真实 `v*` tag 的端到端链路(自动转正 → tap 自动同步)标记为 rollout check,留待下一次真实发版验证,不计入本地 Verify 结论。Owner: Verify;no product writes。Depends on 4.1。

## 5. 集成(Leader 执行,按惯例不在此勾选)

- [ ] 5.1 Leader 审计授权路径与 diff 后按 `feat(release-auto-publish): <任务>` 提交,随后 archive 变更、推送分支、创建或复用 PR(`Closes #175`)、核对 required CI、经 PR 合并回 main 并核对远端事实;发布链路的真实验证(rollout check)随下一次发版执行并补记。Owner: Leader。Depends on 4.2。
