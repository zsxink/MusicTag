## MODIFIED Requirements

### Requirement: 字段映射符合业界惯例
标签写入 SHALL 符合业界惯例，按文件格式分派：FLAC 写 Vorbis Comment（封面→PICTURE），MP3 写 ID3v2.4 帧（封面→APIC、歌词→USLT lang=`eng`），APE 写 APE 标签（不写只读的 ID3v2），WAV 写内嵌 ID3v2（与 MP3 同帧路径），M4A 写 iTunes ilst（封面→`covr`、歌词→`©lyr`）；年份各格式统一写 `RecordingDate` 对应键。

#### Scenario: FLAC 字段映射
- **WHEN** 保存 FLAC 文件
- **THEN** 各界面字段写入对应 Vorbis key（§5.1 映射表）

#### Scenario: MP3 统一 ID3v2.4
- **WHEN** 保存 MP3 文件
- **THEN** 写入 ID3v2.4（lofty 默认版本），不使用 `use_id3v23`

#### Scenario: MP3 USLT 语言
- **WHEN** 保存含歌词的 MP3
- **THEN** USLT 帧 lang 为 `eng`（`ItemKey::UnsyncLyrics` + `set_lang(ENGLISH)`）

#### Scenario: APE 写 APE 标签
- **WHEN** 保存 APE 文件
- **THEN** 字段、歌词、封面写入 APE 标签，不创建/不写只读的 ID3v2

#### Scenario: WAV 写内嵌 ID3v2
- **WHEN** 保存 WAV 文件
- **THEN** 字段、歌词、封面写入内嵌 ID3v2（USLT/APIC，与 MP3 同路径）

#### Scenario: M4A 写 ilst
- **WHEN** 保存 M4A（MP4 容器）文件
- **THEN** 字段写入 iTunes ilst（`©lyr` 歌词、`covr` 封面、`©day`→`RecordingDate`）

#### Scenario: 年份统一映射
- **WHEN** 保存任一支持格式且年份字段非空
- **THEN** 年份写入该格式 `RecordingDate` 对应键，读回一致

#### Scenario: 歌词封面往返一致
- **WHEN** 对 APE/WAV/M4A 各保存一次含歌词与封面的表单后重新打开
- **THEN** 歌词文本、封面图与元数据字段与保存内容一致，文件不损坏

#### Scenario: MP3/FLAC 不回归
- **WHEN** 保存 MP3 或 FLAC 文件
- **THEN** 行为与本变更前完全一致
