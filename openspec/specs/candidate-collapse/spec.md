# candidate-collapse Specification

## Purpose
TBD - created by archiving change candidate-collapse. Update Purpose after archive.
## Requirements
### Requirement: 歌词候选区可折叠

歌词候选区 SHALL 提供「隐藏候选 ▲ / 展开候选 ▼」折叠按钮；默认展开，收起后候选区整体隐藏（搜索状态/候选列表/空态/离线提示均不可见），再次点击展开恢复。

#### Scenario: 默认展开

- **WHEN** 歌词候选区有内容（搜索中/有候选/空态/离线）
- **THEN** 候选区默认可见，折叠按钮文案「隐藏候选 ▲」

#### Scenario: 收起候选区

- **WHEN** 点击「隐藏候选 ▲」
- **THEN** 候选区整体隐藏（`v-show` 保留 DOM），按钮文案「展开候选 ▼」

#### Scenario: 重新展开

- **WHEN** 点击「展开候选 ▼」
- **THEN** 候选区恢复显示，按钮文案「隐藏候选 ▲」

### Requirement: 封面候选区可折叠

封面候选区 SHALL 提供与歌词候选区同语义的折叠按钮。

#### Scenario: 封面默认展开

- **WHEN** 封面候选区有内容
- **THEN** 候选网格默认可见，折叠按钮「隐藏候选 ▲」

#### Scenario: 封面收起/展开

- **WHEN** 点击折叠按钮
- **THEN** 候选网格隐藏/恢复，按钮文案随状态切换

### Requirement: 折叠偏好跨切歌保持

折叠偏好 SHALL 跨切歌保持——用户收起候选区后，切歌不自动展开（组件局部 ref，不随搜索状态重置清理），直到用户手动展开；换目录/坏标签只读（面板卸载）后重新选歌默认展开。

#### Scenario: 切歌保持折叠

- **WHEN** 用户收起候选区后切换到另一首歌（候选生命周期重置）
- **THEN** 新歌的候选区仍保持收起状态（不自动展开）

#### Scenario: 换目录/只读后默认展开

- **WHEN** 用户收起候选区后换目录（或打开坏标签只读歌），再重新选歌
- **THEN** 候选区折叠状态重置为默认展开

### Requirement: 按钮仅在候选区有内容时显示

折叠按钮 SHALL 仅在候选区「有内容」时显示（搜索中/有候选/空态/离线提示），候选区无任何内容时不显示按钮、不占位。

#### Scenario: 无内容不显示按钮

- **WHEN** 候选区空闲（idle 且无候选/无搜索/非离线）
- **THEN** 不显示折叠按钮，布局无额外占位

