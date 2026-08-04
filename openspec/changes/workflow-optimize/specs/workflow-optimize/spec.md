## ADDED Requirements

### Requirement: CR 具备复盘专项审查维度
CR 角色 SHALL 在既有规格一致性/遗漏/缺陷三维之外，额外审查与复盘缺陷同族的风险：跨模块状态语义（如聚合去重破坏单源换源）、竞态与串扰（如共享计数器跨 kind 互相作废）、网络与离线判定（如超时与正常空结果混淆导致误判离线）。

#### Scenario: 审查换源类状态语义
- **WHEN** 变更涉及多源聚合/单源取词/候选去重相关实现，CR 审查 diff
- **THEN** CR 明确检查「去重/聚合是否会破坏单源换源、身份校验是否防同名不同歌」，并将发现按严重度列入问题清单

#### Scenario: 审查串扰类竞态
- **WHEN** 变更涉及并发搜索、共享计数器或请求序号
- **THEN** CR 明确检查「不同 kind/面板的状态是否互相污染、在途结果是否会被无关操作作废」，阻塞性串扰计入阻断/主要问题

#### Scenario: 审查离线与错误码判定
- **WHEN** 变更涉及网络失败判定、源错误码或离线降级
- **THEN** CR 明确检查「超时/业务错误码/正常空结果是否被正确区分」，判定错误者计入阻断/主要问题

### Requirement: CR 问题分级与证据要求
CR 报告 SHALL 区分阻断 / major / minor 三级，每项阻断或 major 问题 SHALL 给出：文件、问题描述、对应 spec/design 依据（`specReference`）与修复建议；无阻断且无 major 才判通过（`pass=true`）。

#### Scenario: 问题分级清晰
- **WHEN** CR 提交审查结果
- **THEN** 阻断/major/minor 三级各有清单，每项含文件、问题、specReference 与 suggestion

#### Scenario: 无阻断无 major 才通过
- **WHEN** 存在任意阻断或 major 问题
- **THEN** `pass=false` 且修复后重审；仅当两者皆空时 `pass=true`

### Requirement: 验证基线统一且含前端测试
最终验证 SHALL 统一执行：`cargo check`、`cargo test`、`npm run test`（vitest）、`npm run build`、`openspec validate <change>`；任一失败即 `verify_failed`，且验证只报告不修复。

#### Scenario: 验证覆盖基线
- **WHEN** 流水线进入最终验证阶段
- **THEN** 依次执行 cargo check / cargo test / npm test / npm build / openspec validate，逐项返回 pass/fail，任一 fail 则整体 `verify_failed`

#### Scenario: 验证只报告不修复
- **WHEN** 某项验证失败
- **THEN** verify 报告具体失败输出，由 Leader 打回开发角色修复后重跑，verify 自身不改代码

### Requirement: 前置校验含流程脚本自检
`pipe-preflight.sh` SHALL 在进入流水线前同时校验变更 artifacts 与流程脚本自身有效性（Node 语法、Shell 语法、OpenSpec 严格校验、Issue 关联），任一失败即 fail-closed 阻止写入。

#### Scenario: 流程脚本静态自检
- **WHEN** 变更影响 workflow 脚本/agent 定义
- **THEN** preflight 执行对应静态自检（Node `--check` / shell `-n`），失败即 `ready=false` 并列入 issues

#### Scenario: 校验失败 fail-closed
- **WHEN** preflight 任一检查失败
- **THEN** 流水线立即返回 `failed`（stage=preflight），不进入任何写入阶段

### Requirement: 复盘缺陷回归验证
涉及搜索联动的变更 SHALL 在最终验证中执行复盘缺陷回归清单：单源换源不被聚合去重破坏、不同 kind 状态不串扰、离线判定区分网络失败与正常空结果；相关回归项在 `verify.steps` 中逐项可见。

#### Scenario: 搜索联动回归清单可执行
- **WHEN** 变更触及搜索取词/换源/并发/离线降级路径
- **THEN** 最终验证按回归清单逐项执行并逐项返回 pass/fail，结果计入 `verify.steps`

#### Scenario: 回归项可见可审计
- **WHEN** 流水线返回最终验证结果
- **THEN** 每项回归检查在 `verify.steps` 中有对应 step 与 status，缺失即 `verify_failed`

### Requirement: 门禁可审计可回溯
流水线 SHALL 在返回结果中携带关键中间产物：测试覆盖报告（covered/missing）、CR 各轮问题（rounds + 各级问题数）、验证步骤明细（steps）；Leader 据此上报并留档，不粉饰、不假报全绿。

#### Scenario: 结果携带中间产物
- **WHEN** 流水线返回 success 或失败/挂起
- **THEN** 结果含 tester、cr（轮次+问题数）、verify（步骤明细）等字段，可回溯各阶段产出

#### Scenario: 失败如实上报
- **WHEN** 测试/验证/CR 任一环节未过
- **THEN** 流水线如实返回 `test_failed`/`verify_failed`/`suspended` 及原因，不降级为 success
