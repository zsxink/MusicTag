---
description: 查看/同步项目定稿规格（docs/V1-PRD.md 与 docs/design/design.md）
---

项目的产品与技术规格定稿在 `docs/V1-PRD.md` 与 `docs/design/design.md`，记忆 `music-tag-v1-spec.md` 是摘要。

- `/spec` 无参数：总结当前规格要点（V1 范围、已拍板约束、技术栈）
- `/spec 读 <章节>`：精读并展开指定章节
- `/spec 改 <变更>`：将变更同步进 `docs/V1-PRD.md` 与 `docs/design/design.md`，保持两份文档一致，再动代码

改动规格后提醒用户：新行为若触发「已拍板决策」的更改，需重新确认。
