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
应用 MUST 支持启动时检查，但自动检查间隔不得短于 7 天；上次成功检查时间 MUST 持久化。启动时距上次成功检查不足 7 天时 MUST 不发起网络请求；从未成功检查或间隔已满 7 天时才自动检查。网络失败 MUST 不更新时间戳。系统原生应用菜单栏的“帮助”菜单 MUST 提供不受此间隔限制的手动检查入口；检查期间 MUST 有明确状态反馈。

#### Scenario: 用户手动检查
- **WHEN** 用户选择系统原生菜单栏“帮助”→“检查更新…”
- **THEN** 应用开始检查并显示检查中状态，随后展示明确结果，且无论距离上次检查多久均执行检查

#### Scenario: 启动时距离上次成功检查不足一周
- **WHEN** 应用启动且最近一次成功检查时间距当前不足 7 天
- **THEN** 应用不发起更新网络请求

#### Scenario: 启动时从未成功检查或间隔已满
- **WHEN** 应用启动且不存在成功检查时间，或距最近一次成功检查至少 7 天
- **THEN** 应用在不阻塞现有功能的情况下检查更新

#### Scenario: 自动检查失败
- **WHEN** 启动触发的更新检查因网络或服务错误失败
- **THEN** 应用不更新成功检查时间戳，以便后续启动重试

### Requirement: 以非阻塞方式提示新版本
发现新版本时，应用 MUST 以不抢焦点的应用内提示展示版本号，并提供“查看详情”和“稍后”操作；提示 MUST 在 15 秒后自动关闭但保留可用更新状态，允许用户从顶栏提示标记重新打开提示。不得自动打开浏览器、下载或安装。

#### Scenario: 查看 Release 详情
- **WHEN** 用户选择“查看详情”
- **THEN** 应用打开对应 GitHub Release 页面

#### Scenario: 稍后处理
- **WHEN** 用户选择“稍后”
- **THEN** 同一 Release 版本在后续检查中不再重复提示；更高的新 Release 仍可提示，且可用更新状态标记仍可用于重新查看

#### Scenario: 更新提示自动关闭
- **WHEN** 新版本提示显示后经过 15 秒
- **THEN** 提示关闭且顶栏品牌与路径之间显示带有无障碍说明的可用更新标记

#### Scenario: 重新打开更新提示
- **WHEN** 用户激活顶栏可用更新标记
- **THEN** 应用重新显示包含“查看详情”和“稍后”操作的该版本提示

### Requirement: 展示当前版本和最近检查结果
关于或设置界面 MUST 展示当前应用版本和最近一次更新检查结果。

#### Scenario: 查看更新状态
- **WHEN** 用户打开关于或设置界面
- **THEN** 可以查看当前版本以及最近检查的结果，包括可用更新、已是最新或检查失败

### Requirement: 检查结果提示按结果自动关闭
有更新提示 MUST 在 15 秒后自动关闭；无更新提示 MUST 在 5 秒后自动关闭；检查失败提示 MUST 保持显示直至用户手动关闭。

#### Scenario: 无更新自动关闭
- **WHEN** 更新检查显示“已是最新版本”
- **THEN** 提示在 5 秒后自动关闭

#### Scenario: 检查失败保持显示
- **WHEN** 更新检查失败并显示错误提示
- **THEN** 提示不自动关闭，直至用户手动关闭
