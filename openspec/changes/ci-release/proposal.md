## Why

V1 产品功能已全部合并回 main，但没有任何发布通道：目前只有 `.github/workflows/ci.yml`（PR/push 校验门禁），打 tag 不会产出可安装的安装包。作为「工具线 · 自用」的桌面应用，需要一条「打 `v*` tag → 三端并行构建安装包 → 挂到 GitHub Release Draft」的自动化发布流水线，让每次版本发布可复现、产物齐全（Windows .msi/.exe、macOS .dmg/.app、Linux .deb/.rpm/.AppImage），并与现有 CI 校验门禁互补不冲突。

## What Changes

- 新增 `.github/workflows/release.yml`（仅此一个文件；其余不动）：
  - 触发：`on: push: tags: ['v*']`（在 main 打 `v0.0.1` 之类 tag 触发）。
  - 结构：独立 `test` job（ubuntu 跑一次 cargo check/test + npm test/build，校验门禁）+ `publish-tauri` job（`needs: test` 门禁）+ `tauri-apps/tauri-action@v1` matrix 三端并行。
  - 三端 matrix：`windows-latest` / `macos-latest` / `ubuntu-22.04`；macOS 用双 matrix（aarch64 + x86_64）各产 `.dmg`/`.app`。
  - 三端产物：Windows → `.msi` + `-setup.exe`（NSIS + WiX）；macOS → `.dmg`/`.app`（aarch64 + x86_64 各一套）；Linux → `.deb` + `.rpm` + `.AppImage`。
  - `permissions: contents: write`（tauri-action 建 Release 必需）；`fail-fast: false`（三端互不拖累）；`releaseDraft: true`（先建草稿，人工核对后手动发布）。
  - tag 版本对齐：tauri-action `tagName: v__VERSION__`（取自 `tauri.conf.json` version）；`package.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml` 三处 `version` 手动对齐（发布前自检）。
  - macOS ad-hoc 签名：`bundle.macOS.signingIdentity: "-"`（无开发者证书，自用 ad-hoc）。
  - Linux 依赖包清单 + `actions/setup-node` + `dtolnay/rust-toolchain` + npm/rust 缓存（swatinem/rust-cache + 前端 npm ci 缓存加速）。

## Capabilities

### New Capabilities
- `ci-release`: 打 `v*` tag 自动触发三端并行构建安装包并挂 GitHub Release Draft；test 门禁先行；与 ci.yml 校验门禁互补不冲突

### Modified Capabilities
（无）

## 关联 Issue

- GitHub Issue：`#55`（Epic「项目基建初始化」总 Issue `#48` 的子变更；依赖 `infra-icons`；分支提交 `feat(55): ...`、PR `Closes #55`）

## Impact

- 新增 `.github/workflows/release.yml` 一个 workflow 文件；不改现有 `.github/workflows/ci.yml`（其 PR/push 校验职责不变）。
- 不改任何产品代码（`src-tauri/`、`src/`、`docs/` 定稿文档均不碰）。
- 三处 `version`（`package.json` / `tauri.conf.json` / `Cargo.toml`）当前均为 `0.1.0`，一致；发布前须手动对齐版本，tag 命名 `v<版本>`。
- 依赖 `infra-icons`：打包依赖 `src-tauri/icons/` 图标资产齐备（icns/ico/png），图标先就位再开发布通道。
- 域：infra（纯配置变更，无前后端代码依赖）。
