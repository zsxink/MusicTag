# ux-settings Specification

## Purpose
TBD - created by archiving change v1-ux-settings. Update Purpose after archive.
## Requirements
### Requirement: 切歌未保存确认
有未保存修改时切歌 SHALL 弹出模态弹窗「保存对 `<文件名>` 的修改吗？」，提供 保存（先写再切）/不保存（丢弃切换）/取消（留在当前）三按钮。

#### Scenario: 保存再切
- **WHEN** 有未保存修改时切歌，用户点「保存」
- **THEN** 先保存当前歌曲再切换到目标歌

#### Scenario: 不保存切换
- **WHEN** 有未保存修改时切歌，用户点「不保存」
- **THEN** 丢弃修改并切换到目标歌

#### Scenario: 取消留在当前
- **WHEN** 有未保存修改时切歌，用户点「取消」
- **THEN** 留在当前歌曲，不切换

#### Scenario: 无修改直接切
- **WHEN** 无未保存修改时切歌
- **THEN** 直接切换，不弹窗

### Requirement: 换目录未保存确认复用
换目录有未保存修改时 SHALL 复用同一三选一弹窗；取消则不换目录；保存写当前编辑歌原路径。

#### Scenario: 换目录取消
- **WHEN** 有未保存修改时换目录，用户点「取消」
- **THEN** 不换目录，保持当前状态

#### Scenario: 换目录保存
- **WHEN** 有未保存修改时换目录，用户点「保存」
- **THEN** 保存当前编辑歌到原路径，再替换列表

### Requirement: 双主题
应用 SHALL 以深色为默认（防启动闪白），浅色跟随系统 `prefers-color-scheme`；顶栏最右主题按钮手动切换（☀️/🌙），手动选择持久记忆（重启保持），未手动选择时跟随系统。

#### Scenario: 深色默认
- **WHEN** 应用启动且系统无浅色偏好
- **THEN** 使用深色主题（`--bg:#12161A` 等）

#### Scenario: 浅色跟随系统
- **WHEN** 系统偏好浅色且用户未手动选择
- **THEN** 使用浅色主题

#### Scenario: 手动切换
- **WHEN** 用户点击顶栏主题按钮
- **THEN** 主题在深浅之间切换，按钮图标对应 ☀️/🌙

#### Scenario: 重启记忆
- **WHEN** 用户手动选择过主题后重启应用
- **THEN** 沿用上次手动选择；未手动选择时继续跟随系统

