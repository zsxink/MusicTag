## MODIFIED Requirements

### Requirement: 封面预览与导出优先取 front cover

封面预览（`open_song`）与只读导出（`pick_cover_save_path` / `export_cover`）SHALL 共用一条取图路径：优先取标签内第一个 `PictureType::CoverFront` 图片，随后才回退到第一张图片；APE 原生 `Cover Art (Front)` 回退保持不变。取到的图片原始字节 SHALL 与写出的文件字节完全一致（非压缩预览图）。

该优先级的测试证据 SHALL 能区分「优先 front cover」与「取第一张」两种实现：多图场景的 fixture SHALL 先回读并断言标签内图片的顺序与类型，再断言取图结果；无 front cover 的回退场景 SHALL 同样由早检证明标签确有多张非 front 图片且首图即构造的第一张，避免「只有一张可挑」造成的空转绿。导出场景 SHALL 断言按取到图片的 MIME 推断出的默认扩展名。

#### Scenario: 首图不是 front cover 的多图标签

- **WHEN** 一个 FLAC/MP3 标签含多张图片，第一张是 back cover，第二张是 `CoverFront`
- **THEN** 封面预览与导出的文件字节都来自第二张 front cover，且默认扩展名按其 MIME 推断

#### Scenario: 无 front cover 的既有标签

- **WHEN** 标签只有非 `CoverFront` 图片，没有任何 front cover
- **THEN** 保持既有行为，取第一张图片，不新增空白封面；测试须先证明标签内确有多张非 front 图片且首图即预期回退目标

#### Scenario: APE 回退仍可用

- **WHEN** APE 文件的通用 `Tag` 路径没有图片，但 APEv2 binary item 含 `Cover Art (Front)`
- **THEN** 预览与导出仍经 `read_ape_cover` 回退取到该图片原始字节
