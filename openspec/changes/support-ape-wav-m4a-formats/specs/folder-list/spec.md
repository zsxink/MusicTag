## MODIFIED Requirements

### Requirement: 打开文件夹
「打开文件夹」按钮 SHALL 位于左侧栏顶部，支持快捷键 `⌘O`（Win/Linux: `Ctrl+O`）弹出系统原生文件夹选择器，选择后深度遍历收集全部 FLAC/MP3/APE/WAV/M4A 音频。

#### Scenario: 点击按钮选择文件夹
- **WHEN** 用户点击「打开文件夹」按钮
- **THEN** 弹出系统原生文件夹选择器

#### Scenario: 快捷键打开
- **WHEN** 用户按 `⌘O`（Win/Linux: `Ctrl+O`）
- **THEN** 弹出系统原生文件夹选择器

#### Scenario: 深度遍历收集音频
- **WHEN** 用户选择含子目录的文件夹，其中含 `.flac`/`.mp3`/`.ape`/`.wav`/`.m4a`（以及纳入范围的 m4a 容器扩展名，任意大小写）文件
- **THEN** 递归收集全部匹配音频文件，返回其 `path`/`title`/`artist`

#### Scenario: 非音频文件忽略
- **WHEN** 文件夹内含 `.txt`/`.jpg` 等非音频文件
- **THEN** 这些文件不进入列表

#### Scenario: 新格式进入列表
- **WHEN** 文件夹内含 `.ape`/`.wav`/`.m4a` 文件
- **THEN** 这些文件与 `.flac`/`.mp3` 一样进入列表

#### Scenario: 顶栏显示路径
- **WHEN** 用户成功打开文件夹
- **THEN** 顶栏显示当前文件夹绝对路径
