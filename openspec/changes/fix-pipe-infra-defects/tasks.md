## 1. openspec 规则有效性（Issue 第 1 条，根因修正）

> 按 design D0：`rules.all` 是死键（`instruction-loader.js:118` 精确键取值，schema 只定义 proposal/specs/design/tasks），自 `ae058b2` 起从未生效。本组做法是**把两条全局规则移入全局 `context` 块并删除 `all`**，而非仅加引号。

- [x] 1.1 给含 `feat(<issue>): <任务>` 冒号+空格的条目加引号，并把 `rules.all` 的两条规则移入顶层 `context` 块、删除 `all` 键；**全量审计 `rules` 下每一条条目**（不止 `all[0]`），对含 `:`+空格或 ` #` 的项加引号——实测 `rules.design[1]` 的 `（Issue #46/#47）` 同样被 YAML 注释截断，属同一机制
- [x] 1.2 对 `proposal`/`specs`/`design`/`tasks` 四个 artifact 逐一运行 `openspec instructions <id> --change <change> --json`，确认 rules 解析告警归零、每个 artifact 的 `rules` 非空、且四份 `context` 均含「Issue 驱动」与「Epic 拆分」两条约束
- [x] 1.3 新增测试 `.agents/tools/pipe-native/test/config-rules.test.js`（**零外部依赖**，不 require `yaml`）：对 config.yaml 原文断言 `rules` 下不存在 `all` 键、各条目引号闭合且以 `- ` 开头非空、两条全局规则出现在 `context` 块内

## 2. openspec 版本固定（Issue 第 1 条，hardening）

- [x] 2.1 新增共享版本常量模块，导出 openspec 固定版本与派生的 npx 参数数组
- [x] 2.2 `archive-change.js` 改用该常量，不再裸调 PATH `openspec`；`verify.js:42/51/64/66` 的 `npx openspec` 一并改用固定版本
- [x] 2.3 `pipe-preflight.sh:38` 与 `pipe-epic-preflight.sh:79` 改为 `npx --yes @fission-ai/openspec@1.5.0`；`integrate.js:304` 的回退分支同步
- [x] 2.4 在 `self-check.js` 增加检查：扫描上述全部 openspec 调用点，任一未固定版本即 fail-closed 并指明文件与行
- [x] 2.5 新增测试：断言各调用点固定了版本；断言移除版本后自检确实失败（红测验证 fail-closed 有效）
- [x] 2.6 散文指令面与权限白名单固定（Dev 阶段用户裁决「全修」，见 design D1 扩展）：17 个指令文件（管道面 5 + `WORKFLOW.md` 另一处 + `verify.md` + 6 个 `opsx/*` + 5 个 `openspec-*` skill）全部改为 `npx --yes @fission-ai/openspec@1.5.0 …`，`.opencode` 白名单一行用 `@*` 版本通配；`self-check.js` 新增 `OPENSPEC_PROSE_CALL_SITES` 裸散文扫描；红测覆盖 `WORKFLOW.md` / `AGENTS.md` / 权限白名单三处回退

## 3. 源码指纹消除提交状态漂移（Issue 第 2 条）

- [x] 3.1 先补红测：构造「删除 tracked 文件但未提交」场景，断言提交删除前后指纹相同（当前实现必然失败）
- [x] 3.2 `source-fingerprint.js` 改为遍历工作区文件系统构建路径集合，用 `git check-ignore` 排除忽略路径；排除集合加入 `.git`，其余排除项与 UTF-8 字节升序排序保持不变
- [x] 3.3 kind 收敛为 `file` / `symlink`；符号链接仍记录 link target 摘要
- [x] 3.4 `fingerprintVersion` 递增为 `pipe-source-fingerprint/v2`
- [x] 3.5 同步 `progress.js:17` 版本常量与 `progress.js:51` kind 白名单；确认旧版本指纹证据的处理方式（见 design Open Questions）
- [x] 3.6 更新 `.agents/skills/pipe/WORKFLOW.md` 与 `openspec/specs/workflow-core/spec.md` 的指纹 kind 表述
- [x] 3.7 补测试：内容修改、新增文件、删除文件均改变指纹；同一内容在删除提交前后指纹相同；归档移动不改变指纹（既有 `native-entry-contract.test.cjs` 的 cwd/归档/敏感性用例须仍通过）
- [x] 3.8 性能与体积核对：确认在真实仓库规模下指纹计算耗时与 manifest 体积可接受，且忽略路径未混入

## 4. wait-ci 瞬时错误自愈与可区分（Issue 第 3 条）

- [x] 4.1 先补红测：伪造 `gh` 前 N 次 EOF 后成功，断言命令最终返回真实 checks 事实且退出 0（当前实现必然失败）
- [x] 4.2 实现错误分类，区分可重试（EOF / connection reset / timeout / 5xx / `ETIMEDOUT` / `ECONNRESET`）与不可重试（认证失败 / 无 required checks / 参数错误）
- [x] 4.3 对可重试错误实现有上限的退避重试（次数与退避上限明确，且不超出总 timeout 预算）
- [x] 4.4 输出增加 `errorKind` 字段，区分「取不到远端事实」与「required checks 未通过」；保持既有退出码语义（成功 0 / 失败 1 / 用法错误 2）
- [x] 4.5 把 15 秒忙等改为定时器等待
- [x] 4.6 补测试：持续 EOF 耗尽重试后 exit 1 且 `errorKind` 为网络类，与真实 CI 失败的 `errorKind` 不同；既有 `commands.test.js` 的 exit 0/1 与 JSON 形状断言仍通过

## 5. CI 运行原生测试套件（Issue 第 4 条）

- [x] 5.1 `ci.yml` 的 `validate` job 追加一步：Node 24 下用 glob 形式运行 `node --test` 覆盖 pipe-core + workflow-core + pipe-native 三组，并运行 `self-check.js`
- [x] 5.2 `release.yml` 的 `test` job 追加同样门禁，使发版前守住同一套件集合
- [x] 5.3 `verify.js` infra 计划补上遗漏的 `.agents/tools/pipe-native/test/*.test.js`
- [x] 5.4 新增 `.agents/tools/pipe-core/test/ci-suite-contract.test.js` 断言：`ci.yml`、`release.yml` 与 `verify.js` 三处套件集合一致且都含 `self-check.js`，防止单侧覆盖复发（不写入 `native-entry-contract.test.cjs`——该文件由任务组 3 独占，避免并行写冲突）
- [x] 5.5 确认三处使用的 glob 形式在 Node 24 下可执行（避免 `MODULE_NOT_FOUND`），并实际运行一次全套件记录退出码

## 6. 验证与集成

- [x] 6.1 依序执行：`node .agents/tools/pipe-native/self-check.js`、`node --check`（所有改动 JS）、`bash -n`（两个 preflight）、三组 `node --test`、`node .agents/tools/pipe-native/source-fingerprint.js`
- [x] 6.2 运行 `npx --yes @fission-ai/openspec@1.5.0 validate --all --strict --no-interactive`（全量，不能只校验当前 change）——exit 0，Totals: 30 passed, 0 failed
- [x] 6.3 按 CI 的 `if` 条件确认业务域基线适用性并如实记录退出码（本变更不触碰产品代码）——CI `if` 为 `hashFiles` 存在性检查（恒真）故四项适用，全部如实执行：`cargo check` exit 0、`cargo test` exit 0（全绿 0 failed）、`npm run test` exit 0（28 files / 493 tests 全过）、`npm run build` exit 0
- [x] 6.4 运行 `node .agents/tools/pipe-native/source-fingerprint.js` 写入 verify 阶段的 source manifest，并在每个集成 checkpoint 前复算比对——已写入 `.agents/runs/fix-pipe-infra-defects/source-manifest.json`（v2 / `53d946a6…` / 311 条 / 排除路径泄漏 0，与 6.1 复算一致）；integrate 各 checkpoint 前复算比对
- [x] 6.5 同步 `docs/` 中受影响的文档表述（若涉及），确认与 `docs/V1-PRD.md` / `docs/design/design.md` 无冲突——本变更 0 处 `docs/` 改动、0 处产品代码（`src/`、`src-tauri/`、`package.json`）改动，infra 域与产品文档天然无冲突

> 说明：本变更为 infra 域，不涉及 Rust/前端任务，故不附 lofty/加密/封面相关任务；产品代码零改动。