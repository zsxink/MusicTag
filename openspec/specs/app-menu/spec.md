# app-menu Specification

## Purpose
TBD - created by archiving change issue-170. Update Purpose after archive.
## Requirements
### Requirement: 跨平台提供一致的原生应用菜单
应用 MUST 在 macOS、Windows 和 Linux 提供文件、编辑、视图、帮助菜单。菜单动作仅调用应用既有能力；macOS MUST 保留系统应用菜单，Windows 和 Linux 不要求该首项。

#### Scenario: 三端显示应用菜单
- **WHEN** 应用在 macOS、Windows 或 Linux 启动
- **THEN** 文件菜单提供打开文件夹、保存、重新扫描当前文件夹和关闭窗口/退出，编辑菜单提供撤销、重做、剪切、复制、粘贴和全选，视图菜单提供浅色/深色切换、重新加载及开发构建下的开发者工具，帮助菜单提供检查更新和关于

#### Scenario: macOS 系统应用菜单
- **WHEN** 应用在 macOS 显示菜单栏
- **THEN** 系统应用菜单保留 About、Services、Hide 和 Quit 项

### Requirement: 菜单动作遵循应用状态
应用 MUST 根据相关应用状态更新菜单项启用状态；不可执行的动作 MUST 禁用，触发动作 MUST 复用对应既有功能。

#### Scenario: 无可保存歌曲
- **WHEN** 当前没有可编辑的选中歌曲
- **THEN** 保存菜单项处于禁用状态

#### Scenario: EULA 未同意
- **WHEN** 用户尚未同意 EULA
- **THEN** 关于菜单项不可触发

#### Scenario: 用户触发菜单动作
- **WHEN** 用户选择可用的原生菜单项
- **THEN** 原生端通过通用 `app-menu-action` 事件发送稳定 action 标识，前端分发至相应既有能力

