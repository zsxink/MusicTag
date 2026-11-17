## ADDED Requirements

### Requirement: 封面预览与导出优先取 front cover

封面预览（`open_song`）与只读导出（`pick_cover_save_path` / `export_cover`）SHALL 共用一条取图路径：优先取标签内第一个 `PictureType::CoverFront` 图片，随后才回退到第一张图片；APE 原生 `Cover Art (Front)` 回退保持不变。取到的图片原始字节 SHALL 与写出的文件字节完全一致（非压缩预览图）。

#### Scenario: 首图不是 front cover 的多图标签

- **WHEN** 一个 FLAC/MP3 标签含多张图片，第一张是 back cover，第二张是 `CoverFront`
- **THEN** 封面预览与导出的文件字节都来自第二张 front cover，默认扩展名按其 MIME 推断

#### Scenario: 无 front cover 的既有标签

- **WHEN** 标签只有非 `CoverFront` 图片，没有任何 front cover
- **THEN** 保持既有行为，取第一张图片，不新增空白封面

#### Scenario: APE 回退仍可用

- **WHEN** APE 文件的通用 `Tag` 路径没有图片，但 APEv2 binary item 含 `Cover Art (Front)`
- **THEN** 预览与导出仍经 `read_ape_cover` 回退取到该图片原始字节

### Requirement: 本地选封面失败如实报错

`pick_cover_file` SHALL 返回 `Result<Option<CoverInput>, String>`：用户取消返回 `Ok(None)`；文件读取、格式识别或压缩失败返回中文 `Err`，不伪装成取消。前端 `CoverPanel.vue` 已有的 `try/catch` 展示该错误，不污染当前封面与表单。

#### Scenario: 选择图片后解码失败

- **WHEN** 用户在封面文件选择器中选中一个非图片或已损坏的文件
- **THEN** command 返回 `Err` 且错误信息为中文原因，封面区展示错误、保留原封面、dirty 状态不变

#### Scenario: 取消文件选择器

- **WHEN** 用户取消封面文件选择器
- **THEN** command 返回 `Ok(None)`，不显示错误，不改动封面与表单
