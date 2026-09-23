## MODIFIED Requirements

### Requirement: 统一封面路径
本地选择/网络下载 SHALL 统一为「获得 bytes → 封面区」，`save_song` 统一嵌入，按格式分派：FLAC→PICTURE、MP3→APIC、WAV→内嵌 ID3v2 APIC、M4A→`covr`、APE→APE 标签封面条目（Cover Art front）；封面区预览即压缩后小图，原图丢弃。

#### Scenario: 统一写盘
- **WHEN** 封面区有一张预览图（无论来源本地/网络）
- **THEN** 保存时经 `save_song` 统一嵌入对应格式的封面条目（原始字节）

#### Scenario: M4A 封面写入
- **WHEN** 保存含封面的 M4A
- **THEN** 封面写入 ilst `covr`，重新打开可预览

#### Scenario: WAV 封面写入
- **WHEN** 保存含封面的 WAV
- **THEN** 封面写入内嵌 ID3v2 APIC，重新打开可预览

#### Scenario: APE 封面写入
- **WHEN** 保存含封面的 APE
- **THEN** 封面写入 APE 标签封面条目，重新打开可预览
