# folder-list Specification

## Purpose
TBD - created by archiving change v1-folder-list. Update Purpose after archive.
## Requirements
### Requirement: 打开文件夹
「打开文件夹」按钮 SHALL 位于左侧栏顶部，支持快捷键 `⌘O`（Win/Linux: `Ctrl+O`）弹出系统原生文件夹选择器，选择后深度遍历收集全部 FLAC/MP3。

#### Scenario: 点击按钮选择文件夹
- **WHEN** 用户点击「打开文件夹」按钮
- **THEN** 弹出系统原生文件夹选择器

#### Scenario: 快捷键打开
- **WHEN** 用户按 `⌘O`（Win/Linux: `Ctrl+O`）
- **THEN** 弹出系统原生文件夹选择器

#### Scenario: 深度遍历收集音频
- **WHEN** 用户选择含子目录的文件夹，其中含 `.flac`/`.mp3`（任意大小写扩展名）
- **THEN** 递归收集全部匹配音频文件，返回其 `path`/`title`/`artist`

#### Scenario: 非音频文件忽略
- **WHEN** 文件夹内含 `.wav`/`.txt` 等非 `.flac`/`.mp3` 文件
- **THEN** 这些文件不进入列表

#### Scenario: 顶栏显示路径
- **WHEN** 用户成功打开文件夹
- **THEN** 顶栏显示当前文件夹绝对路径

### Requirement: 重新打开整体替换列表
重新打开文件夹时 SHALL 用新结果整体替换当前列表。

#### Scenario: 换目录重置列表
- **WHEN** 用户打开另一个文件夹
- **THEN** 列表整体替换为新目录的音频列表

### Requirement: 展平列表展示
左侧栏 SHALL 以展平列表展示歌曲，每行显示作者 + 歌名；title/artist 为空时回退显示文件名（去扩展名）。

#### Scenario: 正常行显示作者歌名
- **WHEN** 歌曲有非空 title/artist
- **THEN** 行内显示「作者 - 歌名」

#### Scenario: 空标签回退文件名
- **WHEN** 歌曲 title 或 artist `trim()` 后为空（由前端判定，Rust 侧不 trim）
- **THEN** 该行回退显示文件名（去扩展名）

### Requirement: 搜索过滤与排序
顶部搜索框 SHALL 按歌名/作者模糊过滤，默认按文件名升序排序。

#### Scenario: 搜索过滤
- **WHEN** 用户在搜索框输入关键词
- **THEN** 列表过滤为歌名或作者包含该词的歌曲

#### Scenario: 默认排序
- **WHEN** 列表展示
- **THEN** 默认按文件名升序排列

#### Scenario: 空态提示
- **WHEN** 文件夹为空或搜索无匹配
- **THEN** 显示空状态提示（无匹配列表项）

### Requirement: 选中歌曲行
点击行 SHALL 选中该歌曲，选中行高亮。

#### Scenario: 点击选中
- **WHEN** 用户点击列表某一行
- **THEN** 该行被选中并高亮（琥珀选中态）

