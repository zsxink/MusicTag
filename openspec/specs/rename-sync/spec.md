# rename-sync Specification

## Purpose
TBD - created by archiving change v1-rename-sync. Update Purpose after archive.
## Requirements
### Requirement: 改名同步 .lrc
改文件名时 SHALL 若存在同名 `.lrc` 一并改名。

#### Scenario: 音频改名同步 .lrc
- **WHEN** 用户把 `歌.mp3` 改名为 `新歌.mp3`，且存在 `歌.lrc`
- **THEN** `歌.mp3` 与 `歌.lrc` 一并改名为 `新歌.mp3`/`新歌.lrc`

#### Scenario: 无 .lrc 不影响
- **WHEN** 用户改名的音频无同名 `.lrc`
- **THEN** 仅音频改名

### Requirement: 纯扩展名变化不影响 .lrc 名
`.lrc` 名 SHALL 等于去扩展名主干同名，改扩展名不触发 `.lrc` 改名。

#### Scenario: 扩展名变化不改 .lrc
- **WHEN** 用户把 `歌.mp3` 改为 `歌.flac`，存在 `歌.lrc`
- **THEN** `.lrc` 仍为 `歌.lrc`，不随之改名（主干未变）

### Requirement: 撞名拒绝覆盖

目标文件名已存在时 SHALL 拒绝覆盖并提示，不静默覆盖。存在性判断 SHALL 使用 `fs::symlink_metadata`（或等价语义），把普通文件、目录和符号链接（含悬空符号链接）统一视为“已存在”；元数据检查本身失败时 SHALL 返回中文错误，不视为“可写”。所有检查 SHALL 在第一次 `fs::rename` 之前完成，音频与目标 `.lrc` 均检查后才可改名。

#### Scenario: 音频撞名拒绝

- **WHEN** 改名目标文件名已存在（同名普通文件）
- **THEN** 拒绝改名并提示「目标已存在」，原文件不变

#### Scenario: 悬空符号链接撞名拒绝

- **WHEN** 改名目标名是一个指向不存在路径的符号链接
- **THEN** 预检判定为撞名并拒绝，不替换该符号链接，原音频与 `.lrc` 均不变

#### Scenario: .lrc 撞名拒绝

- **WHEN** 改名会使 `.lrc` 落入已存在的目标（普通文件或符号链接）
- **THEN** 拒绝改名并提示，不覆盖任何目标

#### Scenario: 存在性检查失败

- **WHEN** `symlink_metadata` 因权限等非 `NotFound` 错误失败
- **THEN** 返回中文错误，不执行任何 rename，原文件保持原样

#### Scenario: 改名失败原文件保留

- **WHEN** 改名因目标存在、符号链接占用或权限失败
- **THEN** 返回错误，原文件保持原样，用户换名重试

