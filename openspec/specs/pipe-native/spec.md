# pipe-native Specification

## Purpose
规范跨宿主 pipe 的阶段门禁、测试证据和集成恢复接口，确保验证覆盖仓库 CI，并让主会话能够依据可复核的状态与 typed evidence 安全推进归档和集成。
## Requirements
### Requirement: Verify 覆盖仓库 CI 的全量门禁
pipe Verify SHALL 将本地验证命令与仓库 CI 的必需门禁对齐。对于含 OpenSpec 的变更，SHALL 运行 `npx --yes @fission-ai/openspec@1.5.0 validate --all --strict --no-interactive`；变更影响 workflow、测试依赖或验证脚本时，SHALL 检查相关 CI job 是否安装并使用相同依赖与命令。pipe 自身的原生测试套件（`node --test` 运行的 pipe-core、pipe-native 与 workflow-core 用例）与原生入口自检 SHALL 既出现在仓库 CI 中，也出现在 infra/docs/spec 域的 Verify 验证计划中，两者不得互相遗漏。

#### Scenario: 规范全量校验
- **WHEN** Verify 检查任一包含 OpenSpec 的 pipe 变更
- **THEN** 全量 OpenSpec strict 校验通过，不能只以当前 change 的 strict 校验代替

#### Scenario: CI 依赖一致
- **WHEN** 测试或 fixture 依赖外部程序、系统包或环境变量
- **THEN** Architect 在 design/tasks 中列明依赖与使用 job，Tester/Verify 确认 CI job 提供该依赖并执行对应测试

#### Scenario: 原生套件双侧覆盖
- **WHEN** 任一 pipe 变更进入 Verify
- **THEN** CI workflow 与本地验证计划都运行全部原生测试套件与自检，任一侧新增套件时另一侧同步包含，不存在只在本地或只在 CI 执行的套件

### Requirement: 测试计划检查场景与 fixture 有效性
Architect 和 Tester SHALL 将规格场景转换为可验证的测试矩阵，并检查生成或静态 fixture 的有效性。格式读写场景至少区分已有标签、无标签首次写入、清空字段/封面、损坏输入和既有格式回归；fixture 生成失败或结构不完整时，测试 SHALL 给出明确的 fixture 错误。

#### Scenario: fixture 依赖和结构已核验
- **WHEN** 测试使用外部工具生成真实媒体 fixture
- **THEN** 设计记录工具与 CI 依赖，测试在业务断言前确认工具调用成功、输出文件存在且能被目标 reader 解析

### Requirement: 集成期 CI 修复保留有界只读复审
CR 的三轮上限 SHALL 约束同一实现差异的 blocker/major 修复循环。CR 已通过后，若 integrate 发现新的、范围明确的 CI/infra 问题，主 Agent SHALL 在原 CR 轮次外记录一次 `post-CR CI remediation`，重做受影响的 Dev/Tester/Verify 检查，并对新增差异派发独立只读复审。若修复改变产品行为或扩大已批准规格，SHALL 返回 Architect/spec-gate，并按新差异重新经过 CR。

#### Scenario: 新 CI 缺口的定向修复
- **WHEN** 已通过 CR 的 PR CI 暴露此前未见的 workflow、runner 或 fixture 依赖缺口
- **THEN** 主 Agent 记录失败证据和范围，执行有界修复、定向只读复审及受影响验证，且不改写原 CR 轮次记录

#### Scenario: 集成修复扩大行为范围
- **WHEN** 修复方案修改产品行为或超出已批准的 OpenSpec
- **THEN** 停止集成并返回 Architect/spec-gate，更新规格后重走受影响阶段

### Requirement: progress CLI 支持可读的恢复接口
progress CLI SHALL 支持从 JSON 文件载入 typed checkpoint evidence，并提供不展开 fingerprint manifest 的紧凑状态视图。现有 inline JSON 输入在迁移期间 SHALL 保持兼容。

#### Scenario: 从文件记录 checkpoint
- **WHEN** 主 Agent 使用 `checkpoint` 命令并传入 `--evidence-file <path>`
- **THEN** CLI 解析该 JSON 对象并执行与 typed evidence 相同的 schema、fingerprint 和阶段顺序校验

#### Scenario: 紧凑状态恢复
- **WHEN** 主 Agent 使用 `status <change> --compact`
- **THEN** 输出 change、Issue、branch/worktree、各阶段状态与 attempt、每个集成 checkpoint 的最新状态/attempt 和 nextStep，不输出完整命令日志或 fingerprint manifest

### Requirement: 工具版本固定与 artifact 规则有效性
pipe 工作流 SHALL 把 openspec CLI 的版本固定为与仓库 CI 同源的单一版本（当前 `@fission-ai/openspec@1.5.0`），并 SHALL 在唯一的共享常量处声明该版本，使所有调用点（确定性命令 wrapper、pipe-core 与 pipe-native 工具、preflight 脚本、散文指令面与只读角色权限白名单）SHALL 经由该常量或等价的显式固定形式调用，不得依赖 PATH 上解析到的任意版本；散文指令面写死与常量同源的完整版本，权限白名单可用 `@fission-ai/openspec@*` 版本通配。静态自检 SHALL 断言所有 openspec 调用点确实固定了版本，并在版本固定缺失或不一致时 fail-closed。

`openspec/config.yaml` 的 `rules` SHALL 能被 YAML 解析为字符串数组：任何含冒号加空格等 YAML 特殊结构的规则条目 SHALL 加引号，使 artifact 级规则真正生效。自检或等价门禁 SHALL 能发现规则被静默丢弃（CLI 输出 rules 解析告警）的情形。

#### Scenario: 版本固定点被自检覆盖
- **WHEN** 静态自检扫描仓库内全部 openspec 调用点
- **THEN** 每个调用点都固定到共享版本常量，任一调用点回退为裸 `openspec` 或不带版本的 `npx openspec` 时自检 fail-closed 并指明文件与行

#### Scenario: 版本漂移不复发
- **WHEN** 本机 PATH 上的 openspec 版本与仓库固定版本不同
- **THEN** 归档与校验仍使用仓库固定版本执行，不因 PATH 版本变化而产生不同的归档或校验结果

#### Scenario: rules 结构有效
- **WHEN** 仓库配置中的规则条目本身含冒号等 YAML 特殊结构
- **THEN** 该条目被解析为字符串而非嵌套映射，整组 artifact 规则生效且 CLI 不输出 rules 解析告警

### Requirement: 源码指纹只由工作区内容决定
`source-fingerprint.js` SHALL 只依据工作区当前内容计算指纹：已跟踪但当前不存在的路径 SHALL NOT 产生依赖 Git 提交状态的条目，使同一工作区内容在「删除已提交」与「删除未提交」两个时点得到同一指纹。指纹算法版本 SHALL 在算法变更时递增，`progress.js` 的 kind 白名单、WORKFLOW.md 与本规格的表述 SHALL 与生产者保持一致。

#### Scenario: 删除 tracked 文件的指纹稳定
- **WHEN** 某个已跟踪文件被删除，先计算指纹、随后提交该删除、再次计算指纹
- **THEN** 两次指纹相同，manifest 条目集合一致，不因删除是否已提交而漂移

#### Scenario: Verify 与 integrate 指纹一致
- **WHEN** Verify 记录的指纹所对应的源码状态中包含尚未提交的删除
- **THEN** integrate 复算得到同一指纹，不因提交动作使 Verify 结果失效

#### Scenario: 未提交删除仍可区分内容变化
- **WHEN** 工作区中某个已跟踪文件不存在
- **THEN** 该路径的缺失仍体现在 manifest 中（区别于内容变化），指纹与该缺失状态一一对应
