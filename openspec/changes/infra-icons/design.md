# infra-icons 技术设计

## Context

MusicTag（Tauri 2 + Rust）的 `src-tauri/tauri.conf.json` 已声明 `bundle.icon` 数组（`icons/32x32.png`、`icons/128x128.png`、`icons/128x128@2x.png`、`icons/icon.icns`、`icons/icon.ico`）。`src-tauri/icons/` 目录内的图标是脚手架默认生成（v1-skeleton 提交 `1104eb5` 时入库 52 个文件），**已被用户手动删除**（有意清理旧默认图标），git 索引仍跟踪着这 52 个文件（工作区显示 `D`）。其后果是 `npm run tauri build` 因找不到 bundle.icon 引用文件而失败，三端图标资产缺失——需用新源图重建取代。

与此同时，用户已提供图标设计文档 `docs/design/musictag-icon-design.md`（磁盘上存在，未提交）与源图 `icon/musictag.png`（512×512 RGBA，未提交、未被 gitignore）。本变更（Epic「项目基建初始化」子变更 #54，域 frontend + infra，无依赖）把这些资产固化进仓库，并建立「设计文档 → 源图 → `npm run tauri icon` → 三端图标」的可重复管线，重建后的新图标取代旧图标入库。

## Goals / Non-Goals

**Goals**
- `docs/design/musictag-icon-design.md` 纳入版本控制，作为图标风格/配色/设计规范的权威。
- `icon/musictag.png`（512×512 RGBA）纳入版本控制，作为 `tauri icon` 的可重复输入源图。
- 用 `npm run tauri icon icon/musictag.png` 重建 `src-tauri/icons/` 全套三端图标：
  - Windows `icon.ico`（16/24/32/48/64/256 内嵌图层）、macOS `icon.icns`（16/32/128/256/512 内嵌图层）、Linux 各尺寸 PNG（含 `128x128@2x.png` retina）。
- 用重建的新图标取代旧默认图标：`src-tauri/icons/` 的 git 索引与磁盘一致（新图标入库，旧图标删除随本变更提交，无 `D` 状态残留）。
- 产物与 `tauri.conf.json` bundle.icon 数组吻合：5 个引用文件全部存在且格式正确；`@2x` 命名不可改。
- 验证三端打包机制就绪：Linux freedesktop hicolor 图标 + `.desktop` `Icon=`、AppImage 自动选最大方形 PNG；`cargo check` / `npm run build` 不受影响。

**Non-Goals**
- 不改 `src-tauri/tauri.conf.json`（bundle.icon 数组保持现状，本变更只保证其引用的文件存在）。
- 不改任何 Rust 代码、前端 `src/` 源码；本变更零代码逻辑改动。
- 不手工逐张绘制/修图三端图标（全部由 `tauri icon` 从源图自动生成）。
- 不动脚手架附带的移动端/商店图产物（`android/`、`ios/`、`Square*Logo.png`、`StoreLogo.png`）——它们不在 bundle.icon 引用内，但随 `tauri icon` 默认产出，一并版本控制保持仓库一致。

## Decisions

### D1 图标设计文档 `docs/design/musictag-icon-design.md` 入库

该文档已由用户提供（磁盘上存在，`git status` 显示 untracked），内容为最终版图标设计规范：深墨青绿底 squircle 圆角方块 + 荧光青绿吊牌（rotateY −20° / rotateZ 8° 伪 3D 透视）+ 均衡器式多色波形（奶白为主、点缀亮蓝/暖杏/柔粉/荧光青绿），并含小尺寸（≤32px）可读性要求与验收标准。

- 本变更直接将其纳入版本控制（`git add`），作为生成阶段的唯一设计权威；源图 `icon/musictag.png` 即按此规范产出。
- 设计文档的交付物清单（`musictag-icon.svg` / `musictag-icon-512.png` / `musictag-icon-1024.png`）为设计侧导出产物；本变更以 512×512 的 `icon/musictag.png` 作为 `tauri icon` 输入，svg 主文件不强制入库（源图 PNG 足够可重复生成）。

### D2 源图 `icon/musictag.png` 入库 + `npm run tauri icon` 重建

- 源图要求：正方形、带 alpha 的 PNG（或 SVG）。当前 `icon/musictag.png` 为 **512×512 RGBA**，满足要求。
- 重建命令（Tauri CLI 2.11.4，`node_modules/@tauri-apps/cli` 已随 `npm run tauri` 暴露）：
  ```sh
  npm run tauri icon icon/musictag.png
  ```
  默认输出目录为 `tauri.conf.json` 所在目录旁的 `icons/`（即 `src-tauri/icons/`），无需 `-o` 覆盖。
- 生成产物（默认全集）：`icon.ico`（Windows，多尺寸）、`icon.icns`（macOS，多尺寸）、`32x32.png` / `64x64.png` / `128x128.png` / `128x128@2x.png` / `icon.png`、`Square*Logo.png`（商店图）、`android/`、`ios/` 目录。
- 产物与 bundle.icon 的吻合关系：`32x32.png`、`128x128.png`、`128x128@2x.png`、`icon.icns`、`icon.ico` 全部由该命令生成，`64x64.png` 与 `icon.png` 为附带产物（task 允许「可另含」）。
- **`@2x` 命名不可改**：Tauri 打包时按 `128x128@2x.png` 文件名识别 retina 图标并写进 Linux/AppImage 资源与 `.desktop` 的 retina 变体；改名会破坏 retina 解析。

### D3 三端图标格式细节

| 平台 | 文件 | 内嵌图层 | 说明 |
|---|---|---|---|
| Windows | `icon.ico` | 16 / 24 / 32 / 48 / 64 / 256 | Tauri bundle 的 Windows 安装包/EXE 图标；256 为 Vista+ 所需 |
| macOS | `icon.icns` | 16 / 32 / 128 / 256 / 512（含各 @2x 变体） | Tauri bundle 写入 `.app/Contents/Resources/icon.icns`；由源图 512 起缩放 |
| Linux | `32x32.png` / `64x64.png` / `128x128.png` / `128x128@2x.png` 等 | 单尺寸 PNG | 打包期写入 freedesktop hicolor 图标目录 + `.desktop` 引用 |
| 附加 | `icon.png`、`Square*Logo.png`、`android/`、`ios/` | — | `tauri icon` 默认产物；不在 bundle.icon 引用内，但入库保持完整 |

### D4 macOS 生成 icns 的跨主机注意

`tauri icon` 生成 `icon.icns` 依赖 `iconutil`（macOS 内置工具）。在 **Windows / Linux 主机**上运行可能因缺 `iconutil` 而失败或产出异常 icns。本项目当前开发主机为 macOS（Darwin），可直接生成；若 CI/其他平台主机需重建，建议：
- 优先在 macOS 主机执行 `npm run tauri icon icon/musictag.png`；
- 或在打包机预置 `iconutil` 等价物（跨平台库/容器内补齐），否则 icns 生成环节跳过，导致 bundle.icon 的 `icon.icns` 缺失。

本变更在实施阶段于本机（macOS）生成，产物入库后跨平台打包无需重生成 icns。

### D5 Linux freedesktop 打包机制

Tauri 2 在 Linux 打包时：
- 把图标写入 `/usr/share/icons/hicolor/{16,32,48,64,128,256,512}x{16,...}/apps/musictag.png` 等 freedesktop hicolor 尺寸目录（源图经 `tauri icon` 产出的各尺寸 PNG 直接映射）；
- `.desktop` 文件写 `Icon=musictag`（不写路径，由 hicolor 目录按尺寸自动查找）；
- **AppImage** 打包自动选用可用的最大方形 PNG 作为 AppImage 内嵌图标（AppImage 格式要求单一方形图标）。
- 故 Linux 侧产物必须保留 `128x128.png` / `128x128@2x.png` 等完整尺寸集；`@2x` retina 由 Tauri 识别并写入对应 hicolor 尺寸槽。

### D6 旧图标删除的语义与提交决策

- **现状**：`git ls-files src-tauri/icons/` 列出 52 个文件（v1-skeleton `1104eb5` 时入库的**旧默认图标**）；磁盘上该目录已被**用户手动删除**（有意清理旧图标，非误删、非 gitignore 所致——`.gitignore` 未忽略该目录，`git check-ignore` 返回 exit=1）。
- **语义**：旧图标不还原。S6 用新源图 `icon/musictag.png` 重建一套**新图标**，重建结果入库取代旧图标；旧图标的删除随本变更提交（提交「删除旧默认图标 + 新增新图标」）。
- **提交决策：icons 目录入库（YES）**。理由：bundle.icon 引用的是仓库内相对路径，打包机/CI 从干净 checkout 构建必须能拿到这些文件；且 `tauri icon` 从源图可重复生成，未来源图变更时重跑命令再提交即可，不存在「二进制产物不可重建」的维护负担。`src-tauri/target/` 等真正可再生的构建产物仍由 `.gitignore` 排除。
- 源图 `icon/musictag.png` 与设计文档一并 `git add` 入库。
- **副本文件** `icon/musictag copy.png`（与 `musictag.png` 内容完全相同的手动备份）**不纳入版本控制**，也不作为 `tauri icon` 输入（避免重复资产）；由 `.gitignore` 或人工删除处理。

### D7 验证方式

- **icons 齐全**：`ls src-tauri/icons/` 对照 bundle.icon 5 个引用文件逐一存在；`git ls-files src-tauri/icons/ | wc -l` ≥ 52（重建的新图标全套），无 `D` 状态。
- **格式校验**：`file` 确认 `icon.ico`/`icon.icns` 为有效 ICO/ICNS；PNG 尺寸用 `file`/`sips` 抽查（`32x32.png`=32、`128x128.png`=128、`128x128@2x.png`≥256）。
- **config 吻合**：bundle.icon 数组每个路径 `test -f src-tauri/<path>` 通过；`@2x` 文件名未改。
- **git 卫生**：`git status` 无 icons 相关 `D`（旧图标删除已随新图标提交一并处理）；`git check-ignore` 确认 icons 与源图未被忽略；`icon/musictag copy.png` 副本未入库。
- **构建不受影响**：`cargo check --manifest-path src-tauri/Cargo.toml` + `npm run build` 通过（本变更零代码改动，应原样通过）。

## Risks / Trade-offs

- **icns 跨主机生成失败（主要风险）**：Windows/Linux 主机上 `tauri icon` 生成 icns 可能因缺 `iconutil` 失败。缓解：本机（macOS）生成产物入库，打包机复用；文档 D4 记录跨主机限制。
- **二进制产物入库的仓库体积**：52 个 PNG/ICO/ICNS 文件入库略增仓库体积。权衡：bundle.icon 依赖相对路径 + 干净 checkout 可构建性优先；且可由源图重生成，维护风险低。
- **`@2x` 改名破坏 retina**：若实施时手工改文件名，Linux/AppImage retina 图标失效。缓解：D2 明确命名不可改，spec 有可测场景。
- **`tauri icon` 默认产物与 bundle.icon 不完全一致**：`Square*Logo.png`/`android/`/`ios/` 不在 bundle.icon 引用内。权衡：保持 `tauri icon` 默认全集入库（避免部分产物被手动清理后重跑命令又冒出来），spec 只要求 bundle.icon 引用的 5 个文件吻合。
- **AppImage 图标选择**：AppImage 自动选「最大方形 PNG」——若源图非方形或含透明异常可能选错。缓解：源图已确认 512×512 RGBA 方形，生成产物尺寸受控。
- **零自动化保障**：本变更无测试代码（纯资产管线）。缓解：验证环节以文件存在性 + 格式 + git 卫生检查覆盖 spec 全部可测场景。

## 任务拆分建议

依赖顺序：**设计文档 → 生成 icons → 提交新图标（取代旧图标）→ 验证**（严格顺序，生成依赖源图就绪、提交依赖生成完成）。单 Agent 顺序执行即可，无跨域并行：

1. **设计文档入库**（D1）：`git add docs/design/musictag-icon-design.md`（内容已在磁盘，无需重写）。
2. **生成 icons**（D2–D4）：确认 `icon/musictag.png` 存在（512×512 RGBA）→ `npm run tauri icon icon/musictag.png` → 检查输出完整（ico/icns/各尺寸 PNG/`@2x`）。
3. **提交新图标取代旧图标**（D6）：`git add src-tauri/icons/`（新图标全套入库；旧图标删除随本变更提交，无 `D` 残留）+ `git add icon/musictag.png`；确认 `icon/musictag copy.png` 副本不入库。
4. **验证**（D7）：icons 齐全（bundle.icon 5 文件逐一存在、格式抽查）→ config 吻合（`@2x` 命名未改）→ `cargo check` + `npm run build` 通过 → 提交 PR 前核对 Issue 关联（`feat(54): ...`、`Closes #54`、基分支 `main`）。
