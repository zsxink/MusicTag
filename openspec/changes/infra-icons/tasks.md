# infra-icons 任务清单

> 域：frontend + infra；无依赖。顺序执行：设计文档入库 → 生成 icons → 提交新图标（取代旧图标）→ 验证（design.md「任务拆分建议」）。零代码改动，不碰 `src-tauri/tauri.conf.json` 与 Rust/前端源码。旧图标是用户手动清理的脚手架默认图标，不还原。

## 1. 图标设计文档入库（design.md D1）

- [ ] 1.1 确认 `docs/design/musictag-icon-design.md` 在磁盘上存在且为最终版（图标风格 / 配色 / 设计规范 / 验收标准）
- [ ] 1.2 `git add docs/design/musictag-icon-design.md`，纳入版本控制（当前为 untracked）

## 2. 生成全套 icons（design.md D2–D4）

- [ ] 2.1 确认源图 `icon/musictag.png` 存在且为正方形 512×512 RGBA PNG（`file` 检查）
- [ ] 2.2 执行 `npm run tauri icon icon/musictag.png`（Tauri CLI 2.x，默认输出到 `src-tauri/icons/`），无报错
- [ ] 2.3 检查输出完整：
  - [ ] `icon.ico`（Windows，16/24/32/48/64/256 多尺寸图层）
  - [ ] `icon.icns`（macOS，16/32/128/256/512 多尺寸图层；当前主机为 macOS，`iconutil` 可用）
  - [ ] `32x32.png` / `128x128.png` / `128x128@2x.png`（retina ≥256）+ `64x64.png` / `icon.png`
  - [ ] `Square*Logo.png` / `StoreLogo.png` / `android/` / `ios/`（默认产物，一并保留）

## 3. 提交新图标取代旧默认图标 + 源图入库（design.md D6）

- [ ] 3.1 `git add src-tauri/icons/`：重建的新图标全套入库（取代被清理的旧默认图标；旧图标删除随本变更提交，最终无 `D` 残留）
- [ ] 3.2 `git add icon/musictag.png`：源图纳入版本控制
- [ ] 3.3 确认 `icon/musictag copy.png` 副本不入库：不在 `git ls-files` 中（`.gitignore` 排除或人工删除），不作为生成输入
- [ ] 3.4 确认无 `D`（deleted）状态图标文件：`git status -- src-tauri/icons/` 干净
- [ ] 3.5 确认 `git check-ignore` 未忽略 `src-tauri/icons/` 与 `icon/musictag.png`（应 exit=1，即未被忽略）

## 4. 验证（design.md D7）

- [ ] 4.1 icons 齐全：`tauri.conf.json` bundle.icon 的 5 个文件逐一 `test -f src-tauri/<path>` 存在（`32x32.png` / `128x128.png` / `128x128@2x.png` / `icon.icns` / `icon.ico`）
- [ ] 4.2 格式抽查：`file src-tauri/icons/icon.ico` → ICO；`file src-tauri/icons/icon.icns` → ICNS；PNG 尺寸抽查（`32x32.png`=32、`128x128.png`=128、`128x128@2x.png`≥256）
- [ ] 4.3 `@2x` 命名未改：`128x128@2x.png` 文件名原样保留（Tauri 按名识别 retina）
- [ ] 4.4 git 卫生：`git status` 无 icons 相关 `D`/`??`；`icon/musictag copy.png` 未入库
- [ ] 4.5 构建不受影响：`cargo check --manifest-path src-tauri/Cargo.toml` + `npm run build` 通过
- [ ] 4.6 提交 PR 前核对 Issue 关联：分支提交 `feat(54): ...`、PR 描述 `Closes #54`、基分支 `main`（Epic 总 Issue `#48`）
