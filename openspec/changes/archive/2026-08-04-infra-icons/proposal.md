## Why

MusicTag 是跨平台桌面应用（Tauri 2 + Rust），`src-tauri/tauri.conf.json` 的 `bundle.icon` 已声明 `icons/32x32.png`、`icons/128x128.png`、`icons/128x128@2x.png`、`icons/icon.icns`、`icons/icon.ico` 五类图标，但存在两类问题：

1. **旧图标被清理、缺失**：`src-tauri/icons/` 目录内的图标是脚手架默认生成（v1-skeleton 提交 `1104eb5` 时入库 52 个文件），**已被用户手动删除**（有意清理旧默认图标），git 索引仍跟踪着这 52 个文件（工作区 `D`）。打包（`npm run tauri build`）会因找不到 bundle.icon 引用文件而失败，Windows/macOS/Linux 三端图标都不完整——需用新源图重建取代。
2. **无图标资产管线**：仓库此前没有来源图标（`icon/` 目录此前不存在）、没有图标设计文档，图标只能靠脚手架默认占位，无法保证三端产物与 `tauri.conf.json` 引用吻合。

本变更建立完整的图标资产管线：先产出设计文档 → 用 `npm run tauri icon` 从源图一次性重建三端全套图标 → 重建的新图标取代旧图标入库（旧图标删除随本变更提交）→ 源图纳入版本控制。这是 Epic「项目基建初始化」的基建子变更，为后续打包发布提供可重复、可追溯的图标资产。

## What Changes

- **产出图标设计文档** `docs/design/musictag-icon-design.md`：设计输入（图标风格 / 配色 / 设计规范），供生成阶段据此绘制/确认源图。该文档当前已在磁盘上（用户提供，未提交），本变更将其纳入版本控制并作为设计权威。
- **用 `npm run tauri icon icon/musictag.png` 重建 `src-tauri/icons/` 全套三端图标**：
  - Windows `icon.ico`：多尺寸内嵌图层（16 / 24 / 32 / 48 / 64 / 256）。
  - macOS `icon.icns`：多尺寸图层（16 / 32 / 128 / 256 / 512）。
  - Linux：`32x32.png` / `64x64.png` / `128x128.png` / `128x128@2x.png`（retina `@2x`）等尺寸 PNG。
  - 兼容保留 `icon.png` 与脚手架自带的 `Square*Logo.png`、`StoreLogo.png`、`android/`、`ios/` 目录（移动端/商店图，与 bundle 引用无关，但属 `tauri icon` 默认产物，一并版本控制）。
- **新图标取代旧默认图标**：重建结果入库；旧图标（52 个脚手架默认）的删除随本变更提交，git 索引与磁盘最终一致。
- **源图 `icon/musictag.png`（512×512 RGBA）纳入版本控制**，作为 `npm run tauri icon` 的可重复输入。
- **副本不入库**：`icon/musictag copy.png`（与 `musictag.png` 内容相同的手动备份）不纳入版本控制、不作为输入。
- **验证产物与 `tauri.conf.json` 吻合**：`bundle.icon` 数组引用的 5 个文件全部存在且为对应格式（PNG / @2x PNG / icns / ico）；`@2x` 命名不可改（Tauri bundle 按名识别 retina 图标）；Linux 打包走 freedesktop hicolor 图标目录 + `.desktop` 的 `Icon=`，AppImage 自动选用最大方形 PNG。

## Capabilities

### New Capabilities
- `infra-icons`: 三端图标资产齐全、可重复生成（`npm run tauri icon icon/musictag.png`）、`bundle.icon` 引用全部吻合、新图标取代旧默认图标入库（旧图标删除随本变更提交，git 索引与磁盘一致）、源图与设计文档纳入版本控制

### Modified Capabilities
（无）

## 关联 Issue

- GitHub Issue：`#54`（Epic「项目基建初始化」总 Issue `#48` 的子变更；分支提交 `feat(54): ...`、PR `Closes #54`）

## Impact

- 域：frontend + infra（Tauri 构建/打包资产，不涉及 Rust 后端代码与前端源码）；依赖：无（Epic 内独立子变更，无前后端代码依赖）。
- 文件面：新增 `docs/design/musictag-icon-design.md`（版本控制）、`icon/musictag.png`（源图，512×512 RGBA）；重生成并提交 `src-tauri/icons/` 全套新图标（旧图标删除随本变更提交，最终 git 索引与磁盘一致）；`icon/musictag copy.png` 副本不入库。
- 打包影响：`npm run tauri build` 不再因 bundle.icon 文件缺失失败；Windows/macOS/Linux 三端图标正确生成。
- 不触碰：`src/`（前端源码）、`src-tauri/` 下 Rust 代码与 `tauri.conf.json`（本变更不改 bundle.icon 数组，只保证其引用的文件存在）。
