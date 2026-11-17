## ADDED Requirements

### Requirement: 标签写入阶段遇到异常标签状态返回错误

保存 WAV 且原文件含 RIFF INFO 标签时，若在清空/写入阶段该标签不再可访问，SHALL 返回中文错误，不通过 `expect` panic；原子写回语义保持“失败时原文件零触碰”。

#### Scenario: RIFF INFO 写入阶段不可访问

- **WHEN** 保存含 RIFF INFO 的 WAV，且 `tag_mut(TagType::RiffInfo)` 在写入阶段返回 `None`
- **THEN** `save_song` 返回中文错误，不写盘，原文件内容与权限位不变

#### Scenario: 正常 WAV 保存不变

- **WHEN** RIFF INFO 可正常访问，表单字段按既有规则写入 ID3v2 与 RIFF INFO
- **THEN** 保存结果与现有行为一致，MP3 仍写 ID3v2.4
