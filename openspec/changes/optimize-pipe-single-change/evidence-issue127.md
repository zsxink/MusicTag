# Issue #127 验收标准证据核对（任务组 8.3）

> 任务 8.3 交付：逐项核对 Issue #127 九条验收标准均有实现/测试证据。
> 核对基线：分支 `optimize-pipe-single-change`（`main` 相对），2026-09-23。
> 全量门禁已通过：`node --check`（core 全部 js）、`bash -n`（workflows 全部 sh）、
> `node --test ".agents/tools/pipe-core/test/*.test.js" "tests/workflow-core/*.test.cjs"`（263/263 绿）、
> `node .agents/tools/pipe-core/run.js --self-check`（通过）、`npx openspec validate optimize-pipe-single-change --strict --no-interactive`（通过）。

## 九条验收标准 → 证据映射

| # | 验收标准 | 实现证据 | 测试证据 |
|---|---|---|---|
| 1 | 批准后可无人值守跑到合并，不需主会话修权限/代提交/同步分支 | `core.js` runNode（统一提交 + 决断链）、`pipeline.js` deterministic 节点、`integrate.js` checkpoint 状态机 | `tests/workflow-core/both-domain-e2e.test.cjs`「7.2: domain=both 端到端无人值守闭环」 |
| 2 | preflight/spec-gate、verify、integrate 各只执行一次，重试不超预算 | `pipeline.js` bootstrap/spec-gate/verify/integrate 节点 `retry.max`、`decision.js` 累计预算 | `both-domain-e2e.test.cjs`（history 各 len=1）、`tests/workflow-core/coverage-gap.test.cjs`、`metrics-e2e.test.cjs` |
| 3 | 同一 change 只产生 1 个 PR / 1 轮 CI / 1 次 merge | `integrate.js` `get-or-create-pr` / `wait-required-ci` / `merge` checkpoint 复用 | `both-domain-e2e.test.cjs`（summary.prCount/ciCount/mergeCount = 1）、`checkpoint-resume.test.cjs` |
| 4 | PR 同时含实现 + 归档 + canonical spec，不二次补归档 | `integrate.js` commit checkpoint 断言 archive 先于 PR、diff 校验 | `checkpoint-resume.test.cjs`（commit.evidence.files 含实现 + openspec）、`6.2` 相关联于 `integrate.test.js` |
| 5 | Verify 允许写构建产物但源码/规格/HEAD 不可变 | `verify.js` BUILD_WHITELIST + workspace.snapshot/audit | `.agents/tools/pipe-core/test/verify.test.js`（污染路径精确报告）、`5.1` |
| 6 | CR 用当前变更真实 specs/diff/Tester 证据，无硬编码结论 | `cr-prompt.js` buildCrPrompt（动态证据注入） | `tests/workflow-core/cr-scoping.test.cjs`、`.agents/tools/pipe-core/test/cr-prompt.test.js`（7 用例全绿） |
| 7 | resume 在任意 checkpoint 后幂等 | `integrate.js` checkpoint 落盘 + `core.js` resume 复用 | `tests/workflow-core/checkpoint-resume.test.cjs`（四中断点遍历） |
| 8 | 生成逐 attempt 耗时报告，可定位重试/等待成本 | `metrics.js` finalizeRun + events.jsonl + state.summary | `tests/workflow-core/metrics-e2e.test.cjs`（摘要字段 + 唯一 events）、`metrics.test.js` |
| 9 | 端到端相对 #121 降低 ≥35%，本地流程 ≤15min | `metrics.js` baseline 判定 + summary 字段 | `both-domain-e2e.test.cjs`（PIPE_BASELINE_MS 10s、totalDuration < 6.5s、postCodeLocal ≤ 15min） |

## 其它核对

- **specs scenarios 覆盖**：`specs/workflow-core/spec.md` 各 requirement 的 scenario 均有对应测试（见 `tests/workflow-core/*.test.cjs` 与 `.agents/tools/pipe-core/test/*.test.js`），已由 263 项全绿门禁背书。
- **任务组 4 完成状态**（4.1–4.3 实现已落地，勾选待 8.3 统一核对）：cr-prompt.js 动态证据、scoped devSpec、scenario 驱动 Tester 均已实现并有测试（cr-prompt.test.js / tester-boundary-audit.test.cjs / coverage-gap.test.cjs）。核对结论：完成，已在本核对中背书。
- **8.2 门禁命令形态**：`node --test` 在本机 Node v24 需 glob 形式；目录形式会报 MODULE_NOT_FOUND。verify.js infra 计划的目录形式在部分 Node 版本可能失败（实现层观察，不在本任务改动面内，特此记录）。

## 障碍记录（如实上报）

- `.claude/CLAUDE.md`（含「增量提交」旧语义）与 `.claude/commands/pipe.md`（含 `preflight`/`增量提交`/`Verify 代理` 旧语义）存在文档漂移；本次 dev-docs 节点写入被驱动权限拦截（`.claude/` 敏感目录写拦截），未能本节点同步。AGENTS.md 已完整对齐新 DAG/权限/恢复语义。待 Leader 在主会话授权后同步或由人工处理。
- 8.1 因上述权限边界标记为未完成；8.2 / 8.3 已完成并勾选。