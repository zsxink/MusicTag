## ADDED Requirements

### Requirement: tag 触发三端并行发布构建
打 `v*` tag（push 到远程）SHALL 触发 `.github/workflows/release.yml`，三端（Windows / macOS / Linux）并行构建安装包。

#### Scenario: v* tag 触发 workflow
- **WHEN** 在 main 上打并推送 `v0.1.0` 之类的 `v*` tag
- **THEN** `release.yml` 被触发，`publish-tauri` job 的 matrix 三端并行开始构建

#### Scenario: 非 v* tag 不触发
- **WHEN** 推送不含 `v` 前缀的 tag（如 `test-1`）或不推送 tag
- **THEN** `release.yml` 不被触发

#### Scenario: 三端并行且互不拖累
- **WHEN** 三端并行构建
- **THEN** `fail-fast: false`，任一端失败不取消其余端

### Requirement: test 门禁先行
`release.yml` SHALL 设独立 `test` job，运行 cargo check/test + npm test/build 校验通过后，`publish-tauri` job 才允许执行（`needs: test`）。

#### Scenario: 校验失败不发布
- **WHEN** `test` job 中 cargo test 或 npm test 任一失败
- **THEN** `publish-tauri` job 不执行，不产出任何安装包

#### Scenario: 校验通过后构建
- **WHEN** `test` job 全部步骤通过
- **THEN** `publish-tauri` job 才启动三端构建

### Requirement: 三端产物齐全并挂载 Release
`publish-tauri` job SHALL 产出可安装安装包并上传到 GitHub Release。

#### Scenario: Windows 产物
- **WHEN** 在 `windows-latest` 上完成构建
- **THEN** 产出 `.msi` 与 `-setup.exe`（NSIS + WiX）并上传 Release

#### Scenario: macOS 双架构产物
- **WHEN** 在 `macos-latest` 上以 aarch64 与 x86_64 两个 matrix 条目构建
- **THEN** 每个架构各产出 `.dmg` 与 `.app` 并上传 Release

#### Scenario: Linux 产物
- **WHEN** 在 `ubuntu-22.04` 上完成构建
- **THEN** 产出 `.deb`、`.rpm`、`.AppImage` 并上传 Release

#### Scenario: Release 草稿
- **WHEN** 三端构建完成、产物上传成功
- **THEN** GitHub Release 以草稿（Draft）状态创建，待人工核对后手动发布

### Requirement: workflow 权限与配置正确
`release.yml` SHALL 声明最小必要权限与决定性配置。

#### Scenario: permissions 正确
- **WHEN** workflow 定义 `permissions: contents: write`
- **THEN** tauri-action 能创建 Release、上传产物（无更高权限）

#### Scenario: tagName 版本对齐
- **WHEN** `tauri.conf.json` 版本为 `0.1.0` 且打 tag `v0.1.0`
- **THEN** tauri-action 生成的 Release tag 名为 `v0.1.0`（`tagName: v__VERSION__`），与三处版本手动对齐

### Requirement: 与 ci.yml 校验门禁互补
`release.yml` SHALL 不覆盖 `.github/workflows/ci.yml` 的既有职责（PR/push 校验），二者互补并存。

#### Scenario: ci.yml 职责不变
- **WHEN** 推送 PR 或 push 到 main（不打 tag）
- **THEN** 仅 `ci.yml` 的 `validate` job 运行，`release.yml` 不触发

#### Scenario: 两 workflow 并存
- **WHEN** 打 `v*` tag 且同时存在 PR
- **THEN** `ci.yml` 照常跑 PR 校验，`release.yml` 独立跑发布构建，二者互不冲突
