# audio-format-tags Specification Delta

## MODIFIED Requirements

### Requirement: 按容器读写标签

应用 SHALL 使用文件实际支持的标签类型读写 APE、WAV 与 M4A 的歌名、作者、专辑、专辑作者、音轨号、年份、流派、歌词和封面。WAV SHALL 支持读取 ID3v2 与 RIFF INFO：字段级优先采用 ID3v2 的非空值，缺失时回退到 RIFF INFO。WAV 保存 SHALL 将完整表单写入 ID3v2；若文件原本含 RIFF INFO，则同步其可表示的字段，且空表单字段 SHALL 从两种标签中清除。RIFF INFO 不支持的歌词和封面继续由 ID3v2 承载。M4A 采用 iTunes ilst，APE 采用 APE 标签；APE SHALL NOT 写入不受支持的 ID3v2 标签。格式可读时的坏标签 SHALL 沿用只读降级行为。

#### Scenario: RIFF INFO-only WAV 读取

- **WHEN** 用户打开只含 RIFF INFO 标签、没有 ID3v2 标签的有效 WAV
- **THEN** 列表摘要和编辑表单显示 RIFF INFO 中可映射的元数据

#### Scenario: RIFF INFO WAV 保存与旧标签同步

- **WHEN** 用户修改只含 RIFF INFO 的 WAV 并保存
- **THEN** 完整表单写入 ID3v2，RIFF INFO 可表示字段同步为表单值，歌词和封面可由 ID3v2 读回

#### Scenario: WAV 双标签优先级与保存

- **WHEN** WAV 同时含 ID3v2 与 RIFF INFO 且同一字段值不同
- **THEN** 非空 ID3v2 值优先，ID3v2 为空时使用 RIFF INFO；保存后两种标签中可表示的字段均与表单一致

#### Scenario: 清空 WAV 字段

- **WHEN** 用户清空某个 RIFF INFO 可表示字段并保存含 RIFF INFO 的 WAV
- **THEN** 该字段从 ID3v2 与 RIFF INFO 中移除，不留下旧值
