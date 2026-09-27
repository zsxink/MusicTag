# pipe-native Specification

## Purpose
规范跨宿主 pipe 的阶段门禁、测试证据和集成恢复接口，确保验证覆盖仓库 CI，并让主会话能够依据可复核的状态与 typed evidence 安全推进归档和集成。
## Requirements
### Requirement: Verify 覆盖仓库 CI 的全量门禁
pipe Verify SHALL 将本地验证命令与仓库 CI 的必需门禁对齐。对于含 OpenSpec 的变更，SHALL 运行 `npx --yes @fission-ai/openspec@1.5.0 validate --all --strict --no-interactive`；变更影响 workflow、测试依赖或验证脚本时，SHALL 检查相关 CI job 是否安装并使用相同依赖与命令。

#### Scenario: 规范全量校验
- **WHEN** Verify 检查任一包含 OpenSpec 的 pipe 变更
- **THEN** 全量 OpenSpec strict 校验通过，不能只以当前 change 的 strict 校验代替

#### Scenario: CI 依赖一致
- **WHEN** 测试或 fixture 依赖外部程序、系统包或环境变量
- **THEN** Architect 在 design/tasks 中列明依赖与使用 job，Tester/Verify 确认 CI job 提供该依赖并执行对应测试

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
