# Tasks: improve-pipe-ci-evidence-flow

## 设计与实现

- [x] T1（infra，所有权：主会话；文件：`.agents/skills/pipe/WORKFLOW.md`、`.agents/skills/pipe/SKILL.md`）：将 Verify 门禁与 `.github/workflows/ci.yml` / `release.yml` 的条件、Node 24、npm、Rust、Ubuntu 系统依赖和命令对齐；加入全量 OpenSpec strict 校验、外部测试依赖/环境变量/fixture 早检要求；定义 CR 通过后的单次有界 `post-CR CI remediation` 及独立只读复审，保留原三轮 CR 上限。
- [x] T2（infra，所有权：主会话；文件：`.agents/tools/pipe-native/progress-cli.js`、`.agents/tools/pipe-native/progress.js`）：为 `checkpoint` 增加 `--evidence-file`，复用 inline typed evidence 的 schema、fingerprint 和阶段顺序校验；inline JSON 保持向后兼容，并对同时传入两个来源 fail closed。
- [x] T3（infra，所有权：主会话；文件：`.agents/tools/pipe-native/progress-cli.js`、`.agents/tools/pipe-native/progress.js`）：增加 `status <change> --compact` 稳定摘要，只输出 change/Issue/branch/worktree/阶段与 checkpoint 状态及 nextStep，不展开日志和 manifests；默认 status 输出保持兼容。

## 规格与归档

- [x] T4（spec/infra，所有权：主会话；文件：本 change 的 spec、design/tasks 归档路径及 canonical 同步位置）：按批准 spec 完成 OpenSpec 归档与 canonical 文档/规则同步；核对归档内容保留 CI parity、fixture 早检、post-CR remediation、evidence-file 和 compact status 的可追溯要求。

## 验证

- [ ] T5（infra，所有权：主会话；不新增或运行测试）：执行 `node --check`（progress.js、progress-cli.js、self-check.js）、相关 workflow 的 `bash -n`、`node .agents/tools/pipe-native/self-check.js` 和 `npx --yes @fission-ai/openspec@1.5.0 validate --all --strict --no-interactive`；手工核对 CI 与 Verify 矩阵、evidence-file/inline 互斥和 compact 输出不含 manifest，并记录实际退出码。

## 依赖与顺序

`T1` 先定义流程证据和文件所有权；`T2`、`T3` 可在 T1 后分别实现但共享 CLI/runtime 文件，必须由主会话顺序修改；`T4` 依赖设计与实现完成；`T5` 依赖 T1–T4。主会话负责每项勾选、progress 记录、Git 写入和最终验证。
