# ci-release 技术设计

## Context

V1 产品功能已合并回 main，但发布通道为零：现有 `.github/workflows/ci.yml` 只覆盖 `pull_request` + push 到 `main` 的校验（openspec validate、前端 build/test、cargo check/test），不打安装包。本变更（Epic「项目基建初始化」子变更 #55，域 infra，依赖 `infra-icons`）新增 `.github/workflows/release.yml`，实现「打 `v*` tag → test 门禁 → 三端并行 `tauri-action` 构建 → GitHub Release Draft」。

关键现状（已读文件确认）：
- `ci.yml`：`on: pull_request + push: branches: [main]`，`permissions: contents: read`，单 `validate` job（ubuntu-latest）。**触发条件与 release.yml 完全正交**（tag push 不触发 ci.yml；PR/main push 不触发 release.yml）。
- 版本：`package.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml` 三处均为 `0.1.0`，一致。
- `tauri.conf.json`：`productName: MusicTag`、`bundle.targets: all`、`bundle.icon` 已声明 5 个图标资产（依赖 `infra-icons` 提供，32x32.png / 128x128.png / 128x128@2x.png / icon.icns / icon.ico）。
- Rust 依赖含 `reqwest`/`tokio`/`aes`/`rsa` 等，Linux 构建需系统依赖包（与 ci.yml 同清单）。

## Goals / Non-Goals

**Goals**
- 新增 `release.yml`，打 `v*` tag 触发三端（windows-latest / macos-latest / ubuntu-22.04）并行构建安装包并挂 GitHub Release Draft。
- 独立 `test` job 先行（cargo check/test + npm test/build），`publish-tauri` 以 `needs: test` 为门禁。
- macOS 双架构（aarch64 + x86_64）各产 `.dmg`/`.app`；Windows 产 `.msi` + `-setup.exe`；Linux 产 `.deb` + `.rpm` + `.AppImage`。
- 与 ci.yml 互补不冲突：ci.yml 管 PR/push 校验，release.yml 只管 tag 发布构建。

**Non-Goals**
- 不改 `.github/workflows/ci.yml` 及任何产品代码/文档。
- 不做三处 version 的自动化同步（`package.json` / `tauri.conf.json` / `Cargo.toml` 手动对齐，发布流程自检）。
- 不做自动发布：`releaseDraft: true`，人工核对后手动点发布。
- 不做代码签名公证（notarization）/Windows 代码签名——自用无证书，macOS 用 ad-hoc 签名。
- 不做产物自更新（tauri-updater）通道。
- 不新建 `.github/workflows/` 之外的任何文件。

## Decisions

### D1 触发：`on: push: tags: ['v*']`

```yaml
on:
  push:
    tags:
      - 'v*'
```

- 只监听 **tag push**，与 ci.yml 的 `pull_request`/`branches: [main]` 正交，天然不冲突。
- tag 命名规范：`v<版本>`（如 `v0.1.0`），版本取自 `tauri.conf.json`（见 D7）。
- 发布动作（merge PR 回 main）后打 tag 推送即触发，无需手动跑 workflow。

### D2 matrix：三端并行 + macOS 双架构

```yaml
jobs:
  publish-tauri:
    needs: test
    permissions:
      contents: write
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: windows-latest
            args: ''
          - platform: macos-latest
            args: '--target aarch64-apple-darwin'
          - platform: macos-latest
            args: '--target x86_64-apple-darwin'
          - platform: ubuntu-22.04
            args: ''
    runs-on: ${{ matrix.platform }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.platform == 'macos-latest' && 'aarch64-apple-darwin,x86_64-apple-darwin' || '' }}
      - uses: swatinem/rust-cache@v2
        with:
          workspaces: './src-tauri -> target'
      - name: Install Linux system dependencies
        if: ${{ matrix.platform == 'ubuntu-22.04' }}
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf build-essential curl wget file libxdo-dev libssl-dev
      - uses: tauri-apps/tauri-action@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tagName: v__VERSION__
          releaseName: 'v__VERSION__'
          releaseBody: 'MusicTag 发布'
          releaseDraft: true
          prerelease: false
          args: ${{ matrix.args }}
```

- **`include` 显式枚举 4 个 matrix 条目**：macOS 两条（aarch64 + x86_64 各一），Windows/Linux 各一。
- `fail-fast: false`：任一端失败不取消其余（spec 验收）。
- `runs-on: ${{ matrix.platform }}` + `args` 传 target 参数给 tauri-action。
- **macOS 交叉编译说明**：两条 macOS 条目都用 `macos-latest` runner（arm64 runner 可交叉编 x86_64；或直接让两个 runner 各编各的 target）。实现时可选方案：
  1. macOS 双条目 + `--target` 参数，各自原生构建（aarch64 条在 arm64 runner、x86_64 条在 x86_64 runner——GitHub 会调度到对应架构 runner）；
  2. 或单 macOS 条目加 `--target` 交叉。**设计倾向方案 1（双条目显式 target）**：确定性最高，避免交叉编译工具链（`cargo-xwin`/`cargo-zigbuild`）额外引入。

### D3 三端前置准备：Linux 依赖 + 图标 + 前端产物

- **Linux 依赖**：`ubuntu-22.04`（Ubuntu 22.04 与 `libwebkit2gtk-4.1-dev` 匹配，Tauri 2 要求 WebKitGTK 4.1；注意 `ubuntu-latest` 已滚动到 24.04，故**固定 `ubuntu-22.04`** 保证依赖包可装且可复现）。依赖清单与 ci.yml 一致：`libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf build-essential curl wget file libxdo-dev libssl-dev`。
- **图标**：打包依赖 `src-tauri/icons/` 下 `icon.icns`（macOS）、`icon.ico`（Windows）、`*.png`（通用）。`tauri.conf.json` 已声明 `bundle.icon` 五项；**依赖 `infra-icons` 先就位**，否则 `tauri build` 报缺图标失败。
- **前端产物**：`tauri-action` 调 `beforeBuildCommand: npm run build`（tauri.conf.json 已配置），自动产出 `dist/` 供内嵌，无需单独 step。

### D4 签名策略：macOS ad-hoc

```jsonc
// src-tauri/tauri.conf.json 的 bundle.macOS（实施时补齐；若文件已含则核对）
"macOS": {
  "signingIdentity": "-"
}
```

- **自用无开发者证书**：`signingIdentity: "-"` = ad-hoc 签名（`codesign -s -`），产出的 `.app`/`.dmg` 可本机运行（首次打开需右键「打开」绕过 Gatekeeper；不公证、不上架，符合「工具线 · 自用」定位）。
- **不配置 `entitlements`、不公证**：ad-hoc 不需要；G 端不折腾 Apple 开发者账号。
- Windows 不配置证书（tauri-action 默认跳过签名，产未签名 exe/msi——自用可接受）；Linux `.deb`/`.rpm`/`.AppImage` 无需签名。

### D5 缓存：npm + rust

- `actions/setup-node@v4` 带 `cache: npm`（缓存 `package-lock.json` 依赖，前端 `npm ci` 提速）。
- `swatinem/rust-cache@v2` 带 `workspaces: './src-tauri -> target'`（缓存 `src-tauri/target`，cargo 编译提速，Linux/Windows 构建时间大头在编译期）。
- 两者都在 `publish-tauri` 每个 matrix 条目内（test job 跑一次即可，不必带缓存）。

### D6 与 ci.yml 分工

| 维度 | ci.yml（现有） | release.yml（本变更新增） |
|---|---|---|
| 触发 | `pull_request` + `push: branches: [main]` | `push: tags: ['v*']` |
| 职责 | PR/push 校验门禁（openspec、前端 build/test、cargo check/test） | tag 发布构建（test 门禁 + 三端打包 + Release Draft） |
| permissions | `contents: read` | `contents: write`（建 Release 必需） |
| 产物 | 无 | `.msi`/`-setup.exe`/`.dmg`/`.app`/`.deb`/`.rpm`/`.AppImage` |

- **不覆盖**：release.yml 的 `test` job 与 ci.yml 的 `validate` 职责重叠但不冲突（前者是发布前的二次校验，后者是日常 PR/main 校验）；触发条件正交，不会双跑同一事件。
- **最小权限**：`permissions: contents: write` 只给 `publish-tauri` job（写 Release + 上传产物所需）；`test` job 不声明额外权限（默认只读）。仓库级无额外 secrets（用内置 `GITHUB_TOKEN`，`secrets.GITHUB_TOKEN` 自动注入，无需手动配）。

### D7 tag 版本对齐：三处手动对齐 + `v__VERSION__`

- `tauri-action` 的 `tagName: v__VERSION__` 中 `__VERSION__` 是 action 内置变量，取自 `src-tauri/tauri.conf.json` 的 `version`。
- **发布流程自检**（tasks 验证项）：打 tag 前确认 `package.json` / `tauri.conf.json` / `Cargo.toml` 三处 `version` 一致，tag 为 `v<该版本>`。版本不一致 → 打包产物版本与 tag 对不上（Release 名/tag 用 conf 版本，包内版本号用 conf 版本，二者一致即可；其余两处用于产物元数据与描述）。
- 当前三处均为 `0.1.0`；首个发布 tag 即 `v0.1.0`。

### D8 决定性 YAML 骨架（完整结构）

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: read   # 默认；publish-tauri job 内显式写 write

jobs:
  test:
    name: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - name: Install frontend dependencies
        if: ${{ hashFiles('package.json') != '' }}
        run: npm ci
      - name: Build frontend
        if: ${{ hashFiles('package.json') != '' }}
        run: npm run build
      - name: Test frontend
        if: ${{ hashFiles('package.json') != '' }}
        run: npm run test
      - name: Install Tauri Linux system dependencies
        if: ${{ hashFiles('src-tauri/Cargo.toml') != '' }}
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf build-essential curl wget file libxdo-dev libssl-dev
      - uses: dtolnay/rust-toolchain@stable
        if: ${{ hashFiles('src-tauri/Cargo.toml') != '' }}
      - name: Check Rust
        if: ${{ hashFiles('src-tauri/Cargo.toml') != '' }}
        working-directory: src-tauri
        run: cargo check --all-targets
      - name: Test Rust
        if: ${{ hashFiles('src-tauri/Cargo.toml') != '' }}
        working-directory: src-tauri
        run: cargo test --all-targets

  publish-tauri:
    needs: test
    if: ${{ startsWith(github.ref, 'refs/tags/v') }}
    permissions:
      contents: write
    strategy:
      fail-fast: false
      matrix:
        include:
          - { platform: 'windows-latest', args: '' }
          - { platform: 'macos-latest', args: '--target aarch64-apple-darwin' }
          - { platform: 'macos-latest', args: '--target x86_64-apple-darwin' }
          - { platform: 'ubuntu-22.04', args: '' }
    runs-on: ${{ matrix.platform }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - uses: dtolnay/rust-toolchain@stable
        with: { targets: '${{ matrix.platform == ''macos-latest'' && ''aarch64-apple-darwin,x86_64-apple-darwin'' || '''' }}' }
      - uses: swatinem/rust-cache@v2
        with: { workspaces: './src-tauri -> target' }
      - name: Install Linux system dependencies
        if: ${{ matrix.platform == 'ubuntu-22.04' }}
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf build-essential curl wget file libxdo-dev libssl-dev
      - uses: tauri-apps/tauri-action@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tagName: v__VERSION__
          releaseName: 'v__VERSION__'
          releaseBody: 'MusicTag 发布'
          releaseDraft: true
          prerelease: false
          args: ${{ matrix.args }}
```

> 说明：`args: ''` 时 tauri-action 用默认 target（当前 runner 原生架构）；macOS 双条目显式 `--target`。`if: startsWith(github.ref, 'refs/tags/v')` 为防御性冗余（触发条件已限定 tag，保留可读性）。

## Risks / Trade-offs

- **tag 触发与 ci.yml 双跑**：tag push 不会触发 ci.yml（它只听 PR/main push），天然无冲突；但同一 tag 上若也 push 到 main 分支，两个 workflow 会并行跑（ci.yml 校验 + release.yml 构建），职责不同、互不阻塞，可接受。
- **macOS 交叉编译不确定性**：x86_64 与 aarch64 两条目若在单一架构 runner 上交叉，需额外工具链。缓解：D2 用双条目让 GitHub 调度到对应架构 runner（原生构建），无交叉。
- **无签名公证的可分发性**：ad-hoc 签名的 macOS 应用首次运行需右键打开；Windows 无签名有 SmartScreen 提示。符合「自用」定位；若未来分发需求 → 另开变更补证书/公证。
- **版本三处手动对齐易错**：漏改 `Cargo.toml` 版本会导致产物元数据与 tag 不一致。缓解：tasks 验证项强制 `cargo test`（读 version）与发布前自检三处对齐；`v__VERSION__` 保证 Release 名/tag 与 conf 版本一致（发布锚点正确）。
- **Ubuntu 22.04 固定**：`ubuntu-latest` 滚动升级会换 WebKitGTK 版本，固定 `22.04` 保可复现；长期看 22.04 的 support 期限（2027）内足够，届时候变更升级。
- **构建时长**：三端各跑 cargo 全量编译，首次较长；rust-cache + npm cache 显著提速（D5）。
- **Release Draft 人工漏发**：草稿不会被自动发布，需人工核对。缓解：产物齐全性在 spec 验收（三端产物挂载）确认；Draft 是「确认无误再发布」的刻意保守。

## 任务拆分建议

纯配置变更（域 infra，单文件新增 `.github/workflows/release.yml`），无前后端代码、无并行依赖，**单 Agent 一次完成**（顺序执行）：

1. **写 `release.yml`**（D1–D8）：按 D8 骨架落完整文件——触发（D1）、test job（cargo check/test + npm test/build）、publish-tauri job（matrix/fail-fast/permissions/缓存/Linux 依赖/tauri-action 参数，D2–D6）。
2. **配置 macOS ad-hoc 签名**（D4）：核对 `tauri.conf.json` `bundle.macOS.signingIdentity: "-"`（与 `infra-icons` 交付的 `bundle.icon` 一并核对）。
3. **验证**：
   - workflow 语法：`gh workflow list` / push 分支后用 `gh workflow run` 或直接打 `v0.0.1` 试触发（或至少 `actionlint`/YAML 解析检查）。
   - 本地等价构建冒烟：`npm run build` + `cargo check --manifest-path src-tauri/Cargo.toml` + `cargo test --manifest-path src-tauri/Cargo.toml` 通过（对应 test job 内容）。
   - 三处 version 对齐自检：`package.json` / `tauri.conf.json` / `Cargo.toml` 均为同一版本。
   - 图标资产就位（依赖 `infra-icons`）：`src-tauri/icons/` 下 5 个图标存在。
4. **发布演练（可选）**：打 `v0.0.1` tag → 观察三端构建 → Release Draft 产物齐全后手动发布。
