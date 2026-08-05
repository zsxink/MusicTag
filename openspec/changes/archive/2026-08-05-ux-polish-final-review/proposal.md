## Why

Epic `v1-ux-polish-layering` 有 5 个子变更（README 文案 / UI 布局 / 候选折叠 / 测试分离 / 目录记忆），各自经独立 `/pipe` 流水线（前置校验→开发→测试→CR→最终验证→PR→合并）。子变更逐个合回 main 后，需要一个**总复核门禁**对最终仓库状态做一次只读独立复核——校验五项改动整体一致、规格与实现对齐、无回归，作为 Epic 收尾把关（沿 `infra-review-gate` 先例 #56）。

## What Changes

- **GATE（门禁性质，非功能子变更）**：不产生功能代码改动，仅对「5 项子变更全部合并回 main 后」的最终仓库状态做一次只读独立复核。
- 复核维度：
  1. **规格一致性**：`docs/V1-PRD.md`、`docs/design/design.md`、`openspec` 与实现对齐（README 文案、字段顺序、歌词高度、折叠交互、目录记忆、测试分离规范）。
  2. **功能验收**：五项子变更各自 spec 的验收标准（逐一核验）。
  3. **工程门禁**：`cargo test`/`cargo clippy`、`npm run test`/`npm run build` 全绿；`src/` 生产代码零 `#[cfg(test)]`；`test_util` 无残留。
  4. **无回归**：字段顺序、歌词高度、搜索/保存语义、dirty 拦截不受影响。
- 复核通过 → 关闭 Epic Issue #86；不通过 → 挂起上报、阻断 #86 关闭、**不回滚已合并项**。

## Capabilities

### New Capabilities
- `ux-polish-final-review`: 总复核门禁——对 Epic 最终仓库状态做只读独立复核（规格一致性/功能验收/工程门禁/无回归），通过才关闭 Epic Issue。

### Modified Capabilities
（无——GATE 不改变产品/工程能力，只把关）

## 关联 Issue

GitHub Issue：`#92`（分支提交 `feat(92): ...`、PR `Closes #92`；通过后关闭 Epic #86）

## Impact

- 无功能代码改动。复核过程只读（Review 工具/命令），不修改生产代码、不回滚已合并项。
- 产出：复核报告（各维度 pass/fail + 证据）。
- 复核不通过 → 挂起上报，由用户决策后续（修哪个子变更重跑）。
