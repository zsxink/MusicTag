## 1. 文档设计
- [x] 1.1 完成 docs 领域设计与验证计划（`openspec/changes/issue-159/design.md`）

## 2. 实现与验证
- [x] 2.1 仅更新根目录 `README.md`，加入 Echo 简介及仓库、发行版两个链接
- [x] 2.2 对照 design.md 验证文案定位、禁止性表述和两个链接目标；检查 diff 仅包含 README
- [ ] 2.3 运行 `npx --yes @fission-ai/openspec@1.5.0 validate issue-159 --strict --no-interactive`
- [ ] 2.4 最终 Verify 按当前 CI workflow 执行适用门禁，并运行全量 OpenSpec strict validate
