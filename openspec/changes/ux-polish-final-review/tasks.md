# 任务（变更域 infra/GATE，只读复核，无功能代码改动）

> 前置：5 项子变更（#87-#91）全部合并回 main，epic cursor 推进到本变更才执行。

## G1 只读复核（四维）

- [ ] 1.1 **规格一致性**：读 `docs/V1-PRD.md`、`docs/design/design.md`、`openspec/epics/v1-ux-polish-layering/` 与最终实现对比——README 产品文案、§10.4「一律外置 tests/」、command 契约含 `get_last_dir`/`save_last_dir`、§10.0 service 含 `config.rs`、无旧描述残留
- [ ] 1.2 **功能验收**：逐一核验 5 子变更 spec 验收标准（README 文案 v2 / 文件名字段置顶 / 歌词框 min-height 360 / 候选折叠跨切歌保持 / 左栏高度 / 目录记忆读写+选择器定位+启动加载 / src/ 零 #[cfg(test)]）
- [ ] 1.3 **工程门禁**：跑 `cargo test && cargo clippy && npm run test && npm run build` 全绿；`grep -rn "#\[cfg(test)\]" src-tauri/src/` 无命中；`grep -rn "test_util\|mock_http_once" src-tauri/src/` 无命中
- [ ] 1.4 **无回归**：确认选中即搜/手动点选/保存全量覆盖/dirty 拦截语义未被改动破坏

## G2 判定与收尾

- [ ] 2.1 全部 pass → `gh issue close 86`（关闭 Epic Issue）+ 提交复核报告（各维 pass + 证据）+ 归档本变更（`/opsx:archive ux-polish-final-review`）+ PR `Closes #92`
- [ ] 2.2 任一 fail → 挂起上报（epic.json status=suspended、error 记失败维度），Epic Issue #86 保持打开，不回滚已合并项，等用户决策
