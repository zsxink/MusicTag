# pre-release-check Specification

## Purpose
TBD - created by archiving change pre-release-check. Update Purpose after archive.
## Requirements
### Requirement: 首次打开授权确认弹窗

应用首次启动时 SHALL 弹出授权确认窗口，展示协议要点（个人学习用途 / 禁止商用 / 禁止私自销售转卖 / 禁止 AI 转写 / 外部 API 免责声明），用户**同意后才能进入主界面**；拒绝则退出应用。同意状态 SHALL 本地持久化，二次启动不再弹窗。

#### Scenario: 首次启动弹出授权窗口

- **WHEN** 用户首次启动应用（无已同意记录）
- **THEN** 显示授权确认窗口，列出协议要点与「同意并继续」/「拒绝」按钮，主界面不可交互

#### Scenario: 同意后进入主界面并持久化

- **WHEN** 用户点击「同意并继续」
- **THEN** 关闭授权窗口进入主界面，同意状态持久化到本地；再次启动不再弹窗

#### Scenario: 拒绝则退出应用

- **WHEN** 用户点击「拒绝」
- **THEN** 应用退出，不进入主界面

#### Scenario: 已同意后二次启动不弹窗

- **WHEN** 用户已同意过（本地有同意记录）后再次启动
- **THEN** 直接进入主界面，不显示授权窗口

### Requirement: README 协议声明

README SHALL 包含：个人学习用途定位（禁止商用）、不提供任何音频文件/下载、外部 API 基于公开资料免责、个人用途限制、禁止 AI 转写声明（AI 转写作品与软件无关）、软件协议章节（BUSL 1.1 + 禁转卖）、顶部软件图标。

#### Scenario: README 含全部声明

- **WHEN** 阅读 README
- **THEN** 含「个人学习用途、禁止商用」「不提供音频文件/下载」「外部 API 基于公开资料」「禁止 AI 转写」「软件协议（BUSL 1.1）」「icon/musictag.png 图标」

### Requirement: LICENSE 基于 BUSL 1.1 结构

LICENSE SHALL 采用 Business Source License 1.1 结构，含附加使用限制：禁止商用、禁止私自销售/转卖、禁止 AI 转写/再创作、Change Date 2099-12-31。

#### Scenario: LICENSE 含附加限制

- **WHEN** 阅读 LICENSE
- **THEN** 含 BUSL 1.1 结构、Change Date 2099-12-31、禁止私自销售/转卖条款、禁止 AI 转写条款

