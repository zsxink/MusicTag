## Why

MusicTag 是跨平台桌面应用（Tauri 2 + Rust），`src-tauri/tauri.conf.json` 的 `bundle.icon` 已声明 `icons/32x32.png`、`icons/128x128.png`、`icons/128x128@2x.png`、`icons/icon.icns`、`icons/icon.ico` 五类图标，但存在两类问题：

1. **icons 目录缺失（回归）**：git 索引在 v1-skeleton 提交（`1104eb5`）起跟踪 52 个 `src-tauri/icons/` 文件，磁盘上该目录被整体删除（未提交、非 gitignore 所致）。打包（`npm run tauri build`）时会因找不到 bundle.icon 引用文件而失败，Windows/macOS/Linux 三端图标都不完整。
2. **无图标资产管线**：仓库没有来源图标（`icon/` 目录此前不存在）、没有图标设计文档，图标只能靠脚手架默认占位，无法保证三端产物与 `tauri.conf.json` 引用吻合。

本变更建立完整的图标资产管线：先产出设计文档 → 用 `npm run tauri icon` 从源图一次性重建三端全套图标 → 修复删除回归（恢复 git 索引与磁盘一致）→ 源图纳入版本控制。这是 Epic「项目基建初始化」的基建子变更，为后续打包发布提供可重复、可追溯的图标资产。

## What Changes

- **产出图标设计文档** `docs/design/musictag-icon-design.md`：设计输入（图标风格 / 配色 / 设计规范），供生成阶段据此绘制/确认源图。该文档当前已在磁盘上（用户提供，未提交），本变更将其纳入版本控制并作为设计权威。
- **用 `npm run tauri icon icon/musictag.png` 重建 `src-tauri/icons/` 全套三端图标**：
  - Windows `icon.ico`：多尺寸内嵌图层（16 / 24 / 32 / 48 / 64 / 256）。
  - macOS `icon.icns`：多尺寸图层（16 / 32 / 128 / 256 / 512）。
  - Linux：`32x32.png` / `64x64.png` / `128x128.png` / `128x128@2x.png`（retina `@2x`）等尺寸 PNG。
  - 兼容保留 `icon.png` 与脚手架自带的 `Square*Logo.png`、`StoreLogo.png`、`android/`、`ios/` 目录（移动端/商店图，与 bundle 引用无关，但属 `tauri icon` 默认产物，一并版本控制）。
- **修复 icons 目录删除回归**：`git add` 回全套 `src-tauri/icons/` 文件（git 索引 52 个，与磁盘重生成结果一致），纳入版本控制。
- **源图 `icon/musictag.png`（512×512 RGBA）纳入版本控制**，作为 `npm run tauri icon` 的可重复输入。
- **验证产物与 `tauri.conf.json` 吻合**：`bundle.icon` 数组引用的 5 个文件全部存在且为对应格式（PNG / @2x PNG / icns / ico）；`@2x` 命名不可改（Tauri bundle 按名识别 retina 图标）；Linux 打包走 freedesktop hicolor 图标目录 + `.desktop` 的 `Icon=`，AppImage 自动选用最大方形 PNG。

## Capabilities

### New Capabilities
- `infra-icons`: 三端图标资产齐全、可重复生成（`npm run tauri icon icon/musictag.png`）、`bundle.icon` 引用全部吻合、icons 删除回归已修复（git 索引与磁盘一致）、源图与设计文档纳入版本控制

### Modified Capabilities
（无）

## 关联 Issue

- GitHub Issue：`#54`（Epic「项目基建初始化」总 Issue `#48` 的子变更；分支提交 `feat(54): ...`、PR `Closes #54`）

## Impact

- 域：frontend + infra（Tauri 构建/打包资产，不涉及 Rust 后端代码与前端源码）；依赖：无（Epic 内独立子变更，无前后端代码依赖）。
- 文件面：新增 `docs/design/musictag-icon-design.md`（版本控制）、`icon/musictag.png`（源图，512×512 RGBA）；重生成并提交 `src-tauri/icons/` 全套文件（恢复 git 索引与磁盘一致）。
- 打包影响：`npm run tauri build` 不再因 bundle.icon 文件缺失失败；Windows/macOS/Linux 三端图标正确生成。
- 不触碰：`src/`（前端源码）、`src-tauri/` 下 Rust 代码与 `tauri.conf.json`（本变更不改 bundle.icon 数组，只保证其引用的文件存在）。
