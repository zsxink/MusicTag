## MODIFIED Requirements

### Requirement: 内嵌歌词读写
歌词 SHALL 默认写内嵌，按格式分派：FLAC→`LYRICS`，MP3→`USLT`（lang=`eng`），WAV→内嵌 ID3v2 `USLT`（lang=`eng`），APE→APE 标签 `ItemKey::Lyrics`，M4A→`©lyr`；纯文本存储，不做 SYLT，LRC 时间标签 `[00:12.34]` 原样保留在文本中。

#### Scenario: FLAC 内嵌歌词写入
- **WHEN** 保存含歌词的 FLAC
- **THEN** 歌词写入 Vorbis `LYRICS` key

#### Scenario: MP3 内嵌歌词写入
- **WHEN** 保存含歌词的 MP3
- **THEN** 歌词写入 `USLT` 帧且 lang=`eng`

#### Scenario: WAV 内嵌歌词写入
- **WHEN** 保存含歌词的 WAV
- **THEN** 歌词写入内嵌 ID3v2 `USLT` 帧且 lang=`eng`

#### Scenario: APE 内嵌歌词写入
- **WHEN** 保存含歌词的 APE
- **THEN** 歌词写入 APE 标签 `ItemKey::Lyrics`

#### Scenario: M4A 内嵌歌词写入
- **WHEN** 保存含歌词的 M4A
- **THEN** 歌词写入 ilst `©lyr`（`ItemKey::Lyrics`/`UnsyncLyrics`）

#### Scenario: LRC 时间标签原样保留
- **WHEN** 歌词文本含 `[00:12.34]` 时间标签
- **THEN** 原样保留，不做结构化转换（非 SYLT）

#### Scenario: 读回一致
- **WHEN** 对 APE/WAV/M4A 保存歌词后重新打开该歌曲
- **THEN** 歌词文本与保存内容一致，来源展示为「内嵌标签」
