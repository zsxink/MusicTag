## ADDED Requirements

### Requirement: 工具版本固定与 artifact 规则有效性
pipe 工作流 SHALL 把 openspec CLI 的版本固定为与仓库 CI 同源的单一版本（当前 `@fission-ai/openspec@1.5.0`），并 SHALL 在唯一的共享常量处声明该版本，使所有调用点（确定性命令 wrapper、pipe-core 与 pipe-native 工具、preflight 脚本）SHALL 经由该常量或等价的显式固定形式调用，不得依赖 PATH 上解析到的任意版本。静态自检 SHALL 断言所有 openspec 调用点确实固定了版本，并在版本固定缺失或不一致时 fail-closed。

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

## MODIFIED Requirements

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