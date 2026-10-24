## Why

GitHub Issue: #179

#176（PR #178）交付的 livecheck 在 tap 同步后实测不可用：`brew livecheck musictag` 报 "`url :stable` does not reference a checkable URL"。根因是 cask stable URL 为 `arch` 模板化形式（`MusicTag_#{version}_#{arch}.dmg`），当前 Homebrew livecheck 无法解析；同 tap markflow cask 同样报错，证明 #176 设计时引用的范例本身即坏。修复方案已在本地 tap 实测验证（显式 URL 后 livecheck 正常返回 `musictag: 0.1.5 ==> 0.1.5`）。

## What Changes

- cask 模板 livecheck 块：`url :stable` 改为显式 `url "https://github.com/zsxink/MusicTag/releases/latest"`，`strategy :github_latest` 不变。
- `tests/homebrew/publish.test.mjs`：`url :stable` 正向断言同步改为显式 URL；其余断言不动。
- 合并后重跑 Homebrew Tap workflow（tag=v0.1.5）同步 tap，验收 `brew livecheck musictag` 可用且 `brew audit` 通过。

## Capabilities

### Modified Capabilities

- `homebrew-release`：MODIFIED"Synchronize the Cask after a release is published"——livecheck URL 表述由"stable URL"改为显式 latest-releases URL；四个场景语义不变（Tap lags 场景行为由不可用变为可用）。

## Impact

- `scripts/homebrew-publish.sh`（cask heredoc 模板一行）、`tests/homebrew/publish.test.mjs`（一条断言）。
- 无其他行为变化；uninstall/zap 段、发布护栏、tap README 均不动。
