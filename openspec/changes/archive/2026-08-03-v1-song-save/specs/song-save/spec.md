## ADDED Requirements

### Requirement: 保存 = 表单全量覆盖写回原路径
`save_song` SHALL 把表单此刻全部字段写回当前编辑文件的原路径；留空字段即清空删除（无空字段保护、无自动继承/补全）。

#### Scenario: 保存写回
- **WHEN** 用户点击保存且表单有内容
- **THEN** 全部非空字段写回原文件，空字段被清除

#### Scenario: 写回原路径
- **WHEN** 用户保存一首从文件夹列表打开的歌
- **THEN** 标签写回该文件的原路径，不产生新文件

#### Scenario: 清空即删除
- **WHEN** 用户清空某字段后保存
- **THEN** 该字段从标签中删除（表单全量覆盖语义）

### Requirement: 字段映射符合业界惯例
标签写入 SHALL 符合业界惯例：FLAC 写 Vorbis Comment，MP3 写 ID3v2.4 帧，封面 FLAC→PICTURE / MP3→APIC。

#### Scenario: FLAC 字段映射
- **WHEN** 保存 FLAC 文件
- **THEN** 各界面字段写入对应 Vorbis key（§5.1 映射表）

#### Scenario: MP3 统一 ID3v2.4
- **WHEN** 保存 MP3 文件
- **THEN** 写入 ID3v2.4（lofty 默认版本），不使用 `use_id3v23`

#### Scenario: MP3 USLT 语言
- **WHEN** 保存含歌词的 MP3
- **THEN** USLT 帧 lang 为 `eng`（`ItemKey::UnsyncLyrics` + `set_lang(ENGLISH)`）

### Requirement: 保存状态反馈
顶栏 SHALL 展示保存状态：`dirty` 琥珀、成功绿、失败红并保留内容。

#### Scenario: 编辑即 dirty
- **WHEN** 表单与打开时快照不一致
- **THEN** 顶栏显示「有未保存的修改」（琥珀）

#### Scenario: 保存成功
- **WHEN** 保存写盘成功
- **THEN** 顶栏显示「✓ 已保存」（绿），停留原地

#### Scenario: 保存失败保留可重试
- **WHEN** 保存写盘失败
- **THEN** 表单内容保留、仍可编辑可重试，顶栏显示「✕ 保存失败：原因」，`dirty` 保持 true（绝不假报已保存）

### Requirement: 编辑区撤销
撤销 SHALL 恢复到打开时（`original`）的值，编辑区内撤销（非磁盘级）。

#### Scenario: 撤销恢复
- **WHEN** 用户点击撤销
- **THEN** 表单字段恢复为打开时的值

#### Scenario: 撤销后状态
- **WHEN** 撤销到与打开时一致
- **THEN** `dirty` 为 false
