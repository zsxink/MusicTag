## MODIFIED Requirements

### Requirement: test 门禁先行
`release.yml` SHALL 设独立 `test` job，运行 cargo check/test + npm test/build 校验通过后，`publish-tauri` job 才允许执行（`needs: test`）。`test` job SHALL 同时运行 pipe 工作流自身的原生测试套件（pipe-core、pipe-native 与 workflow-core 三组 `node --test` 用例，Node 24 下须用 glob 形式）与原生入口自检，使发版前与 PR 校验守住同一套 pipe 质量门。

#### Scenario: 校验失败不发布
- **WHEN** `test` job 中 cargo test 或 npm test 任一失败
- **THEN** `publish-tauri` job 不执行，不产出任何安装包

#### Scenario: 校验通过后构建
- **WHEN** `test` job 全部步骤通过
- **THEN** `publish-tauri` job 才启动三端构建

#### Scenario: 原生套件回归阻断发布
- **WHEN** pipe 原生测试套件或原生入口自检在 `test` job 中失败
- **THEN** `publish-tauri` job 不执行，发版被阻断

#### Scenario: 与 ci.yml 门禁一致
- **WHEN** 某组原生测试套件在 `ci.yml` 中新增或移除
- **THEN** `release.yml` 的 `test` job 同步包含或移除同一套件，两个 workflow 不出现单侧覆盖

### Requirement: 与 ci.yml 校验门禁互补
`release.yml` SHALL 不覆盖 `.github/workflows/ci.yml` 的既有职责（PR/push 校验），二者互补并存。pipe 原生测试套件 SHALL 在两个 workflow 中都运行，且 SHALL 使用相同的 glob 形式与 Node 版本，以使本地 Verify、PR 校验与发版前门禁三者观察到同一组用例。

#### Scenario: ci.yml 职责不变
- **WHEN** 推送 PR 或 push 到 main（不打 tag）
- **THEN** 仅 `ci.yml` 的 `validate` job 运行，`release.yml` 不触发

#### Scenario: 两 workflow 并存
- **WHEN** 打 `v*` tag 且同时存在 PR
- **THEN** `ci.yml` 照常跑 PR 校验，`release.yml` 独立跑发布构建，二者互不冲突

#### Scenario: 三处门禁观察同一组用例
- **WHEN** 任一原生测试套件因新增或删除而变化
- **THEN** `ci.yml`、`release.yml` 与本地验证计划三者包含同一套件集合，不存在只在其中一处执行的用例