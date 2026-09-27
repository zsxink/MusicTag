# audio-format-tags Specification

## Purpose

允许用户通过现有单曲编辑流程，为 APE、WAV、M4A 音频文件读取、补全并保存元数据，兼容无标签文件和已有受支持标签的文件。

## ADDED Requirements

### Requirement: 支持音频格式发现

文件夹深度遍历 SHALL 在现有 FLAC、MP3 格式之外识别 `.ape`、`.wav`、`.m4a` 扩展名，扩展名匹配不区分大小写。通用 `.mp4` 扩展名 SHALL NOT 被收集，因为它无法仅凭扩展名与视频区分。识别出的文件继续使用现有列表摘要和单曲打开流程。

#### Scenario: 遍历收集新格式

- **WHEN** 用户打开包含 APE、WAV 或 M4A 音频文件（扩展名大小写可变）的文件夹
- **THEN** 文件出现在歌曲列表并可通过现有单曲编辑流程打开

#### Scenario: 保持已有格式

- **WHEN** 用户打开包含 FLAC、MP3 及新增格式的文件夹
- **THEN** 五种格式均可被收集，原有排序和摘要行为保持一致

#### Scenario: 排除通用 MP4 容器

- **WHEN** 用户打开包含 `.mp4` 文件的文件夹
- **THEN** `.mp4` 文件不作为音频歌曲收集

### Requirement: 按容器读写标签

应用 SHALL 使用文件实际支持的标签类型读写 APE、WAV 与 M4A 的歌名、作者、专辑、专辑作者、音轨号、年份、流派、歌词和封面。WAV 采用其支持的 ID3v2 或 RIFF INFO 标签，M4A 采用 iTunes ilst，APE 采用 APE 标签；APE SHALL NOT 写入不受支持的 ID3v2 标签。格式可读时的坏标签 SHALL 沿用只读降级行为。

#### Scenario: APE 标签往返

- **WHEN** 用户打开有效 APE 文件、修改表单字段并保存
- **THEN** 支持的文本字段、年份、歌词和封面写入 APE 标签，重读后与保存值一致，文件中未写入 ID3v2

#### Scenario: WAV 标签往返

- **WHEN** 用户打开有效 WAV 文件、修改表单字段并保存
- **THEN** 支持的文本字段、年份、歌词和封面写入 WAV 支持的标签，重读后与保存值一致

#### Scenario: M4A 标签往返

- **WHEN** 用户打开有效 M4A 文件、修改表单字段并保存
- **THEN** 支持的文本字段、年份、歌词和封面写入 iTunes ilst，重读后与保存值一致

#### Scenario: 坏标签只读

- **WHEN** 新增格式的文件标签读取失败或结构损坏
- **THEN** 文件沿用现有只读降级行为，不能保存标签

### Requirement: 保持单曲保存边界

新增格式 SHALL 遵循现有单曲保存契约：表单全量覆盖、空字段删除、直接写回原文件；MP3 SHALL 继续写 ID3v2.4。

#### Scenario: 全量覆盖与清空

- **WHEN** 用户保存新增格式的歌曲表单
- **THEN** 非空表单值被写入，空字段从对应标签中删除，文件原路径被更新

#### Scenario: 现有格式不回归

- **WHEN** 用户保存 MP3 歌曲
- **THEN** 写入仍为 ID3v2.4，既有 MP3 与 FLAC 标签读写行为保持一致
