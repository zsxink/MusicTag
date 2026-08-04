# workflow-optimize 任务清单

> 变更域：infra（纯流程/脚本），不派 rust-backend/vue-frontend。依赖顺序：前置校验 → CR 门禁 → 验证覆盖 → 流水线编排 → 配置规则 → 文本收口 → 验证。每组内按序勾选；每批完成做 `feat(53): <任务>` 增量提交。

## 1. 前置校验：流程脚本静态自检（design.md D4）

- [ ] 1.1 `pipe-preflight.sh`：对 `.claude/workflows/*.js` 增加 `node --check`（语法静默炸点兜底；Workflow 无编译期检查）
- [ ] 1.2 `pipe-preflight.sh`：对 `.claude/workflows/*.sh` 增加 `bash -n` 语法检查
- [ ] 1.3 保持 fail-closed：任一静态自检失败 → `ready=false`、workflow 返回 `failed`（stage=preflight），不进入任何写入
- [ ] 1.4 手工验证：故意在临时脚本制造语法错误 → preflight 拦截；恢复后通过

## 2. CR 门禁：复盘专项维度 + 问题分级证据（design.md D1、D2）

- [ ] 2.1 `cr-agent.md` 审查维度新增第 4 维「复盘专项」三检：
  - [ ] 跨模块状态语义：聚合/去重/折叠是否破坏按源换源；身份校验防同名不同歌（FR-8.8a）
  - [ ] 竞态与串扰：共享计数器/请求序号/全局状态是否跨 kind/面板互相污染、在途结果作废或卡死
  - [ ] 网络与离线判定：网络失败（超时/HTTP 状态/业务错误码）与正常空结果区分；离线仅由全源网络失败触发
- [ ] 2.2 `cr-agent.md` 强化问题分级证据要求：阻断/major 每项必含 file + issue + specReference + suggestion；`pass=true` 仅当无阻断且无 major
- [ ] 2.3 `music-tag-run.js` CR agent prompt 追加三检提示（与 skill/agent 文本一致，防 prompt 漂移）

## 3. 验证覆盖：基线统一 + 搜索联动回归清单（design.md D3、D5）

- [ ] 3.1 `verify-agent.md` 统一验证基线：cargo check → cargo test → npm run test → npm run build → openspec validate（任一 fail 即 `verify_failed`，只验证不修复）
- [ ] 3.2 `music-tag-run.js` 验证 prompt 同步基线（原缺 npm run test；`openspec validate` 统一 `--strict --no-interactive`）
- [ ] 3.3 `verify-agent.md` 新增「搜索联动回归清单」（仅搜索/换源/并发/离线相关变更必执行，否则 steps 注明「不适用」）：
  - [ ] 单源换源不被聚合去重破坏、同名不同歌被拒绝
  - [ ] 歌词/封面跨 kind 不串扰、无永久「搜索中…」
  - [ ] 离线判定区分全源网络失败 vs 正常空结果
- [ ] 3.4 回归项以独立 step 入 `verify.steps`（step + status + detail），缺失必选项即 `verify_failed`

## 4. 流水线编排：Tester 失败路径 + Dev 自验证 + 结果可审计（design.md D6、D7、D8）

- [ ] 4.1 `tester.md` 覆盖审计补「失败路径与边界」维度：错误分支、空/越界输入、并发/竞态、网络失败与错误码、状态复位；输出三节含失败路径条目
- [ ] 4.2 `music-tag-run.js` Tester prompt 强调未覆盖 scenario（含失败路径）必须列入 missing
- [ ] 4.3 `music-tag-run.js` `devSpec`：Rust 完成跑 `cargo test`、前端完成跑 `npm run build` + `npm run test`，任一失败不得提交；增量提交 `feat(53): <任务>`
- [ ] 4.4 `music-tag-run.js` 结果字段补说明：tester.covered/missing、cr.rounds + 各级问题数、verify.steps（供 Leader 汇报与留档）

## 5. 配置规则：openspec workflow 类（design.md D9）

- [ ] 5.1 `openspec/config.yaml` `rules` 增加 `workflow` 类：流程脚本变更须附带静态自检通过证据
- [ ] 5.2 `workflow` 规则：agent/skill 描述与 workflow prompt 保持一致（防漂移）；涉及搜索联动须在 CR/验证体现复盘回归维度
- [ ] 5.3 `workflow` 规则：proposal 说明该流程变更如何拦截同类缺陷（链接复盘 Issue #46/#47）

## 6. 文本一致性收口（design.md D10）

- [ ] 6.1 `pipe` skill 阶段详情 ⑤ CR / 最终验证 与「硬性门槛」同步新门禁描述（复盘专项维度、npm run test、回归清单）
- [ ] 6.2 `leader.md` 质量门顺序与验证基线描述同步
- [ ] 6.3 `.claude/CLAUDE.md`「验证」段命令清单同步（含 `npm run test`），与 `verify-agent.md` 一致
- [ ] 6.4 自查：`music-tag-run.js`、`pipe` skill、`cr-agent`/`verify-agent`/`tester`/`leader`、CLAUDE.md 四处描述一致无漂移

## 7. 验证

- [ ] 7.1 静态自检：`node --check .claude/workflows/music-tag-run.js`、`bash -n .claude/workflows/pipe-preflight.sh .claude/workflows/pipe-epic-preflight.sh` 通过
- [ ] 7.2 `openspec validate workflow-optimize --strict --no-interactive` 通过
- [ ] 7.3 回归验证确认门禁收紧未破坏既有构建/测试：
  - [ ] `cargo check --manifest-path src-tauri/Cargo.toml` + `cargo test --manifest-path src-tauri/Cargo.toml` 通过
  - [ ] `npm run test` + `npm run build` 通过
- [ ] 7.4 全量 `openspec validate --all` 通过（主规格未动，确认无回归）
- [ ] 7.5 可选：`npm run tauri dev` 人工冒烟（跨端契约未变，视需要）
- [ ] 7.6 按 Issue #53 提交 PR：`git push -u origin workflow-optimize` + `gh pr create --base main --head workflow-optimize --body "Closes #53"`
