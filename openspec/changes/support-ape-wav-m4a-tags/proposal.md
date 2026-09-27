## Why

Issue #128：MusicTag 目前只收集 FLAC 与 MP3，无法逐首补全本地 APE、WAV 与 M4A 音频文件的标签。lofty 0.24 已支持这些容器，但文件发现、标签类型分支和读写往返需要核实并补齐。

## What Changes

- 扩展文件夹深度遍历的音频文件识别，纳入 APE、WAV 与 M4A 对应扩展名，扩展名大小写不敏感。
- 核实并补齐 APE、WAV、M4A 的标签读取与写入映射，覆盖歌曲字段、年份、歌词和封面。
- 保持一次一首、表单全量覆盖、原文件直接写回、坏标签只读及 MP3 写 ID3v2.4 的既有约束；APE 不写不受支持的 ID3v2。
- 同步 PRD 与技术设计中的格式支持和标签写入说明。

## Capabilities

### New Capabilities

- `audio-format-tags`: APE、WAV、M4A 音频文件发现及标签读写。

### Modified Capabilities

- 无。

## 关联 Issue

GitHub Issue：`#128`（分支提交使用 `feat(128): ...`，PR 使用 `Closes #128`）。

## Impact

- Rust：`meta.rs` 文件类型识别与标签映射；reader/writer 的 tag type 选择和 round-trip。
- 文档：`docs/V1-PRD.md`、`docs/design/design.md`。
- 测试：新增三种格式的样例文件读写往返，并回归 FLAC/MP3。

## 验证基线

Rust check/test、前端 test/build 与 OpenSpec strict 校验；测试文件类型识别大小写、字段映射、歌词/封面/年份往返和既有格式回归。
