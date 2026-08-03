# lyrics-lrc Specification

## Purpose
TBD - created by archiving change v1-lyrics-lrc. Update Purpose after archive.
## Requirements
### Requirement: 内嵌歌词读写
歌词 SHALL 默认写内嵌：FLAC→`LYRICS`，MP3→`USLT`（lang=`eng`）；纯文本存储，不做 SYLT，LRC 时间标签 `[00:12.34]` 原样保留在文本中。

#### Scenario: FLAC 内嵌歌词写入
- **WHEN** 保存含歌词的 FLAC
- **THEN** 歌词写入 Vorbis `LYRICS` key

#### Scenario: MP3 内嵌歌词写入
- **WHEN** 保存含歌词的 MP3
- **THEN** 歌词写入 `USLT` 帧且 lang=`eng`

#### Scenario: LRC 时间标签原样保留
- **WHEN** 歌词文本含 `[00:12.34]` 时间标签
- **THEN** 原样保留，不做结构化转换（非 SYLT）

### Requirement: 读取优先级内嵌优先，无内嵌关联侧载 .lrc
读取歌词时 SHALL 内嵌优先；无内嵌时自动关联同目录同名 `.lrc`（去扩展名同名），并展示来源（内嵌标签/侧载 .lrc/无）。

#### Scenario: 内嵌优先
- **WHEN** 歌曲内嵌歌词非空且同目录也有同名 `.lrc`
- **THEN** 读取内嵌歌词，来源为「内嵌标签」

#### Scenario: 侧载关联
- **WHEN** 歌曲无内嵌歌词但同目录存在同名 `.lrc`
- **THEN** 读取 `.lrc` 内容，来源为「侧载 .lrc」

#### Scenario: 无歌词
- **WHEN** 歌曲无内嵌歌词且无同名 `.lrc`
- **THEN** 歌词区为空，来源为「无」

### Requirement: 复选框控制同步写 .lrc
「同时保存为 .lrc」复选框 SHALL 默认不勾选（opt-in）；勾选时保存歌词同步写同目录同名 `.lrc`；歌词为空时忽略复选框不生成空 `.lrc`。

#### Scenario: 默认不勾选
- **WHEN** 打开歌词区
- **THEN** 「同时保存为 .lrc」复选框默认不勾选

#### Scenario: 勾选同步写
- **WHEN** 用户勾选复选框且歌词非空后保存
- **THEN** 同目录生成同名 `.lrc`（音频文件去扩展名），内容为当前歌词文本

#### Scenario: 空歌词不写
- **WHEN** 歌词为空但复选框勾选后保存
- **THEN** 不生成空 `.lrc` 文件（忽略复选框）

#### Scenario: 取消勾选不写
- **WHEN** 用户取消勾选复选框后保存歌词
- **THEN** 不写 `.lrc`（仅写内嵌）

### Requirement: 内嵌 + .lrc 并存同步更新
内嵌 + `.lrc` 并存时 SHALL 以当前编辑内容为准，两边一起更新。

#### Scenario: 并存同步
- **WHEN** 歌曲既有内嵌歌词又有同名 `.lrc`，编辑后保存
- **THEN** 内嵌与 `.lrc` 都用当前编辑内容更新

