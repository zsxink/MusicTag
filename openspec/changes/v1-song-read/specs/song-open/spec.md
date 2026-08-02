## ADDED Requirements

### Requirement: 选中歌曲读取完整标签
选中列表一行后，SHALL 调用 `open_song` 读取该曲完整标签（10 字段 + 歌词 + 封面）并渲染进右栏编辑表单。

#### Scenario: 选中读取全量
- **WHEN** 用户选中列表中的一首歌
- **THEN** 调用 `open_song(path)` 读取完整标签并渲染到编辑表单，包括封面 base64 预览

#### Scenario: 按需读取
- **WHEN** 列表首扫或未选中任何歌曲
- **THEN** 不执行 `open_song`，不读全量标签/封面

### Requirement: 编辑状态模型
store SHALL 持有 `current`（编辑中）/`original`（打开时快照），`dirty` 由对比 computed 得出。

#### Scenario: dirty 标记
- **WHEN** 编辑表单任一字段与打开时快照不一致
- **THEN** `dirty` 为 true

#### Scenario: 打开即干净
- **WHEN** 刚打开一首歌且未编辑
- **THEN** `dirty` 为 false

### Requirement: 坏标签只读
`open_song` 读标签失败（损坏/结构错）时，SHALL 使表单只读禁用（能看不能改、不能保存）并提示「标签损坏，只读」。

#### Scenario: 坏标签禁用
- **WHEN** `open_song` 对损坏标签文件读取失败
- **THEN** 表单只读禁用，展示「标签损坏，只读」提示，不进入可编辑状态

### Requirement: 封面以 base64 data URL 传输
`Song.cover` SHALL 在 IPC 边界序列化为 base64 data URL（`data:image/<mime>;base64,...`），前端 `<img :src>` 直接用。

#### Scenario: 封面预览
- **WHEN** 歌曲含内嵌封面
- **THEN** 前端以 data URL 渲染封面预览

#### Scenario: 无封面
- **WHEN** 歌曲无内嵌封面
- **THEN** `cover` 为 null，封面区显示空态占位
