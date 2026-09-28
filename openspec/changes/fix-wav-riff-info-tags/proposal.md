# 修复 WAV RIFF INFO 标签兼容

GitHub Issue: #138

## Why

Issue #128 的 WAV 测试只覆盖 ID3v2 chunk。实际 WAV 也可只包含 RIFF INFO；当前读取与保存都只操作 primary ID3v2 标签，导致 RIFF INFO 元数据打开时显示为空，保存后旧客户端仍看到旧值。

## What Changes

- 支持读取 WAV RIFF INFO 标签；字段级优先使用 ID3v2，缺失字段回退到 RIFF INFO。
- 保存时继续用 ID3v2 承载 WAV 的完整字段、歌词和封面；若原文件含 RIFF INFO，则同步其中可表示的文本字段，防止旧值残留。
- 覆盖 RIFF INFO-only、ID3v2-only、双标签、清空字段和损坏文件场景，并保留其他音频格式行为。

## Impact

- Affected specs: `audio-format-tags`
- Affected code: `src-tauri/src/service/reader.rs`, `src-tauri/src/service/writer.rs`
- Tests: WAV RIFF INFO fixture、摘要/完整读取与保存往返测试
- Issue: #138
