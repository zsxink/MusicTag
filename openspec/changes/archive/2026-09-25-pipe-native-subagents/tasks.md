## 1. 共享协议与记录

- [x] 1.1 编写主会话 `WORKFLOW.md`，覆盖单变更阶段、原生派发/回报、决策权限、重试、CR、Verify 和集成；核对每个 spec 场景均有执行步骤。
- [x] 1.2 实现 `progress.md` 模板、唯一写入锁、原子更新、旧会话安全接管和旧 `state.json` 只读迁移；用状态工具检查新建、冲突、迁移和恢复记录。
- [x] 1.3 编写 Epic 原生调度和 Markdown 进度协议，覆盖 dependsOn、≤3 并发、worktree 隔离与合并解锁；检查示例 DAG 的就绪集。

## 2. 宿主入口与角色

- [x] 2.1 更新 Codex `AGENTS.md`、pipe skill 和公共角色规则，明确主会话 Leader、任务所有权及 capability；检查所有入口均引用同一共享协议。
- [x] 2.2 更新 Claude Code 原生命令与 Agent 注册，删除正式入口的 Node/CLI driver 调用；静态检查入口和权限。
- [x] 2.3 更新 OpenCode 原生命令与 Agent 注册，删除正式入口的 Node/CLI driver 调用；静态检查入口和权限。

## 3. 确定性门禁与旧入口退役

- [x] 3.1 更新 preflight/self-check，校验共享协议、宿主入口、角色、模板和脚本语法，保持 Issue/分支/OpenSpec 检查；运行自检确认失败会阻断。
- [x] 3.2 退役 `run.js` 的正式 Agent 启动路径，旧状态保留只读，清理文档及工作流中旧调用；全仓搜索确认正式入口不再启动 CLI Agent。
- [x] 3.3 为进度、恢复、锁、迁移、入口和 Epic 合同补充适用检查；运行工作流测试并记录结果。

## 4. 综合验证与交付

- [x] 4.1 严格验证 OpenSpec，检查脚本语法和适用测试，并核对源码/规格未被验证过程改写。
- [x] 4.2 由独立只读 CR 审查规格与实现，修复 blocker/major 后复审；在进度记录中保留结论。
- [x] 4.3 提交归档与实现并创建关联 Issue #132 的 PR，核对 required CI；在进度记录中保留 checkpoint。
