# Tasks: cask-livecheck-uninstall

> Owner 仅表示建议执行角色；只有主会话（Leader）勾选任务并写 progress。Dev 内 1.x 与 2.1 属同一 checkpoint（design D5：模板变更后旧断言立即失败，不可拆分）。

## 1. cask heredoc 模板改动（infra，Dev）

- [x] 1.1 在 `scripts/homebrew-publish.sh` 的 cask heredoc 模板（131–148 行）中，`homepage` 行之后、`app` 行之前插入 livecheck 块：`livecheck do` / `url :stable` / `strategy :github_latest` / `end`（两空格缩进，与 markflow.rb 同构）；不添加 `auto_updates`；heredoc 内既有 `#{version}`/`#{arch}` Ruby 插值与 `#` 注释保持原样，不加引号、不转义。Owner: Dev；files: `scripts/homebrew-publish.sh`。Design: D1/D2/D4。覆盖场景：Tap lags behind the latest release。
- [x] 1.2 同模板 `app "MusicTag.app"` 之后追加 `uninstall quit: "com.musictag.desktop"` 与 `zap trash:` 数组，数组只含三项实测路径：`~/Library/Application Support/MusicTag`、`~/Library/Caches/com.musictag.desktop`、`~/Library/WebKit/com.musictag.desktop`；不添加任何未观测目录（Preferences plist、HTTPStorages、Saved Application State、Logs 禁入）。Owner: Dev；files: 同 1.1。Depends on 1.1。Design: D3/D4。覆盖场景：Quit the app on uninstall；Zap removes confirmed app data。

## 2. 渲染测试断言反转与新增（Dev，与第 1 组同一 checkpoint）

- [x] 2.1 反转 `tests/homebrew/publish.test.mjs` 198 行断言：负向收窄为 `assert.doesNotMatch(cask, /no_check|auto_updates/)`（不再含 zap/uninstall）；在既有用例「renders both architecture hashes and canonical public URLs without tap operations」内新增正向断言（清单见 design D5）：`livecheck do`、`url :stable`、`strategy :github_latest`、`uninstall quit: "com.musictag.desktop"`、zap trash 三条路径逐一存在；不新增测试文件、不改 fake gh/curl/git。Owner: Dev；files: `tests/homebrew/publish.test.mjs`。Depends on 1.1、1.2。Design: D5。

## 3. 非业务验证（Tester）

- [ ] 3.1 `bash -n scripts/homebrew-publish.sh`；运行 `npm run test` 确认 homebrew 套件（`tests/homebrew/publish.test.mjs`）全绿；如实记录不适用项：`node --check` 不适用（.mjs 由 vitest 运行）、无 Rust/Vue 改动故 cargo/build 不在门禁内。Owner: Tester。Depends on 2.1。Design: 验证节。
- [ ] 3.2 `npx --yes @fission-ai/openspec@1.5.0 validate --all --strict --no-interactive` 通过（钉住 1.5.0，勿用全局 CLI 1.13.2）。Owner: Tester。Depends on 1.1–2.1。

## 4. 审查与最终验证

- [ ] 4.1 CR（只读）：对照 delta spec 的 6 个场景逐条审 diff；重点核对——只改两个授权文件、模板之外的脚本逻辑与发布护栏零改动、zap 数组恰为三项且无未观测路径、无 `auto_updates`、`#{version}`/`#{arch}` 未被转义、测试负向断言不再含 zap/uninstall 且新增断言齐全。Owner: CR；no writes。Depends on 3.2。
- [ ] 4.2 Verify：按 design「验证」节完整执行并记录每条命令与退出码（bash -n、npm run test 的 homebrew 套件、openspec validate --all --strict；node --check 不适用如实记录）；确认无越权写入（仅 `scripts/homebrew-publish.sh` 与 `tests/homebrew/publish.test.mjs` 两个产品文件变更）。Owner: Verify；no product writes。Depends on 4.1。

## 5. 集成与集成后验收（Leader / 维护者，按惯例不在此勾选）

- [ ] 5.1 Leader 审计授权路径与 diff 后归档变更并按 `feat(cask-livecheck-uninstall): <任务>` 提交，推送分支、创建或复用 PR（`Closes #176`）、核对 required CI、经 PR 合并回 main 并核对远端事实。Owner: Leader。Depends on 4.2。
- [ ] 5.2 【集成后动作，不阻塞 PR 合并】合并后由维护者手动重跑 Homebrew Tap workflow（Actions → Homebrew Tap → Run workflow，tag 传当前已发布版本，如 `v0.1.5`）让 tap 立即同步；随后验收：`brew audit --cask zsxink/tap/musictag` 通过，`brew livecheck musictag` 返回探测信息（基于 GitHub latest release）。若 audit/livecheck 失败，属 tap 侧语义问题（ruby -c 只验语法的兜底路径，见 design Risks），回报 #176 由维护者处置，不影响本仓库已合并产物。Owner: 维护者。Depends on 5.1（PR 已合入 main）。
