## MODIFIED Requirements

### Requirement: 中立工作流与确定性命令（P6）
共享 pipe skill SHALL 定义跨宿主一致的阶段、证据和 checkpoint；每阶段成功证据 SHALL 符合阶段所需类型，阶段不得越过未成功的前置阶段。Verify 成功 SHALL 记录本次验证 HEAD、源码与规格快照指纹、预期命令清单和逐命令退出码；Integrate 开始及每个 checkpoint 前 SHALL 确认源码指纹仍与 Verify 一致，并在类型化 checkpoint 证据中保留该指纹；仅 OpenSpec 归档导致规格指纹变化时可沿用 Verify。恢复时重新核对。主 Agent SHALL 直接调用中立 shell 命令或纯校验工具完成 bootstrap、spec-gate、Verify 和 Integrate；正式运行路径不得使用通过 Node `child_process` 包装 git/gh/openspec 的旧命令脚本。归档先于 PR，每个外部副作用前先检查本地或远端事实，完成后立即记录 checkpoint；每个集成 checkpoint 的类型化证据 SHALL 在恢复时与当前本地或远端事实匹配。

确定性命令 wrapper 调用 openspec 时 SHALL 使用与 CI 同源的固定版本，不得依赖 PATH 上解析到的版本。依赖远端事实的命令（如等待 required checks）在遇到瞬时网络错误（EOF、连接重置、超时、5xx 等可重试故障）时 SHALL 做有上限的退避重试，并在输出中以可区分的字段（如 `errorKind`）标明「未能取到远端事实」与「远端事实表明 CI 未通过」，两者 SHALL NOT 共用同一退出语义与同一 JSON 形状。轮询等待 SHALL NOT 以忙等实现。

#### Scenario: 集成幂等
- **WHEN** 恢复时已有该分支 PR 或远端已合并
- **THEN** 主 Agent 复用 GitHub 事实，继续下一 checkpoint，不重复创建 PR、等待新一轮 CI 或再次合并

#### Scenario: 归档与 PR 顺序
- **WHEN** 主 Agent 准备创建 PR
- **THEN** 先核对活动 change 已归档且归档规格与实现同在分支 diff 中，缺一则停止

#### Scenario: preflight 路径中立
- **WHEN** 任一宿主执行 bootstrap 或 spec-gate
- **THEN** 三个宿主入口均直接调用 .agents/workflows/ 的确定性脚本。

#### Scenario: 归档命令可执行
- **WHEN** 主 Agent 开始 integrate 的 archive checkpoint
- **THEN** 主 Agent 执行确定性归档命令并核对活动 change 和 canonical spec。

#### Scenario: 集成命令确定性
- **WHEN** 主 Agent 推进 PR、CI 与合并 checkpoint
- **THEN** 主 Agent 按 checkpoint 顺序直接执行 git/gh 命令并核对远端结果。

#### Scenario: 集成证据失效
- **WHEN** progress 记录 CI、PR 或合并 checkpoint 成功，但恢复时 GitHub/本地事实缺少必要字段或与记录不匹配
- **THEN** 主 Agent 将该 checkpoint 与 integrate 标记为无效，从首个未证实 checkpoint 重新核查，不复用旧的成功标记。

#### Scenario: Verify 后源码改变
- **WHEN** Verify succeeded 后到任一集成副作用前，源码快照与 Verify 指纹不一致
- **THEN** 主 Agent 拒绝进入 Integrate 或推进该 checkpoint，并让 Verify/Integrate 失效；OpenSpec 归档/规格文件变化只有在源码指纹仍一致时可继续。

#### Scenario: 跨宿主复算源码指纹
- **WHEN** 不同宿主、cwd 或 linked worktree 恢复 Verify/Integrate
- **THEN** 使用 `source-fingerprint.js` 的版本化 UTF-8 路径清单算法复算，并在 Verify 与 checkpoint evidence 记录版本、指纹、manifest 摘要和清单；同一源码状态得到同一指纹，OpenSpec 归档移动不改变源码指纹。

#### Scenario: 三端入口同核
- **WHEN** 用户分别从三种宿主启动 pipe
- **THEN** 三个宿主入口加载同一个共享工作流和 Markdown 状态协议。

#### Scenario: 瞬时网络错误自愈
- **WHEN** 等待 required checks 时远端查询因 EOF、连接重置、超时或 5xx 失败，随后恢复
- **THEN** 命令在有上限的退避重试内自愈并返回真实的 checks 事实，不把瞬时故障报告为 CI 失败

#### Scenario: 取不到远端事实与 CI 失败可区分
- **WHEN** 重试耗尽后仍无法取得远端 checks 事实，或远端事实表明 required checks 失败
- **THEN** 输出以可区分字段标明两类情形，调用方能据此判断该重试、该查证远端还是该修复 CI

#### Scenario: 归档不受 PATH 版本影响
- **WHEN** 本机 PATH 上的 openspec 版本与仓库固定版本不同
- **THEN** 归档 wrapper 仍以仓库固定版本执行，产出与版本无关的一致结果

### Requirement: 统一验证基线（继承 workflow-optimize 既有门禁）
最终完整验证 SHALL 在 Tester 与 CR 产物确定后的适用 HEAD 上运行。代码域执行 cargo check、cargo test、npm test、npm build 和 OpenSpec strict validate；docs/spec/infra 域执行对应文档或脚本检查与 OpenSpec validate。验证子 Agent 可执行命令，但主 Agent SHALL 核对退出码、HEAD、源码/规格快照并写入 Markdown 证据；任一步失败不得进入集成。搜索联动类变更额外保留专项回归清单。infra/docs/spec 域 SHALL 运行 pipe 自身的全部原生测试套件（pipe-core、pipe-native 与 workflow-core 三组 `node --test` 用例）与原生入口自检，且该覆盖集合与仓库 CI 中运行的集合一致。

#### Scenario: 验证只读源码
- **WHEN** 最终验证命令写出构建产物或缓存
- **THEN** 允许白名单构建路径变化，但 HEAD、源码和规格变化使验证失败

#### Scenario: 失败阻断
- **WHEN** 任一适用验证命令失败或缺少必要专项回归项
- **THEN** 主 Agent 标记 Verify 失败，记录命令与退出码，不能创建 PR

#### Scenario: 代码域全基线
- **WHEN** 代码域进入最终 Verify 阶段
- **THEN** 主 Agent 依序执行适用的 cargo、npm 与 OpenSpec 命令，记录每项结果。

#### Scenario: 文档域跳编译
- **WHEN** docs、spec 或 infra 域进入最终 Verify 阶段
- **THEN** 主 Agent 跳过无关业务编译，执行文档或脚本检查及 OpenSpec strict validate。

#### Scenario: 搜索联动类变更回归清单
- **WHEN** 改动涉及取词、换源、并发或离线判定
- **THEN** 主 Agent 追加单源换源、跨 kind 串扰和离线判定的专项检查并记录结果。

#### Scenario: 原生套件纳入 infra 基线
- **WHEN** infra、docs 或 spec 域进入最终 Verify 阶段
- **THEN** 主 Agent 运行全部原生测试套件与自检，使用的 glob 形式在 Node 24 下可执行，且套件集合与 CI workflow 中运行的集合一致