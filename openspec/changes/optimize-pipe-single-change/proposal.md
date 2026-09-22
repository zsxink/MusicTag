## Why

Issue [#127](https://github.com/zsxink/MusicTag/issues/127) 复盘发现，当前单变更 pipe 虽能保证交付质量，但确定性步骤仍依赖 LLM、验证权限与真实写入行为冲突、集成缺乏幂等 checkpoint，导致一次普通跨端变更产生 33 次节点调用、两个 PR 和约 2 小时 14 分钟端到端耗时。需要把机械流程收回 core，以可恢复状态机和可观测证据实现“需求确认后无人值守”。

## What Changes

- 将单变更 DAG 调整为 `bootstrap → architect → spec-gate → dev → tester → cr → verify → integrate`，其中 bootstrap/spec-gate/verify/integrate 由 core 确定性执行，只有需要判断或生成的节点调用 Agent。
- 新增异步命令执行器：实时转发输出、定期 heartbeat、超时/取消、结构化命令证据与源码快照审计；Verify 允许写构建产物但不得改源码、规格或 HEAD。
- 将 integrate 改为持久化、幂等的 checkpoint 状态机，保证归档先于 PR，同一 change 只创建一个 PR，并可从任意已完成步骤恢复。
- 引入跨 resume 的累计重试预算和确定性错误分类；配置、权限、认证、schema 等永久错误 fail-fast，瞬态错误按预算重试。
- Dev/Tester 不再直接提交；core 在文件范围和测试证据通过后统一提交，避免 Agent 与 `.git` 权限冲突。
- 分层执行测试：Dev/Tester 只跑相关测试，Verify 在同一 HEAD 上执行唯一一次本地完整基线；支持 Rust/前端验证 lane 的受控并行。
- CR 动态接收当前 change 的 specs、diff、Tester 结果与 commit SHA，可定向读取真实 diff；移除与当前变更无关的硬编码测试数量或结论。
- 将状态升级为带逐 attempt 历史和汇总指标的格式，记录模型、命令、错误、提交、CI、重试和耗时，并输出最慢阶段及人工介入次数。
- 保留并强化 Issue #46/#47 复盘门禁：真实 CR 仍检查跨模块状态语义、竞态串扰、网络/离线判定；最终验证仍按变更域执行既有质量基线。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `workflow-core`: 将单变更 pipe 从“所有节点均由 Agent 驱动”升级为确定性 core runner、幂等集成、累计重试、统一提交、动态 CR 证据、分层验证和逐 attempt 可观测性。

## Impact

- 主要影响 `.agents/tools/pipe-core/`、`.agents/commands/`、`.agents/workflows/`、相关角色提示词与测试夹具。
- 状态文件 schema 将升级并兼容迁移旧运行记录；`--resume`、driver contract 和 Epic worktree 路径语义必须保持兼容。
- 不改变 MusicTag 产品功能、Tauri command、Rust/Vue 业务实现或 V1 已拍板行为。
- 验证基线：`node --check`、`node --test .agents/tools/pipe-core/test/*.test.js tests/workflow-core/*.test.cjs`、`node .agents/tools/pipe-core/run.js --self-check`、`npx openspec validate optimize-pipe-single-change --strict --no-interactive`；新增重复 PR、归档乱序、branch behind、远端已合并、本地清理失败、源码快照污染、累计重试和 attempt 指标回归门禁。
