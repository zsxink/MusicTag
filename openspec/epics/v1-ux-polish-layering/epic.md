# Epic: v1-ux-polish-layering

> 体验优化 + 分层重构增强。总 Epic Issue：#86。

## 总 PRD 摘要

四块改动（superpowers 设计流程批准）：
1. **README 产品文案** —— 产品视角、简约、去 AI 味（支持格式/编辑标签/编辑封面/编辑歌词/自动搜索）
2. **UI 体验调整** —— 文件名字段置顶、歌词框加高 ×2、候选区折叠（跨切歌保持）、左栏高度锁定窗口
3. **目录记忆** —— Rust config.json 存 last_dir + command + 启动自动加载 + 选择器定位
4. **Rust 生产/测试彻底分离** —— 13 文件 2234 行内嵌单测拆到 tests/ + 规范入 §10.4

## 子变更清单（依赖序）

| # | 名称 | Issue | 域 | dependsOn | 切片 |
|---|---|---|---|---|---|
| 1 | readme-product-copy | #87 | frontend | — | 设计 §一；Plan A T1 |
| 2 | ui-editor-layout | #88 | frontend | — | 设计 §二 2.1+2.2+2.4；Plan A T2+4 |
| 3 | candidate-collapse | #89 | frontend | ui-editor-layout | 设计 §二 2.3；Plan A T3 |
| 4 | rust-tests-separation | #90 | backend | — | 设计 §四；Plan B T0-7 |
| 5 | dir-memory | #91 | both | rust-tests-separation | 设计 §三；Plan A T5+6+7 |
| 6 | ux-polish-final-review | #92 | infra(GATE) | 全部 5 项 | 总复核门禁 |

## 依赖说明

- **唯一硬约束**：`dir-memory` 依赖 `rust-tests-separation`——两者收尾都改 `design.md §10.4` 同一行；测试分离先行让「零内嵌测试」全库为真、`config.rs` 落地时规格与代码一致，避免双改同行冲突。
- 前端组（1/2/3）无依赖，聚齐先行；`candidate-collapse` dependsOn `ui-editor-layout` 仅共享文件卫生（都改 LyricPanel.vue）。
- **#6 为 GATE（门禁性质，非功能子变更）**：dependsOn 全部 5 项，全部合并回 main 后对最终仓库状态做一次**只读独立复核**（规格一致性、功能验收、工程门禁、无回归），通过才关闭 Epic Issue #86；不通过 → 挂起上报、阻断 #86 关闭、不回滚已合并项（沿 infra-review-gate 先例 #56）。

## 确认记录

- 2026-08-05：用户批准总 PRD（子变更清单 + 顺序）。
- 5 个 GitHub Issue 已建（#87-#91，引用总 Epic #86）。

## Artifact 校验结果

- `openspec validate readme-product-copy --strict --no-interactive` → valid
- `openspec validate ui-editor-layout --strict --no-interactive` → valid
- `openspec validate candidate-collapse --strict --no-interactive` → valid
- `openspec validate rust-tests-separation --strict --no-interactive` → valid
- `openspec validate dir-memory --strict --no-interactive` → valid

## 来源与修订

- 设计文档：`docs/superpowers/specs/2026-08-05-ux-polish-and-layering-refactor-design.md`
- Plan A：`docs/superpowers/plans/2026-08-05-ux-polish.md`
- Plan B：`docs/superpowers/plans/2026-08-05-rust-tests-separation.md`
- `sourceRevision`：`21f74f1`（批准时 main 的 commit）
