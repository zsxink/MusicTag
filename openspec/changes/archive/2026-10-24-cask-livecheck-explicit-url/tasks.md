# Tasks: cask-livecheck-explicit-url

> Owner 仅表示建议执行角色；只有主会话（Leader）勾选任务并写 progress。Dev 内 1.1 与 1.2 属同一 checkpoint（design D3：模板变更后旧断言立即失败，不可拆分）。

## 1. 模板与断言同步改动（infra，Dev）

- [x] 1.1 在 `scripts/homebrew-publish.sh` cask heredoc 模板的 livecheck 块（146–149 行）中，把 147 行 `url :stable` 改为 `url "https://github.com/zsxink/MusicTag/releases/latest"`；`strategy :github_latest` 与块内缩进保持不变；URL 字面量不加转义（无 `$`/反引号/插值，无展开面变化，design D2）；stable URL 行、uninstall/zap 段、其余脚本逻辑与发布护栏零改动。Owner: Dev；files: `scripts/homebrew-publish.sh`。Design: D1/D2。覆盖场景：Tap lags behind the latest release。
- [x] 1.2 把 `tests/homebrew/publish.test.mjs` 200 行 `assert.match(cask, /url :stable/)` 同步改为显式 URL 正向断言（形态见 design D3）；其余断言一律不动，不新增测试文件、不改 fake gh/curl/git。Owner: Dev；files: `tests/homebrew/publish.test.mjs`。Depends on 1.1（同一 checkpoint）。Design: D3。

## 2. 非业务验证（Tester）

- [x] 2.1 执行并如实记录每条命令与退出码：`bash -n scripts/homebrew-publish.sh`；`node --test tests/homebrew/publish.test.mjs`（homebrew 套件的真实命令，vitest include 仅 `src/**` 不会覆盖它）；`npm run test`（与上一条并记，确认无其他回归）；`npx --yes @fission-ai/openspec@1.5.0 validate --all --strict --no-interactive`（钉住 1.5.0，勿用全局 CLI）。无 Rust/Vue 改动，cargo check / npm run build 不在门禁内，如实记录不适用。Owner: Tester。Depends on 1.1–1.2。Design: 验证节。

## 3. 审查与最终验证

- [x] 3.1 CR（只读）：对照 delta spec 的 MODIFIED requirement 审 diff；重点核对——只改两个授权文件且各恰一处（脚本 147 行、测试 200 行）、`strategy :github_latest` 与 stable URL 行未动、URL 字面量无 `$`/反引号/插值且未加转义、无 `auto_updates`、测试其余断言零改动。Owner: CR；no writes。Depends on 2.1。
- [x] 3.2 Verify：按 design「验证」节完整执行并记录每条命令与退出码（bash -n、`node --test` homebrew 套件、npm run test、openspec validate --all --strict）；确认无越权写入（仅 `scripts/homebrew-publish.sh` 与 `tests/homebrew/publish.test.mjs` 两个产品文件变更）。Owner: Verify；no product writes。Depends on 3.1。

## 4. 集成与集成后验收（Leader / 维护者，按惯例不在此勾选）

- [ ] 4.1 Leader 审计授权路径与 diff 后归档变更（canonical spec 套用 delta；MODIFIED 表头已与 canonical 逐字一致）并按 `feat(cask-livecheck-explicit-url): <任务>` 提交，推送分支、创建或复用 PR（`Closes #179`）、核对 required CI、经 PR 合并回 main 并核对远端事实。Owner: Leader。Depends on 3.2。
- [ ] 4.2 【集成后动作，不阻塞 PR 合并】合并后由维护者手动重跑 Homebrew Tap workflow（Actions → Homebrew Tap → Run workflow，tag=`v0.1.5`）同步 tap；随后验收：`brew livecheck musictag` 正常返回版本探测信息（不再报 "`url :stable` does not reference a checkable URL"，本地实测形态为 `musictag: 0.1.5 ==> 0.1.5`、exit 0），`brew audit --cask zsxink/tap/musictag` 通过。若失败回报 #179 由维护者处置，不影响本仓库已合并产物。Owner: 维护者。Depends on 4.1（PR 已合入 main）。
