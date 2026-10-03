# cover-embed Specification

## Purpose
TBD - created by archiving change v1-cover-embed. Update Purpose after archive.

## Requirements

### Requirement: 点击选择图片嵌入封面
封面区 SHALL 支持点击选择图片文件，选中的图片作为封面进入封面区预览。

#### Scenario: 点击选择
- **WHEN** 用户点击封面区
- **THEN** 弹出系统文件选择器，选择图片后封面区预览该图

#### Scenario: 支持常见图片格式
- **WHEN** 用户选择 JPEG/PNG 图片
- **THEN** 封面区正确预览，mime 被探测

### Requirement: 拖拽嵌入封面
封面区 SHALL 支持拖拽图片文件嵌入。

#### Scenario: 拖拽文件到封面区
- **WHEN** 用户拖拽一个图片文件到封面区
- **THEN** 封面区预览该图，作为候选封面

### Requirement: 封面自动压缩
嵌入前 SHALL 对 >5MB 图片自动等比缩至 ≤2048×2048 避免元数据膨胀；封面区预览压缩后小图，进标签的是压缩图。

#### Scenario: 大图压缩
- **WHEN** 用户选择一张 >5MB 的大图
- **THEN** 等比缩至 ≤2048×2048，封面区预览压缩后小图

#### Scenario: 小图不放大
- **WHEN** 用户选择的图片 ≤2048×2048
- **THEN** 不放大，原尺寸保留嵌入

### Requirement: 统一封面路径
本地选择/网络下载 SHALL 统一为「获得 bytes → 封面区」，`save_song` 统一嵌入；封面区预览即压缩后图，原图丢弃。

#### Scenario: 统一写盘
- **WHEN** 封面区有一张预览图（无论来源本地/网络）
- **THEN** 保存时经 `save_song` 统一嵌入 PICTURE/APIC（原始字节）

### Requirement: 右键导出内嵌封面原图

封面区 SHALL 提供一个**只读**导出动作：用户在封面预览图上右键时弹出含「导出封面…」的菜单项，点选后经原生存盘对话框把该歌曲标签内第一个 front cover 的**原始字节**写到用户选定路径。导出 SHALL NOT 修改标签任何字段、SHALL NOT 改变编辑表单状态，且 `save_song` 行为 SHALL 保持不变。导出字节 SHALL 取自标签内嵌图片本身（lofty `Picture::data()`），SHALL NOT 使用前端 ≤2048 压缩预览图——前端跨 IPC 只传源路径与目标路径，图片字节在 Rust 侧内侧出侧写。该流程由两个 command 承载：先 `pick_cover_save_path` 取目标路径（用户取消则流程终止且无任何副作用），再 `export_cover` 写盘。

#### Scenario: 右键打开导出菜单

- **WHEN** 用户在有内嵌封面的歌曲的封面预览图上右键
- **THEN** 弹出含「导出封面…」的菜单项，该项可点击

#### Scenario: 导出字节与标签内图片一致

- **WHEN** 用户点「导出封面…」并在存盘对话框确认目标路径
- **THEN** 目标文件字节与该歌曲标签内第一个 front cover 的原始字节完全一致（非压缩预览图，保留原始质量与格式），APE 文件走既有 APE 封面回退路径取图

#### Scenario: 默认文件名基于音频文件名

- **WHEN** 存盘对话框打开
- **THEN** 默认文件名为音频文件名去扩展名 + 按图片 mime 推断的扩展名（jpeg → `.jpg`、png → `.png`，未知 mime 兜底 `.jpg`）

#### Scenario: 取消对话框无副作用

- **WHEN** 用户在存盘对话框点取消
- **THEN** `pick_cover_save_path` 返 `None`、不调用 `export_cover`，不写任何文件，标签、封面与表单均无变化

#### Scenario: 导出为只读动作

- **WHEN** 导出成功或失败
- **THEN** 原歌曲标签任何字段、图片数据与文件修改时间语义不被本动作改写，编辑表单内容与 dirty 状态不变

#### Scenario: 导出失败如实报错

- **WHEN** `pick_cover_save_path` 失败（如标签损坏无法读图）或 `export_cover` 写盘失败（路径不可写、父目录不存在等）
- **THEN** 封面区显示明确的中文错误原因，不假报成功，封面预览与表单不受影响

#### Scenario: 无内嵌封面时菜单项置灰

- **WHEN** 当前歌曲没有内嵌封面，用户在封面区右键
- **THEN** 「导出封面…」菜单项置灰不可点击，不弹出存盘对话框

#### Scenario: 切歌后菜单不残留

- **WHEN** 导出菜单处于打开状态时切换到另一首歌曲
- **THEN** 菜单关闭；再次右键时菜单状态与新歌曲的封面情况一致
