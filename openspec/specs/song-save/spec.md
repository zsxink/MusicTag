# song-save Specification

## Purpose
TBD - created by archiving change v1-song-save. Update Purpose after archive.
## Requirements
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

### Requirement: 原子写回保留原文件权限

保存音频标签 SHALL 继续使用同目录临时文件 + rename 原子替换，并在替换前把原文件的权限位复制到临时文件。写回成功后，原路径文件的权限位 MUST 与原文件一致；写回失败时原文件内容与权限位 MUST 保持不变。该要求适用于 Unix/macOS 的权限位语义。

#### Scenario: 保存后权限不变

- **WHEN** 用户保存一个权限位为 `0644` 的音频文件（Linux 下以当前用户创建）
- **THEN** 保存成功后该文件的权限位仍为 `0644`

#### Scenario: 非默认权限保持不变

- **WHEN** 用户保存一个权限位为 `0640` 或 `0664` 的音频文件
- **THEN** 保存成功后该文件的权限位保持为保存前的值

#### Scenario: 保存失败不动原文件

- **WHEN** 原子写回在临时文件阶段失败（如目录只读）
- **THEN** 原文件内容与权限位均保持保存前的状态

