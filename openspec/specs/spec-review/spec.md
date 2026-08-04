# spec-review Specification

## Purpose
TBD - created by archiving change spec-review. Update Purpose after archive.
## Requirements
### Requirement: 四源对同一功能的描述不矛盾

四源（docs/V1-PRD.md、docs/design/design.md、openspec/specs/ 主规格、记忆 music-tag-v1-spec.md）对同一产品行为的描述 SHALL 一致，不存在陈旧、矛盾或遗漏。复核范围须覆盖：Tauri command 契约、搜索联动（FR-8）、保存/封面/歌词语义（FR-5/FR-4）、离线降级规则。

#### Scenario: Tauri command 契约清单一致

- **WHEN** 四源各自列出的 Tauri command 清单与签名（list_songs、open_song、save_song(song, exportLrc)、rename_song、search_song、search_source、fetch_lyric、download_cover、pick_cover_file、read_cover_path）
- **THEN** 四源对 command 清单、签名与「无独立 embed_cover」的说明完全一致；已废弃的 command 不在任何源中出现

#### Scenario: 搜索联动行为描述一致

- **WHEN** 复核 FR-8 相关描述（选中即搜仅一次、只补缺失项、删除后不再触发、候选切歌即弃、离线降级失败首响、取词失败 C2 换源）
- **THEN** 四源对上述行为的描述一致，无互相矛盾

#### Scenario: 保存与歌词语义一致

- **WHEN** 复核 FR-5（保存=表单全量覆盖、写回原路径、保存失败保留可重试）与 FR-4（内嵌优先、.lrc 复选框默认不勾选、空歌词不写 .lrc、改名同步 .lrc）
- **THEN** 四源描述一致，无冲突

### Requirement: 复核报告有记录

复核过程 SHALL 产出可追溯的复核报告，逐条列出「修订前 → 修订后」的差异记录（含所在文件与行/章节位置），作为本变更的验收依据。

#### Scenario: 复核报告逐条记录差异

- **WHEN** 四源复核发现一处不一致
- **THEN** 复核报告中记录该处的源文件、修订前内容、修订后内容与修订理由

#### Scenario: 差异记录可追溯

- **WHEN** 检查复核报告
- **THEN** 每条差异记录都能对应到一处实际修订（或说明「仅报告、不修订」的理由）

### Requirement: 修订后规格仍可通过验证

所有修订完成后 SHALL 运行 openspec validate，保证规格结构合法；涉及代码侧契约的行文修订不得与已实现代码冲突。

#### Scenario: openspec validate 通过

- **WHEN** 完成全部修订
- **THEN** `openspec validate` 通过，无结构错误

#### Scenario: 修订与代码现状不冲突

- **WHEN** 修订 docs/openspec 中关于 command 契约的描述
- **THEN** 描述与当前 src-tauri/src/lib.rs 注册的 command 清单、src/api/ 封装一致

### Requirement: 修订不引入新的产品行为

本变更 SHALL 只修一致性/陈旧点，不新增、不删除、不改变任何产品行为（不新增 command、不改变保存语义、不改变搜索联动）。

#### Scenario: 行为无变化

- **WHEN** 对比修订前后的 specs 描述
- **THEN** 产品行为描述不发生变化，仅陈旧/矛盾/遗漏被修正

#### Scenario: 无应用代码改动

- **WHEN** 检查变更 diff
- **THEN** src-tauri/src/ 与 src/ 下无应用代码改动，只改 docs、openspec、记忆
