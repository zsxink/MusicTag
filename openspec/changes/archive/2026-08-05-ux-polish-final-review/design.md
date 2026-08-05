## Context

Epic `v1-ux-polish-layering` 5 项子变更逐个经 `/pipe` 合回 main。需在最后加总复核门禁（GATE），对最终仓库状态做只读独立复核，通过才关闭 Epic Issue。沿 `infra-review-gate`（#56）先例：GATE 是门禁性质子变更，dependsOn 全部子项，复核不通过挂起上报、不回滚。

## Goals / Non-Goals

**Goals:**
- 5 项子变更全部合并后，对最终仓库状态做一次只读独立复核。
- 复核维度：规格一致性、功能验收、工程门禁、无回归。
- 通过 → 关闭 Epic Issue #86；不通过 → 挂起上报阻断关闭。

**Non-Goals:**
- 不做功能代码改动（GATE 零实现）。
- 不回滚已合并项（复核发现问题 → 上报用户决策，另起修复变更）。
- 不逐项中途复核（只在全部合并后一次）。

## Decisions

### 1. 复核维度（四维，对应 spec Requirements）

1. **规格一致性**：`docs/V1-PRD.md`、`docs/design/design.md`、`openspec` 与实现对齐。
2. **功能验收**：逐项核验 5 子变更 spec 验收标准。
3. **工程门禁**：`cargo test`/`clippy`、`npm test`/`build` 全绿；`src/` 零 `#[cfg(test)]`；无 `test_util` 残留。
4. **无回归**：既有语义（选中即搜/手动点选/保存全量覆盖/dirty 拦截）不受影响。

### 2. 执行方式（只读）

复核用只读工具（Read/`git diff`/`grep`/`cargo test`/`npm run test`/`npm run build`），不 Edit/Write 生产代码。复核报告记录每维 pass/fail + 证据（命令输出、文件摘录）。

### 3. 判定与收尾

- 全部 pass → 关闭 Epic Issue #86（`gh issue close 86`）+ 提交复核报告 + 归档本变更。
- 任一 fail → 挂起（epic.status = suspended、error 记录失败维度），上报用户决策；Epic Issue #86 保持打开。

## Risks

- 复核发现子变更缺陷 → 需回退/修复时，**不回滚已合并项**，另起修复变更（沿先例）。挂起上报是正确路径。
- 复核依赖 5 项全部合回 main 后的真实状态——必须确保 `pipe-epic` 的 cursor 已到 #6 才执行。
