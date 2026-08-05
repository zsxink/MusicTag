# dir-memory Specification

## Purpose
TBD - created by archiving change dir-memory. Update Purpose after archive.
## Requirements
### Requirement: 目录记忆持久化（Rust 侧）

应用 SHALL 将上次打开的文件目录持久化到平台配置目录 `musictag/config.json`（`last_dir` 字段），文件不存在/损坏/目录已删时静默降级为无记忆。

#### Scenario: 读写往返

- **WHEN** 保存一个目录后再次读取
- **THEN** 返回相同目录

#### Scenario: 损坏/缺失降级

- **WHEN** 配置文件不存在或 JSON 损坏
- **THEN** `get_last_dir` 返回 `None`，不 panic、不污染启动

#### Scenario: 目录已删降级

- **WHEN** `last_dir` 指向的目录已被删除
- **THEN** `get_last_dir` 返回 `None`（不打开不存在的目录）

### Requirement: 选择器默认定位

「打开文件夹」原生选择器 SHALL 在有上次目录时默认定位到该目录；无记忆时使用系统默认位置。

#### Scenario: 有记忆定位

- **WHEN** 存在 `last_dir` 且用户打开文件夹选择器
- **THEN** 选择器默认打开在 `last_dir`

#### Scenario: 首次运行系统默认

- **WHEN** 无 `last_dir`（首次运行）
- **THEN** 选择器使用系统默认位置

### Requirement: 启动自动加载

应用启动 SHALL 自动加载上次目录（等价自动点了「打开文件夹」），无记忆/目录已删时保持「未打开文件夹」空态。

#### Scenario: 启动加载上次目录

- **WHEN** 启动且存在有效 `last_dir`
- **THEN** 自动激活该目录并列出歌曲，无需手动点击

#### Scenario: 无记忆空态

- **WHEN** 启动且无 `last_dir`
- **THEN** 保持「未打开文件夹」空态，无异常

### Requirement: 换目录即持久化

应用 SHALL 在每次成功切换目录后更新持久化的 `last_dir`。

#### Scenario: 换目录更新记忆

- **WHEN** 用户打开一个新目录并成功加载
- **THEN** `config.json` 的 `last_dir` 更新为新目录

### Requirement: 不保存编辑状态

目录记忆 SHALL 只记录目录路径，不保存选中歌曲、编辑草稿、搜索候选（V1 无此需求）。

#### Scenario: 仅目录

- **WHEN** 检查 `config.json` 内容
- **THEN** 仅含 `last_dir` 字段

