# Design: pipe 验证与集成证据流

## 范围与域

本变更属于 `infra` 域，只调整 pipe 文档和原生 progress CLI/runtime 的验证、恢复与证据记录流程，不改变 MusicTag 产品运行时、Tauri command 或业务数据格式。实现文件由主会话按任务所有权修改：`.agents/skills/pipe/WORKFLOW.md`、`.agents/skills/pipe/SKILL.md`、`.agents/tools/pipe-native/progress-cli.js`、`.agents/tools/pipe-native/progress.js`，以及需要同步的 OpenSpec 归档和 canonical 文档。

Architect 只写本设计与任务文件；主会话仍是 `tasks.md` 勾选、progress 记录和 Git 写入的唯一所有者。

## CI 对齐的 Verify 门禁

仓库当前 CI 的 `validate` job 使用 Node 24，执行以下门禁；Release 的 `test` job 重复前端和 Rust 门禁。Verify 设计为按仓库条件执行同一命令和依赖，不以当前 change 的局部命令替代：

| CI 条件 | CI 依赖 | Verify 证据 |
|---|---|---|
| OpenSpec 存在 | Node 24、网络访问 npm | `npx --yes @fission-ai/openspec@1.5.0 validate --all --strict --no-interactive` |
| `package.json` 存在 | Node 24、`npm ci` 可安装 lockfile 依赖 | `npm ci`、`npm run build`、`npm run test` |
| `src-tauri/Cargo.toml` 存在 | Ubuntu 系统包：`ffmpeg`、`libwebkit2gtk-4.1-dev`、`libayatana-appindicator3-dev`、`librsvg2-dev`、`patchelf`、`build-essential`、`curl`、`wget`、`file`、`libxdo-dev`、`libssl-dev`；stable Rust | 在 `src-tauri` 执行 `cargo check --all-targets`、`cargo test --all-targets` |

Verify 在源码和规格指纹固定后，必须对当前仓库中适用 workflow `if` 条件下的每一条 CI 命令执行同等门禁，并按 CI 条件生成逐命令证据：命令 ID、实际命令、退出码、验证 HEAD、源码指纹、规格指纹和必要的输出摘要。领域特定的 `node --check`、`bash -n`、入口自检等静态检查只能作为补充，不能替代任何适用的 CI 命令。任何 CI job 使用但本地 Verify 未覆盖的门禁都使 Verify 失败；工作流变更必须同时检查 workflow 的条件表达式、工作目录、依赖安装步骤和命令是否仍与设计一致。

## Architect/Tester 的依赖与 fixture 早检

涉及测试或 fixture 的 change 在 Architect 的 design/tasks 中建立测试矩阵，并列出每个外部依赖的来源、版本/安装方式、使用 job、验证命令和失败表现。外部依赖包括系统程序、系统库、Node/Rust toolchain、npm/Cargo 网络依赖、环境变量和真实媒体生成器。

每个 fixture 场景在业务断言前执行确定性有效性检查：生成命令退出码为 0（若由程序生成则检查返回结果）、输出路径存在且为普通文件、大小非零，并由目标 reader 成功解析；需要特定结构时再检查 magic/container、标签类型和关键字段。检查失败必须报告 fixture 名称、依赖命令、路径和原始错误，不能被业务断言吞掉。至少覆盖已有标签、无标签首次写入、清空字段/封面、损坏输入和既有格式回归；每格注明是静态 fixture、生成 fixture 还是不适用。

本 change 本身不新增业务 fixture，也不添加或运行测试；后续实现阶段仅更新流程和 CLI，并用静态/手工验证证明门禁与证据契约。

## CR 后集成期 CI remediation

CR 的三轮上限只统计同一实现差异的 blocker/major 修复循环，原有 `crRound` 不递增也不改写。CR 已通过并进入 integrate 后，如果 required CI 暴露一个此前未见、范围明确的 workflow、runner、依赖或 fixture 环境缺口，主会话追加独立的 `post-CR CI remediation` 记录，包含：失败 job/日志事实、缺口范围、受影响任务、修复文件、为什么不改变产品行为或批准规格，以及新的验证 HEAD。

修复按以下有界顺序执行：

1. 记录 CI 失败事实并将受影响的 Dev/Tester/Verify 检查标为待重做；保留原 CR 通过记录和轮次。
2. 主会话只派发范围聚焦的 remediation 修复；不借机修改产品逻辑或扩大规格。
3. 重新执行受影响的 CI parity、依赖/fixture 早检和 Verify 命令。
4. 对新增差异派发一次独立、只读、范围限定的复审，记录 `post-CR CI remediation` 审查结果、文件、规格引用和源码指纹。该复审不开放写权限、不启动嵌套 Agent，也不替代原 CR。
5. 只有复审和受影响验证通过后才恢复 integrate；若修复改变产品行为、规格、公共 API 或超出批准范围，立即返回 Architect/spec-gate，不能沿用 remediation 路径。

该流程只允许一次聚焦的 remediation 复审尝试；若仍有新的 blocker/major 或范围不清，挂起并交主会话处理，不把它伪装成 CR 第四轮。

## progress CLI 证据输入与紧凑状态

`checkpoint` 增加 `--evidence-file <path>`，通过现有 JSON 解析和 `recordCheckpoint` schema、阶段顺序、source fingerprint 一致性校验载入一个对象。`--evidence-json <inline-json>` 保留且优先级明确：两者同时提供时报错，避免两个证据来源拼接；旧调用无需改动。CLI usage、错误信息和文档同时说明文件路径按当前工作目录解析，并在读取失败、根非对象或 schema 不完整时 fail closed。

`status <change> --compact` 返回稳定的恢复摘要：change、Issue、branch/worktree、owner、各阶段 status/attempt、各集成 checkpoint 的最新 status/attempt，以及 nextStep。摘要不包含完整 command log、evidence 数组、source manifest、manifestSha256 或 manifest 内容；默认 `status` 和 `status --json` 保留现有完整输出，以保证恢复和旧脚本兼容。compact 输出使用固定字段顺序或稳定 JSON 结构，便于人工和脚本比较。

## 集成归档与失败恢复

OpenSpec 归档和 canonical 同步属于 Integrate 的 `archive` checkpoint，必须排在 CR 通过、T5 静态/手工验证和 Verify 成功之后；它们不是 Dev、CR 或 Verify 的前置写入。归档前主会话核对源码/规格快照、当前阶段证据和变更范围，归档后核对 active change 消失且归档内容与 canonical 规则同时出现在待集成 diff。

`archive` 失败时保留 active change、工作树和失败输出，不执行 commit、push、PR 或 merge；主会话记录 checkpoint failed 及可重试的 nextStep。恢复时先重新核对当前分支、HEAD、active change、规格文件和工作树差异，再从 archive 重试；若归档期间发生规格或源码变化，则使后续 Verify/Integrate 证据失效，重新执行受影响阶段后再归档。归档成功后才允许进入 commit checkpoint。

## 文件所有权与验证

主会话拥有 workflow/skill、`progress-cli.js`/`progress.js`、OpenSpec 归档和 canonical 同步文件；开发者不得并行修改这些重叠路径。CLI 实现保持纯本地读写，不启动 subprocess、Agent 或网络请求。

允许的确定性静态/手工验证：

- `node --check .agents/tools/pipe-native/progress.js`
- `node --check .agents/tools/pipe-native/progress-cli.js`
- `node --check .agents/tools/pipe-native/self-check.js`
- `bash -n .agents/workflows/pipe-preflight.sh`
- `bash -n .agents/workflows/pipe-epic-preflight.sh`
- `node .agents/tools/pipe-native/self-check.js`
- `npx --yes @fission-ai/openspec@1.5.0 validate --all --strict --no-interactive`
- 手工检查 CI workflow 的 Node/Rust/system dependency 条件与 Verify 命令矩阵；手工检查 `--evidence-file` 与 inline 互斥、`status --compact` 无 manifest。

上述静态/手工检查不能替代适用 workflow `if` 条件下的 CI 全量命令；它们只补充语法、入口和证据投影检查。

当前任务明确不添加或运行测试；实现阶段若变更已有测试代码，主会话再按 CI parity 规则决定适用验证。

## 兼容性与风险

- 旧 progress 文件不包含新字段时，compact 读取应以空数组/`unknown` 形式安全降级，不重写历史证据；inline evidence 行为必须保持。
- compact 是展示投影，不能被 `resume-apply` 当作完整事实文件；完整恢复仍使用现有 facts/source manifest。
- CI 与本地环境可能不同；依赖早检只证明当前环境和声明的 CI job 一致，不允许把“本地未安装”转换成成功。
- post-CR remediation 只能修复 infra/CI 缺口；任何行为或规格变化都回到 Architect/spec-gate。
