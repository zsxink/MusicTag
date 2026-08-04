# infra-icons Specification

## Purpose
TBD - created by archiving change infra-icons. Update Purpose after archive.
## Requirements
### Requirement: 三端图标资产齐全

`src-tauri/icons/` SHALL 包含 Windows / macOS / Linux 三端的全套图标产物，满足各平台打包格式要求。

#### Scenario: Windows ico

- **WHEN** 检查 `src-tauri/icons/icon.ico`
- **THEN** 该文件为有效 ICO 文件，内嵌 16 / 24 / 32 / 48 / 64 / 256 多尺寸图层

#### Scenario: macOS icns

- **WHEN** 检查 `src-tauri/icons/icon.icns`
- **THEN** 该文件为有效 ICNS 文件，内嵌 16 / 32 / 128 / 256 / 512 多尺寸图层

#### Scenario: Linux PNG 尺寸

- **WHEN** 检查 `src-tauri/icons/` 下的 PNG 图标
- **THEN** 存在 `32x32.png`、`128x128.png`、`128x128@2x.png`，且 `@2x` 文件为 retina 尺寸（≥256×256）；`64x64.png` 与 `icon.png` 可保留作为附加产物

### Requirement: tauri.conf.json bundle.icon 引用全部存在且吻合

`src-tauri/tauri.conf.json` 的 `bundle.icon` 数组 SHALL 中列出的每个文件路径在磁盘上真实存在，且格式与文件名含义一致。

#### Scenario: 五个引用文件齐全

- **WHEN** 逐项检查 `bundle.icon` 数组：`icons/32x32.png`、`icons/128x128.png`、`icons/128x128@2x.png`、`icons/icon.icns`、`icons/icon.ico`
- **THEN** 每个文件都存在且为对应格式（PNG / retina PNG / ICNS / ICO）

#### Scenario: @2x 命名保留

- **WHEN** 检查 retina 图标文件名
- **THEN** 文件名保持 `128x128@2x.png` 形式（`@2x` 后缀不改名；Tauri 打包按此命名识别 retina 图标）

### Requirement: 图标可重复生成

SHALL 能从源图 `icon/musictag.png` 用 `npm run tauri icon` 一次性重新生成全套图标，产物与版本控制中的内容一致。

#### Scenario: 一键重生成

- **WHEN** 执行 `npm run tauri icon icon/musictag.png`
- **THEN** `src-tauri/icons/` 下三端图标完整重建，输出不报错

#### Scenario: 源图为正方形 RGBA

- **WHEN** 检查 `icon/musictag.png`
- **THEN** 该文件存在、为正方形（512×512）RGBA PNG，且已纳入版本控制

### Requirement: 图标设计文档存在

SHALL 存在图标设计文档 `docs/design/musictag-icon-design.md`，定义图标风格 / 配色 / 设计规范，作为源图与生成物的设计权威，且纳入版本控制。

#### Scenario: 文档存在且入库

- **WHEN** 检查 `docs/design/musictag-icon-design.md`
- **THEN** 该文件存在、为 Markdown、内容含图标风格与配色规范，且已被 git 跟踪（未忽略）

### Requirement: 新图标取代旧默认图标，git 索引与磁盘一致

重建的新图标 SHALL 取代被清理的旧默认图标入库：`src-tauri/icons/` 的 git 索引与磁盘 SHALL 最终一致，无 `D` 状态残留；旧图标的删除随本变更提交。

#### Scenario: git 索引与磁盘一致

- **WHEN** 检查 `git status` 与 `git ls-files src-tauri/icons/`
- **THEN** 无 `D`（deleted）状态的图标文件，`git ls-files src-tauri/icons/` 列出的文件在磁盘上全部存在（重建的新图标全集）

#### Scenario: 全量入库

- **WHEN** 核对 `src-tauri/icons/` 的版本控制范围
- **THEN** 三端打包所需图标（含 `icon.icns`、`icon.ico`、各尺寸 PNG、`@2x` retina）全部纳入 git，非 gitignore 忽略对象

### Requirement: 源图副本不纳入版本控制

`icon/musictag copy.png`（与 `icon/musictag.png` 内容相同的手动备份副本）SHALL 不纳入版本控制，也不作为 `tauri icon` 的输入。

#### Scenario: 副本不入库

- **WHEN** 检查 `git status` 与 `git ls-files icon/`
- **THEN** `icon/musictag.png` 被 git 跟踪；`icon/musictag copy.png` 未被跟踪（由 `.gitignore` 排除或人工删除），不作为生成输入

