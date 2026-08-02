## ADDED Requirements

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
