## 变更域与执行顺序

- **Domain：`infra`**。本变更只修改编排基础设施、流程脚本、角色文案和测试；最终门禁跳过 cargo/npm 业务编译。
- **串行依赖：`1 → 2 → 3 → 4 → 5 → 6 → 7 → 8`**。后一组必须在前一组的实现与相关测试通过后开始；当前单 worktree 不并行写入。只有外层显式创建隔离 worktree 时才允许并行。
- **最终 infra 门禁**：Node/shell 静态检查 → pipe-core/workflow-core 全量测试 → self-check → OpenSpec strict validate。

## 1. 状态、事件与命令基础设施

**依赖：** 无。先建立其余确定性节点共用的执行、持久化与错误语义，暂不切换现有 DAG。

- [x] 1.1 先为异步命令 runner 编写失败测试，覆盖实时输出、heartbeat、timeout/取消、进程终止、错误分类、输出截断与 secret 脱敏；再实现 `command-runner`，验证对应 pipe-core 测试通过
- [x] 1.2 先补 state v1/v2→v3 迁移、多 attempt 不覆盖历史以及已有 succeeded 节点落地事实/输入指纹失效的失败测试，再实现 history/checkpoints/summary 原子持久化，验证旧 fixture 可 resume、累计 attempts 不丢失，且失效节点及下游会被标记 dirty
- [x] 1.3 实现确定性错误分类和跨 resume 累计 retry budget，增加 `--force-retry <node>` CLI；验证 permanent fail-fast、transient 预算、unknown Leader 决断、CR/Verify 可自动恢复技术问题及超预算拒绝测试通过

## 2. 混合 DAG 与前置门禁

**依赖：** 任务组 1。双 executor 必须复用已完成的 attempt 持久化、命令 runner 与累计重试语义。

- [x] 2.1 为节点 `kind`、deterministic executor 和 agent executor 共用状态机编写失败测试，再扩展 DAG/core/schema/self-check；验证旧未声明 kind 的测试兼容且内置节点全部显式声明
- [x] 2.2 将 preflight 拆为 bootstrap 与 spec-gate 的可复用确定性检查并保留旧脚本兼容调用；验证 architect 可在两者之间完善 design/tasks，spec-gate 失败会阻止开发节点
- [x] 2.3 更新 pipeline 依赖为 bootstrap→architect→spec-gate→dev/tester/CR→verify→integrate，并验证 deterministic 节点不会触发 fake driver 调用

## 3. Core 统一提交与 Agent 边界

**依赖：** 任务组 2。先让混合 DAG 可运行，再收紧 Agent 权限并把提交所有权移入 core。

- [x] 3.1 先为 HEAD 变化、允许范围内修改、越权路径、ignored 文件和节点启动前已有差异编写失败测试，再实现节点前后工作区快照与 `writeScopes` 审计；验证越权时不暂存、不提交，且不把已有差异误归属给当前节点
- [x] 3.2 实现 core 仅对当前节点新增授权路径执行确定性 add/commit 并落盘 commit SHA，移除 Dev/Tester/fix prompt 和角色中的 git 写入要求；验证无 `.git` 写权限的 fake Agent 仍能完成节点、core 生成唯一提交且不夹带已有差异
- [x] 3.3 更新 capability/roles/self-check，使 Agent 只获得其工作所需文件权限，验证 CR 只读与 Dev/Tester 无 git_write 的 conformance 测试通过

## 4. 动态 CR 与测试分层

**依赖：** 任务组 3。CR 与 Tester 必须消费可信的 core commit SHA、文件范围审计和结构化测试证据。

- [x] 4.1 用当前 change 的 specs/design、Tester 结果、HEAD、diff stat 和提交列表生成 CR prompt，删除固定 191 测试等历史结论；验证 prompt fixture 只包含当前变更证据且允许定向只读 diff
- [x] 4.2 保留 CR 三项复盘专项、finding 四要素与三轮上限，验证不适用标记、blocker/major reroute 和三轮挂起测试通过
- [x] 4.3 将 Dev/Tester 自验证缩小为相关测试并以 scenario 清单驱动 Tester，验证同一 HEAD 不在 Dev/Tester 重复运行完整本地基线

## 5. 确定性 Verify

**依赖：** 任务组 4。Verify 只在 Tester 已提交、CR 已通过的最终 HEAD 上运行完整基线。

- [x] 5.1 先为允许 target/dist/cache 与拒绝源码、规格、fixture、HEAD 修改编写失败测试，再实现 Verify 前后快照和白名单审计，验证污染路径精确报告
- [x] 5.2 用 command runner 实现按域验证计划和短路结果，infra 域覆盖 node/shell 检查、两套测试、self-check、OpenSpec，代码域覆盖 cargo/npm/OpenSpec 基线；验证每条命令产生结构化 step
- [x] 5.3 增加可配置 Rust/前端 lane 并发、汇合门禁和基于 HEAD/命令/环境/输入摘要的缓存；验证默认串行、并行上限、输入变化失效与同一 HEAD cache hit

## 6. 幂等 Integrate

**依赖：** 任务组 5。Integrate 只能消费成功 Verify 的同一 HEAD，并按 checkpoint 顺序产生外部副作用。

- [x] 6.1 建立 integrate checkpoint 状态机和 fake Git/GitHub adapter，先覆盖 archive→commit→sync-main→push→PR→CI→merge→remote→cleanup 的顺序与每步原子落盘
- [x] 6.2 为 archive 先于 PR、活动 change 无残留、canonical spec/实现同 PR 和 core 归档提交增加断言；验证乱序或不完整 diff 在创建 PR 前失败
- [x] 6.3 实现按 head branch get-or-create-pr、required checks 复用、远端 merge 事实核验；验证重复 resume 只产生一个 PR、一轮 CI 和一次 merge
- [x] 6.4 实现 sync-main 的 behind 处理与冲突挂起、already-merged 快进成功、cleanup-local best-effort warning；验证 Issue #127 指定的 branch-behind、远端已合并和本地清理失败回归
- [x] 6.5 调整 archive/create-pr/wait-ci/merge-pr wrappers 输出机器可读结果并保持现有 CLI 兼容，验证 wrapper 单测和 integrate adapter 契约通过

## 7. 可观测性与端到端验收

**依赖：** 任务组 6。只有完整 DAG、提交、Verify 与 Integrate 都落地后才能验证无人值守、幂等和效率目标。

- [x] 7.1 汇总 node/attempt/driver/model/command/commit/cache/CI/人工介入事件，输出总耗时、分类耗时、重试浪费、最慢三阶段及 PR/CI/merge 次数；验证失败后成功仍保留两次 attempt
- [x] 7.2 建立与 Issue #121 同等级的 domain=both 临时仓库 fixture，验证批准后无需主会话干预，bootstrap/spec-gate/verify/integrate 各一轮且 deterministic 节点零 driver 调用
- [x] 7.3 对 archive、PR 已创建、CI 已通过、远端已合并四个 checkpoint 分别中断/resume，验证幂等副作用计数和最终单 PR 完整 diff
- [x] 7.4 用可控时钟/基准事件生成性能报告，验证端到端相对 #121 样本降低至少 35%、代码完成后本地流程不含 CI 不超过 15 分钟

## 8. 全量验证与文档同步

**依赖：** 任务组 7。先用端到端证据确认最终行为，再同步所有入口文档并执行 infra 全量门禁。

- [x] 8.1 更新 pipe skill、AGENTS 入口、角色说明和 workflow 注释以匹配新 DAG/权限/恢复语义，并验证 prompt/skill 漂移审计通过
- [x] 8.2 运行 `node --check`、`bash -n`、`node --test .agents/tools/pipe-core/test/*.test.js tests/workflow-core/*.test.cjs`、`node .agents/tools/pipe-core/run.js --self-check`，验证全部静态与回归门禁通过
- [x] 8.3 运行 `npx openspec validate optimize-pipe-single-change --strict --no-interactive` 并逐项核对 specs scenarios、tasks 完成状态和 Issue #127 九条验收标准均有证据
