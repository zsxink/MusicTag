# ci-release 任务清单

> 纯配置变更（域 infra，依赖 `infra-icons`），单文件新增 `.github/workflows/release.yml`；顺序执行，无并行分组。任务完成后验证项全绿方可提交 PR。

## 1. 新增 release.yml（design.md D1–D8）

- [ ] 1.1 触发：`on: push: tags: ['v*']`（tag 推送触发；与 ci.yml 的 PR/main push 触发正交，D1）
- [ ] 1.2 `test` job（ubuntu-latest，跑一次）：
  - [ ] checkout + `setup-node@v4`（node 24）
  - [ ] `npm ci` + `npm run build` + `npm run test`（前端校验）
  - [ ] Linux 系统依赖安装（`libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf build-essential curl wget file libxdo-dev libssl-dev`）
  - [ ] `dtolnay/rust-toolchain@stable` + `cargo check --all-targets` + `cargo test --all-targets`（working-directory: src-tauri）
- [ ] 1.3 `publish-tauri` job：`needs: test` 门禁 + `if: startsWith(github.ref, 'refs/tags/v')`
- [ ] 1.4 matrix：`include` 四条目——`windows-latest('')` / `macos-latest('--target aarch64-apple-darwin')` / `macos-latest('--target x86_64-apple-darwin')` / `ubuntu-22.04('')`；`fail-fast: false`（D2）
- [ ] 1.5 `permissions: contents: write`（仅 publish-tauri job；test job 默认只读，D6）
- [ ] 1.6 缓存：`setup-node` 带 `cache: npm` + `swatinem/rust-cache@v2`（`workspaces: './src-tauri -> target'`，D5）
- [ ] 1.7 Linux 依赖安装 step（`if: matrix.platform == 'ubuntu-22.04'`，`ubuntu-22.04` 固定，D3）
- [ ] 1.8 `tauri-apps/tauri-action@v1`：`env: GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}`；`tagName: v__VERSION__` / `releaseName: 'v__VERSION__'` / `releaseDraft: true` / `prerelease: false` / `args: ${{ matrix.args }}`（D7/D8）

## 2. 配置 macOS ad-hoc 签名（design.md D4）

- [ ] 2.1 核对 `src-tauri/tauri.conf.json` `bundle.macOS.signingIdentity: "-"`（ad-hoc；无开发者证书）
- [ ] 2.2 确认 `bundle.icon` 五项图标资产在 `src-tauri/icons/` 就位（依赖 `infra-icons`：32x32.png / 128x128.png / 128x128@2x.png / icon.icns / icon.ico）

## 3. 验证

- [ ] 3.1 workflow 语法检查：
  - [ ] YAML 解析通过（`yamllint` 或 `python -c 'import yaml,sys; yaml.safe_load(open(...))'`）
  - [ ] `gh workflow list` 能看到 `release.yml`；push 分支后 `gh workflow run` 可触发（或 `actionlint` 本地校验）
- [ ] 3.2 本地等价校验（对应 test job 内容）：
  - [ ] `npm run build` 通过
  - [ ] `npm run test` 通过
  - [ ] `cargo check --manifest-path src-tauri/Cargo.toml --all-targets` 通过
  - [ ] `cargo test --manifest-path src-tauri/Cargo.toml --all-targets` 通过
- [ ] 3.3 三处版本对齐自检：`package.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml` 的 `version` 一致（当前均 `0.1.0`；首个 tag 为 `v0.1.0`，D7）
- [ ] 3.4 仓库卫生：`git status` 确认仅新增 `.github/workflows/release.yml` + 本变更 OpenSpec artifacts，未触碰 `.github/workflows/ci.yml` 与产品代码
- [ ] 3.5 （可选演练）打 `v0.0.1` tag → 观察 `test` 门禁 + 三端构建 → Release Draft 产物齐全（`.msi`/`-setup.exe`/`.dmg`/`.app`/`.deb`/`.rpm`/`.AppImage`）→ 人工核对后手动发布
