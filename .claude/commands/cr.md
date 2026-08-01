---
description: 自动代码审查（CR）——只读 subagent 对照规格审查变更，产出问题清单；作为独立审查环节或 /pipe 流水线的一部分
---

# 自动代码审查（CR，只读）

对当前分支/变更做一次 subagent 驱动的代码审查。核心原则：**CR 只读，不改代码**——发现的问题打回 Leader 重新派给开发角色修复。

## 输入

- 可选：变更名 `<name>`。省略时从上下文推断或自动选择（唯一 active change 则自动选中）。

## 审查基准

- 规格权威：`openspec/changes/<name>/`（proposal / specs / design / tasks）
- 定稿规格：`docs/V1-PRD.md`、`docs/design/design.md`
- 审查对象：`git diff main...HEAD`（当前分支相对 main 的全部改动）

## 审查流程

1. **定位变更**：读 `openspec/changes/<name>/` 下的 specs 与 design，梳理验收点（每个 scenario 是一个潜在测试用例）。
2. **生成 diff**：`git diff main...HEAD --stat` 看范围，再读关键文件 diff。
3. **派只读审查代理**（并行）：
   - `cr-agent` 代理：对照 specs 审查 **规格一致性**（实现是否符合）、**遗漏**（spec 有代码没有）、**缺陷**（逻辑/边界/测试缺失、与定稿约束冲突）。
   - 审查代理**只读**：只用 Bash(读)/Read/Glob/Grep，**不 Edit/Write 任何代码**。
4. **汇总问题清单**：按严重度排序（阻断/主要/次要），每条标注：文件、位置、问题、违反的 spec/requirement、建议。

## 输出

```
## CR 结果：<change-name>

### 阻断（必须修复）
- [ ] <文件:行> <问题> — 违反 <spec requirement>

### 主要
- [ ] ...

### 次要
- [ ] ...

结论：通过 / 需修复（第 N 轮）
```

## 后续（打回机制）

- **CR 有阻断/主要问题** → **不打回给 CR 自己修**，CR 只读；由 **Leader 打回给对应开发角色**（Rust-Dev / Vue-Dev）修复 → 重跑受影响测试 → 再复审。
- **三轮未通过 → 挂起**：不再自动重试，上报用户决策（改规格 / 人工修复 / 放行）。
- **通过**：可进入验证/合并。

## Guardrails

- **CR 只读**：审查代理不 Edit/Write 任何代码，问题经 Leader 中转打回。
- 审查必须对照规格，不能只查代码自身 bug。
- 阻断/主要问题不修复不进入下一步；**三轮未通过即挂起**，不无限重试。
- 报告如实：无问题就明确说「无阻断、无主要问题」。
