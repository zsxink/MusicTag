# workflow-optimize 技术设计

## Context

V1 全量交付后独立复核（#46/#47）在搜索联动核心路径抓到 3 个 major 缺陷，全部在「自测全绿 + CR 两轮通过」后仍漏到交付：

- **A. C2 换源被聚合去重破坏**：后端 `aggregate` 把三家同曲候选折叠为一条（Netease 稳定胜出）→ C2 按 source 换源永远找不到另一家候选（违反 FR-8.8a）。属「跨模块状态语义」缺陷——聚合层的去重决策破坏了上层换源契约。
- **B. searchSeq 全局计数器跨 kind 串扰**：歌词/封面共用单一 `searchSeq`，任一面板搜索作废另一面板在途结果且状态卡 `searching`。属「竞态与串扰」缺陷——共享可变状态被无关操作污染。
- **C. 离线降级误判**：`source_stats` 对「超时」与「正常空结果」都记 0 → 冷门歌一次无结果即 `isOffline` sticky 到重启（FR-8.4a 语义应为网络失败才标离线）。属「网络与离线判定」缺陷——判定依据混淆导致状态错误。

当前基础设施（已复核）：

- `.claude/workflows/music-tag-run.js`：7 阶段编排（前置校验 → 架构 → 开发 → 测试 → CR 三轮 → 验证 → 集成）；CR 只读、`ownerFor` 按文件归属定向打回；验证跑 cargo check/test + npm run build + openspec validate，**未含 npm run test（vitest）**。
- `.claude/workflows/pipe-preflight.sh`：branch/worktree/artifacts/openspec validate --strict/Issue 存在性校验，**无流程脚本静态自检**。
- `openspec/config.yaml`：`all/proposal/specs/tasks` 四类 rules，**无 workflow 类规则**。
- `pipe` skill 与 `cr-agent`/`verify-agent`/`tester`/`leader` agent 定义：职责文本描述，CR 无复盘专项维度，验证基线不一致。

目标：把复盘结论沉淀成可重复执行的质量门。这是**流程/脚本优化**，不改应用功能，不动 `openspec/specs/` 主规格。

## Goals / Non-Goals

**Goals:**
- CR 增加复盘专项审查维度（跨模块状态语义 / 竞态与串扰 / 网络与离线判定），并强化问题分级与证据要求。
- 统一验证基线：`cargo check` + `cargo test` + `npm run test` + `npm run build` + `openspec validate`，全绿才算过。
- 前置校验增加流程脚本静态自检（Node `--check`、Shell `-n`），fail-closed。
- 验证阶段对搜索联动类变更执行复盘缺陷回归清单，`verify.steps` 逐项可见。
- 流水线结果携带 tester / cr（轮次+问题数）/ verify（步骤明细），门禁可审计可回溯。
- 跨 `music-tag-run.js`、`pipe-preflight.sh`、`openspec/config.yaml`、`pipe` skill、`cr-agent`/`verify-agent`/`tester`/`leader` 的文本一致性收口。

**Non-Goals:**
- 不改应用功能：不动 `src/`、`src-tauri/` 业务代码；对应用只做回归验证，不做功能改动。
- 不改动 V1 拍板产品约束（选中即搜、结果不自动写盘、保存全量覆盖、离线降级语义等）。
- 不改 `openspec/specs/` 主规格（本变更无对应 capability，归档只归档 change 本体）。
- 不引入新的 CI 系统/平台；仍沿用本地 verify + GitHub CI required checks 的既有门禁体系。
- 不重写 Workflow 编排器（保持 `.claude/workflows/music-tag-run.js` 结构，只增不拆）。

## 变更域判定

**infra（纯流程/脚本）**，不触发 Rust/Vue 开发角色。实现集中在 `.claude/workflows/`、`openspec/config.yaml`、`pipe` skill、相关 agent 定义；对 `src/`、`src-tauri/` 只跑回归验证。因此开发阶段以「Leader + 流程维护」方式推进，不派 rust-backend/vue-frontend。

## Decisions

### D1 CR 复盘专项审查维度（三检）

在 `cr-agent.md` 的审查维度中新增「复盘专项」三检，明确针对 #46/#47 缺陷族：

1. **跨模块状态语义**：检查聚合/去重/折叠是否破坏上层按源取数/换源契约；身份校验是否防「同名不同歌」（FR-8.8a 语义）。
2. **竞态与串扰**：检查共享计数器/请求序号/全局状态是否跨 kind、跨面板互相污染；在途结果是否会被无关操作作废或卡死。
3. **网络与离线判定**：检查网络失败（超时/HTTP 状态/业务错误码）与正常空结果是否被正确区分；离线/降级是否仅由「全源网络失败」触发。

落点：
- `cr-agent.md`「审查维度」追加第 4 维，给出三类检查的具体问句。
- `music-tag-run.js` CR agent prompt 追加三检提示（对齐 skill 文本，防 prompt 与 skill 漂移）。

### D2 CR 问题分级与证据要求

`cr-agent.md` 明确：阻断/major 每项必须给出 `file` + `issue` + `specReference`（对应 spec requirement / design 决策 / 定稿约束）+ `suggestion`；`pass=true` 仅当「无阻断且无 major」。workflow 的 `CR_SCHEMA` 已含这些字段，无需改 schema，但需在 agent prompt 中显式要求三项齐全，防止「无依据的泛泛问题」打回。

打回路径不变：CR 只读，问题经 Leader 中转，按文件归属定向派回对应开发角色修复后重审（workflow 已有 `ownerFor`）；三轮未过即挂起。

### D3 验证基线统一（含 npm run test）

`verify-agent.md` 与 `music-tag-run.js` 验证 prompt 统一为：

```
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
npm run test          # vitest run（前端单测）
npm run build         # vue-tsc --noEmit && vite build
openspec validate <change>
```

- 顺序与短路：check → test → npm test → npm build → openspec validate；任一 fail 立即停并上报，`verify_failed`。
- 只验证不修复；报告含失败输出。
- `openspec validate` 统一 `--strict --no-interactive`（与 preflight 一致）。
- 同步更新 `pipe` skill「最终验证」描述与 `.claude/CLAUDE.md`「验证」段的命令清单（CLAUDE.md 涉及文案一致性，如需改动放入本变更实现）。

### D4 前置校验：流程脚本静态自检（fail-closed）

`pipe-preflight.sh` 增加流程脚本自检步骤（保持 `set -euo pipefail` 的 fail-closed 语义）：

- 对 `.claude/workflows/*.js` 跑 `node --check <file>`。
- 对 `.claude/workflows/*.sh` 跑 `bash -n <file>`。
- `openspec validate "$change_name" --strict --no-interactive` 保持。
- 任一失败 → `ready=false`，workflow 返回 `failed`（stage=preflight），不进入任何写入。

> 说明：`music-tag-run.js` 的语法错误是静默风险（Workflow 调用时无编译期检查，运行时才炸）。`node --check` 让前置校验在写入前兜住。

### D5 复盘缺陷回归验证清单

`verify-agent.md` 新增「搜索联动回归清单」（仅当变更触及搜索取词/换源/并发/离线降级路径时必执行；否则跳过并在 steps 注明「不适用」）：

1. **单源换源**：按 source 请求另一家候选 → 不被聚合去重折叠/破坏；同名不同歌被身份校验拒绝。
2. **跨 kind 串扰**：歌词与封面面板并发/先后搜索 → 互不作废、无永久「搜索中…」。
3. **离线判定**：全源网络失败 vs 正常空结果 → 仅前者标离线/降级。

落点：`verify.steps` 中逐项以独立 step 呈现（step + status + detail），供审计；缺失任一必选项即 `verify_failed`（对应 spec「回归项可见可审计」）。

### D6 Tester 覆盖审计补「失败路径与边界」维度

`tester.md` 职责 1「测试覆盖审计」扩展：除对照 specs 的 happy-path scenario 外，强制审计**失败路径与边界**——错误分支、空/越界输入、并发/竞态、网络失败与错误码、状态复位。这直接对应复盘缺陷的漏网形态（三个 major 全是失败路径/边界）。

落点：`tester.md` 输出格式的「覆盖情况/缺失/风险」三节明确包含失败路径条目；workflow Tester prompt 强调「未覆盖 scenario（含失败路径）必须列入 missing」。

### D7 Dev 阶段自验证与增量提交规范

`music-tag-run.js` 开发 prompt（`devSpec`）明确：Rust 侧完成跑 `cargo test`、前端完成跑 `npm run build` **与 `npm run test`**，任一失败不得提交；增量提交 `feat(<name>): <任务>` 阶段粒度，崩溃可恢复（CLAUDE.md git 约定已是如此，prompt 显式化防漂移）。

### D8 流水线结果可审计

`music-tag-run.js` 最终返回已含 `tester`、`cr`（rounds + result）、`verify`、`dev`；在 `meta.phases` 与结果结构上补充说明字段（tester.covered/missing、cr.rounds/各级问题数、verify.steps），供 Leader 汇报与留档。失败分支如实返回 `test_failed`/`verify_failed`/`suspended`/`failed`，不降级。

### D9 配置规则补充 workflow 类规则

`openspec/config.yaml` `rules` 增加 `workflow` 类（流程脚本/skill/agent 定义变更的 artifact 规则）：
- 流程脚本变更必须附带静态自检（`node --check` / `bash -n`）通过的证据。
- agent/skill 描述与 workflow prompt 必须保持一致（防 prompt 漂移），变更涉及搜索联动时需在 CR/验证环节体现复盘回归维度。
- proposal 需说明该流程变更如何服务于「拦截同类缺陷」（链接复盘 Issue）。

### D10 文本一致性收口

本变更实现的同时，把优化后的门禁描述同步到 `pipe` skill（阶段详情 ⑤ CR / 最终验证、硬性门槛）与 `verify-agent`/`cr-agent`/`tester`/`leader` 定义，保证 `music-tag-run.js`、skill、agent、CLAUDE.md 四处描述一致，避免「脚本已改、文档仍旧」。

## Risks / Trade-offs

- **门禁收紧的摩擦**：`npm run test` 与复盘回归清单加入验证，会让每变更多跑若干步骤、CR 多问三类问题。权衡：这是「防回归」的固定成本，且只对搜索联动类变更强制回归清单；对纯 infra/文档变更开销有限。
- **静态自检的盲区**：`node --check`/`bash -n` 只查语法，不查语义（如 `agent()` 参数错误）。局限可接受——语法错误是 Workflow 最常见的静默炸点；语义问题仍由 CR/verify 兜底。
- **复盘维度可能导致 CR 过度发散**：三检是「问句清单」而非新增阻塞项，CR 仍需按严重度分级；对非搜索相关变更应标注「不适用」避免形式化。
- **文档漂移**：优化点散在 `music-tag-run.js`、`pipe` skill、4 个 agent 定义、config.yaml 多处，改一处漏一处会造成新的不一致。缓解：D9/D10 显式收口 + 验证基线统一，降低漂移面。
- **验证基线变严**：前端单测纳入最终验证后，原先「build 过但单测失败」的场景会被拦截，可能把既有存量失败暴露为 `verify_failed`。属预期收益（门禁更真），但若出现存量失败需在实现期一并修复。

## 任务拆分建议

依赖顺序（纯 infra，单线程推进，无需分 Rust/Vue 组）：

1. **前置校验（D4）**：`pipe-preflight.sh` 增加流程脚本静态自检（node --check / bash -n）。
2. **CR 门禁（D1、D2）**：`cr-agent.md` 增加复盘专项三检维度 + 问题分级证据要求；`music-tag-run.js` CR prompt 追加三检提示。
3. **验证覆盖（D3、D5）**：`verify-agent.md` 统一验证基线（含 npm run test）+ 搜索联动回归清单；`music-tag-run.js` 验证 prompt 同步。
4. **流水线编排（D6、D7、D8）**：`tester.md` 失败路径维度；`music-tag-run.js` dev 阶段自验证（npm run test）与结果字段补说明。
5. **配置规则（D9）**：`openspec/config.yaml` 增加 `workflow` 类规则。
6. **文本一致性收口（D10）**：同步 `pipe` skill、`leader.md` 与 `.claude/CLAUDE.md` 验证段描述。
7. **验证**：`node --check`/`bash -n` 静态自检；`openspec validate workflow-optimize --strict --no-interactive`；对 `src/`、`src-tauri/` 跑回归验证（cargo test、npm run test、npm run build）确认门禁收紧未破坏既有构建/测试；可选 `npm run tauri dev` 人工冒烟（跨端契约未变，视需要）。

> 说明：本变更为纯 infra，不派 rust-backend/vue-frontend；「开发」阶段由 Leader/流程维护直接改 `.claude/` 与 `openspec/config.yaml`，提交走 `feat(53): <任务>` 增量提交。
