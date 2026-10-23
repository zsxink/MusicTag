## ADDED Requirements

### Requirement: 全平台构建成功后自动发布 Release

`release.yml` SHALL 在 `publish-tauri` 的全部 matrix 条目构建成功后自动把对应 tag 的 draft Release 转为已发布,SHALL NOT 依赖人工 publish 才触发下游 tap 同步。

#### Scenario: 全部平台成功后自动发布

- **WHEN** `publish-tauri` 的全部 matrix 条目(Windows、macOS aarch64、macOS x86_64、Linux)构建与资产上传成功
- **THEN** `publish-release` job 将该 tag 对应的 draft Release 转为已发布状态

#### Scenario: 任一平台失败不发布

- **WHEN** 任一 matrix 条目构建或资产上传失败
- **THEN** `publish-release` job 不执行,Release 保留草稿态,可人工 publish 兜底

#### Scenario: 重跑幂等

- **WHEN** Release 已处于已发布状态后再次运行 `publish-release` job
- **THEN** 发布步骤幂等成功,不产生错误

#### Scenario: 自动发布触发 tap 同步

- **WHEN** `publish-release` job 自动发布完成
- **THEN** 无需人工操作即触发 `homebrew.yml` 同步 tap(GitHub 对 `GITHUB_TOKEN` 事件触发的抑制由 job 内显式 workflow_dispatch 兜底)

## MODIFIED Requirements

### Requirement: 三端产物齐全并挂载 Release

`publish-tauri` job SHALL 产出可安装安装包并上传到 GitHub Release。

#### Scenario: Windows 产物

- **WHEN** 在 `windows-latest` 上完成构建
- **THEN** 产出 `.msi` 与 `-setup.exe`(NSIS + WiX)并上传 Release

#### Scenario: macOS 双架构产物

- **WHEN** 在 `macos-latest` 上以 aarch64 与 x86_64 两个 matrix 条目构建
- **THEN** 每个架构各产出 `.dmg` 与 `.app` 并上传 Release

#### Scenario: Linux 产物

- **WHEN** 在 `ubuntu-22.04` 上完成构建
- **THEN** 产出 `.deb`、`.rpm`、`.AppImage` 并上传 Release

#### Scenario: Release 草稿自动转正

- **WHEN** 三端构建完成、产物上传成功
- **THEN** GitHub Release 先以草稿(Draft)状态承载资产,并在全部 matrix 条目成功后由 `publish-release` job 自动发布,无需人工核对
