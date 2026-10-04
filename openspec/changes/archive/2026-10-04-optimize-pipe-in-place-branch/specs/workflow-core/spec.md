## MODIFIED Requirements

### Requirement: 节点状态机与断点续跑（P1）
主 Agent SHALL 维护 `pending → running → succeeded | failed | suspended` 的阶段状态。`openspec/changes/<change>/tasks.md` SHALL 记录经核对的任务完成情况；主仓 `.agents/runs/<change>/progress.md` SHALL 记录版本、change、Issue、branch、worktree（实际代码工作区，原地模式为主仓根）、阶段、任务所有权、attempt/CR 轮次、验证 HEAD、子 Agent 标识、决策、集成 checkpoint 和下一步，且由主 Agent 独占写入。进度 SHALL 始终保存在共享主仓 `.agents/runs/<change>/`，即使该 change 使用了 linked worktree，也不得写入会随 cleanup 删除的工作树。恢复 SHALL 以 Markdown 与仓库和远端事实共同判定，只复用证据有效的已完成阶段。

#### Scenario: 上下文压缩或新会话恢复
- **WHEN** 主会话上下文中断后重新触发同一 change
- **THEN** 主 Agent 读取 tasks.md/progress.md，核对 branch、worktree、Git HEAD/diff/提交、产物和远端 PR 状态，从首个未完成且依赖满足的阶段继续

#### Scenario: 标记与事实不一致
- **WHEN** Markdown 标记某阶段成功但提交不存在、输入已变或验证 HEAD 不再适用
- **THEN** 主 Agent 标记该阶段及受影响下游待重做，不能依靠勾选框宣布成功

#### Scenario: 中断的原生子 Agent
- **WHEN** progress.md 记录子 Agent 正在写入而恢复时无法确认其仍活跃
- **THEN** 主 Agent 将任务标为中断待核查，检查遗留差异及所有权后再续派，不能与可能仍在工作的 Agent 并行写同一范围

#### Scenario: 失败节点缓存失效
- **WHEN** 一个已执行阶段失败或其输入发生变化
- **THEN** 失败阶段及受其影响的下游阶段标为待重做，未受影响且证据仍有效的阶段可复用。

#### Scenario: 落地校验
- **WHEN** 恢复时 Markdown 声称阶段已经成功
- **THEN** 主 Agent 核对提交、HEAD、文件和远端证据，缺失时撤销成功判断。

#### Scenario: 中断后续跑
- **WHEN** 主会话在某阶段中途退出后再次启动同一 change
- **THEN** 主 Agent 从首个未完成且依赖满足的阶段恢复，不重复有证据的已完成工作。

#### Scenario: 挂起后接管已释放的锁
- **WHEN** 主 Agent 将阶段设为 suspended 并释放运行锁，后续会话确认旧主会话和所有写入子 Agent 均已结束
- **THEN** 新主 Agent 使用旧 owner、显式无活动写入者确认和核查依据，在原子接管事务中认领新锁并记录决定；未挂起的无锁记录不能以此方式接管。

#### Scenario: 接管事务中断后恢复
- **WHEN** 接管 journal 属于已确认退出的主会话 A，后续会话 B 核实 A 和写入子 Agent 均不再活动
- **THEN** B 使用 takeover-recover 命令核对 journal 与 lock/progress 的部分提交状态后恢复或完成接管，并记录 journal ID 和核查依据；未知/不匹配状态 fail-closed，不要求手工删除 journal。

#### Scenario: 初始化锁写入中断后恢复
- **WHEN** 初始化会话在原子创建完整 lock 后、首次 progress.md 写入前中断
- **THEN** 新会话必须提供匹配的 previous-owner、无活动写入者确认和非空核查依据，通过排他恢复 claim 隔离旧 lock 后重新初始化；无核查依据或 progress 已存在时拒绝恢复。

#### Scenario: 无核查依据拒绝接管
- **WHEN** 调用 takeover 或 takeover-recover 时缺少非空 evidence
- **THEN** 命令 fail-closed，不更改 lock、progress 或 takeover journal。

#### Scenario: 工作区清理后继续记录
- **WHEN** 集成流程完成本地清理——删除实现用的 linked worktree，或将主工作树切回 main 并删除已合并的 change 分支
- **THEN** 主 Agent 仍能在共享主仓读取运行进度，并写入 `cleanup-local` checkpoint 和最终阶段状态；`worktreeRemoved` 表示「不再存在该 change 的 linked worktree」，两种模式收尾后均为真

#### Scenario: merge 后完成态恢复
- **WHEN** PR 已合并、verify-remote 和 cleanup-local 事实均已核实，但会话在 integrate 最终标记前中断，或后续再次恢复
- **THEN** 主 Agent 以 main 分支、merge 后 HEAD 和不再存在该 change 的 linked worktree 作为生命周期事实，确认验证 HEAD 仍可从 main 到达后保留原验证/集成证据，只补完 integrate 或报告完成，不要求伪造已删除 worktree 的旧事实。

### Requirement: 自适应编排（P4）
Architect SHALL 判定 `backend/frontend/both/docs/spec/infra` 域，由主 Agent 按域选择原生子 Agent 和验证计划。`both` 的同一工作区写入 SHALL 按 Rust→Vue 顺序；docs/spec/infra 跳过无关业务编译，但保留适用的规格、脚本和审查门禁。

#### Scenario: 代码域
- **WHEN** Architect 判定 `both`
- **THEN** 主 Agent 先派 Rust 开发并核对提交，再派 Vue 开发，随后进入 Tester、CR 和完整验证

#### Scenario: 非代码域
- **WHEN** Architect 判定 docs/spec/infra
- **THEN** 主 Agent 派对应流程/文档角色，运行适用的文档或脚本检查、OpenSpec 校验和 CR，不运行无关 cargo/npm 编译

#### Scenario: 文档变更不触发编译
- **WHEN** Architect 将变更判定为 docs 或 spec
- **THEN** 主 Agent 派文档或规格任务并运行适用检查及轻量 CR。

#### Scenario: infra 变更静态自检
- **WHEN** Architect 将变更判定为 infra
- **THEN** 主 Agent 运行脚本语法、自检、OpenSpec strict validate 和 CR，跳过无关业务编译。

#### Scenario: 代码变更走既有基线
- **WHEN** Architect 将变更判定为 backend、frontend 或 both
- **THEN** 主 Agent 按域派发开发和测试角色，执行统一验证基线。

## ADDED Requirements

### Requirement: 变更工作区与分支选择
pipe SHALL 默认在当前工作目录开发：从 main 切出与 change 同名的分支，不新建 linked worktree。主 Agent SHALL 在 bootstrap 前判定当前分支状态：已在目标分支则直接继续；在 main 上则直接切出目标分支；在其它分支或 detached HEAD 上则向用户提供「切分支 / 改用 worktree / 中止」三选一。工作区不干净且需要切换分支时 SHALL 停止并交由用户处理，不得自动 stash 或提交。从非 main 分支切出前 SHALL 校验 main 是该分支 HEAD 的祖先，不成立时不得从该分支切出。Epic 主会话 SHALL 保持原地并停在 main，其就绪子变更是结构性使用独立分支与 worktree 的场景；单变更默认不新建 linked worktree，仅在用户选择「改用 worktree」时例外。集成收尾 SHALL 切回 main 并删除已合并的 change 分支。工作区模式（in-place 或 worktree）SHALL 由确定性脚本判定并记入 bootstrap 证据，不新增 progress 机器字段。

#### Scenario: 在 main 上启动
- **WHEN** 主 Agent 在干净的 main 分支上启动 `pipe <change>`
- **THEN** 主 Agent 从 main 切出同名 change 分支，不创建 linked worktree，bootstrap 在当前位置执行

#### Scenario: 在其它开发分支上启动
- **WHEN** 当前分支既不是 main 也不是目标 change 分支
- **THEN** 主 Agent 停止自动推进，向用户提供切分支、改用 worktree、中止三个选项，并按用户答复执行

#### Scenario: 工作区不干净
- **WHEN** 需要切换分支但工作区存在未提交改动
- **THEN** 主 Agent 停止并提示用户先提交或暂存，不自动 stash、不自动提交

#### Scenario: 从非 main 分支切出的前置校验
- **WHEN** 用户选择从当前非 main 分支切出 change 分支
- **THEN** 主 Agent 先确认 main 是当前 HEAD 的祖先；不成立时只提供改用 worktree 或中止

#### Scenario: 原地开发不绕过分支门禁
- **WHEN** 主 Agent 在原地模式下运行 bootstrap
- **THEN** 当前分支必须等于 change 名，在 main 上直接开发仍然 fail-closed

#### Scenario: Epic 子项隔离
- **WHEN** Epic 调度就绪子变更
- **THEN** 主会话保持原地并停在 main，每个子变更在各自的独立分支与 worktree 中执行，并行上限仍为 3

#### Scenario: 原地收尾
- **WHEN** 变更 PR 已合并且集成进入 cleanup-local
- **THEN** 主 Agent 切回 main 并删除已合并的 change 分支，progress 记录的 cleanup-local 证据仍满足既有契约
