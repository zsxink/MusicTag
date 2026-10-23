## Why

GitHub Issue: #176

tap 中 musictag cask 由 `scripts/homebrew-publish.sh` 模板生成。与同 tap 的 markflow cask 对比缺两块内容：无 `livecheck`（`brew livecheck musictag` 无法探测 tap 落后于 GitHub release，排查同步问题时少一个探针——#175 的 draft 卡同步正是这类问题），也无 `uninstall quit:` / `zap trash:` 卸载清理段。cask 是生成物，手改 tap 会被下个版本同步覆盖，必须改本仓库模板。

## What Changes

- cask 模板在 `homepage` 与 `app` 之间增加 `livecheck do url :stable; strategy :github_latest end`，与同 tap markflow cask 写法一致。
- cask 模板不添加 `auto_updates`：MusicTag 没有应用内自动更新，加了会被 `brew upgrade` 默认跳过。
- cask 模板在 `app` 之后增加 `uninstall quit: "com.musictag.desktop"` 与 `zap trash:` 清理段；trash 路径按 2026-10-24 本机实测（应用启动后确认真实存在）只列三项：`~/Library/Application Support/MusicTag`（dir-memory 的 config.json）、`~/Library/Caches/com.musictag.desktop`、`~/Library/WebKit/com.musictag.desktop`；未观测到的候选（Preferences plist、HTTPStorages、Saved Application State、Logs）不列入。
- `tests/homebrew/publish.test.mjs` 既有断言"渲染产物不含 zap/uninstall"反转为正向断言：livecheck / uninstall quit / zap 三项存在，`auto_updates` 仍不存在。
- 合并后由维护者手动重跑 **Homebrew Tap** workflow（tag 传当前已发布版本，如 `v0.1.5`）让 tap 立即同步；验收为 `brew audit --cask zsxink/tap/musictag` 通过且 `brew livecheck musictag` 能返回探测信息。

## Capabilities

### Modified Capabilities

- `homebrew-release`：生成的 cask 内容新增 livecheck 更新探测与卸载清理要求（MODIFIED 既有"Synchronize the Cask after a release is published"requirement；ADDED"Clean up app data on uninstall"requirement）。

## Impact

- `scripts/homebrew-publish.sh`（cask heredoc 模板约 131-148 行）、`tests/homebrew/publish.test.mjs`（断言反转与新增断言）。
- 无应用运行时行为变化；tap 侧 cask 内容变化由下个版本发布同步带出，或合并后手动重跑 workflow 提前带出。
- tap README 的安装/升级命令不变（2026-10-24 c7e1837 已统一为 `--cask` 写法）。
