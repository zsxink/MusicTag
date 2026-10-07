# update-check Specification

## Purpose
Define how MusicTag checks stable GitHub Releases, reports update status, and lets users inspect releases without automatic installation.
## Requirements
### Requirement: 检查 GitHub 正式版更新
应用 MUST 从项目 GitHub Releases 获取最新正式版，并与当前应用版本比较；草稿和预发布版本 MUST 被忽略。

#### Scenario: 存在正式版更新
- **WHEN** GitHub Releases 中存在高于当前版本的正式版
- **THEN** 检查结果包含版本号与对应 Release 页面入口

#### Scenario: 没有更新
- **WHEN** 没有高于当前版本的正式版
- **THEN** 检查结果明确显示当前已是最新版本

#### Scenario: 检查失败
- **WHEN** 网络请求失败或 GitHub 暂不可用
- **THEN** 检查结果显示可理解的失败状态且不影响应用现有功能

### Requirement: 支持手动和启动时检查
应用 MUST 支持启动时检查，并在系统原生应用菜单栏的“帮助”菜单提供手动检查入口；检查期间 MUST 有明确状态反馈。

#### Scenario: 用户手动检查
- **WHEN** 用户选择系统原生菜单栏“帮助”→“检查更新…”
- **THEN** 应用开始检查并显示检查中状态，随后展示明确结果

#### Scenario: 应用启动
- **WHEN** 应用启动
- **THEN** 应用在不阻塞现有功能的情况下检查更新

### Requirement: 以非阻塞方式提示新版本
发现新版本时，应用 MUST 以不抢焦点的应用内提示展示版本号，并提供“查看详情”和“稍后”操作；不得自动打开浏览器、下载或安装。

#### Scenario: 查看 Release 详情
- **WHEN** 用户选择“查看详情”
- **THEN** 应用打开对应 GitHub Release 页面

#### Scenario: 稍后处理
- **WHEN** 用户选择“稍后”
- **THEN** 同一 Release 版本在后续检查中不再重复提示；更高的新 Release 仍可提示

### Requirement: 展示当前版本和最近检查结果
关于或设置界面 MUST 展示当前应用版本和最近一次更新检查结果。

#### Scenario: 查看更新状态
- **WHEN** 用户打开关于或设置界面
- **THEN** 可以查看当前版本以及最近检查的结果，包括可用更新、已是最新或检查失败
