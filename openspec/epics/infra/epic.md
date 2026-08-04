# Epic: infra — 项目基建初始化

> 本文件是人类可读的 Epic 状态；机器真相源为同目录 `epic.json`（受版本控制，可跨机器恢复）。

## 总 PRD

- **来源**：GitHub Issue [#48](https://github.com/zsxink/MusicTag/issues/48)（项目基建初始化：README/CLAUDE.md、引入 codegraph、复核优化 spec、优化工作流、图标三端适配、三端发布 CI）
- **定位**：工具线 · 自用 · 纯本地；V1 全产品已落地（含搜索联动缺陷修复 #46/#47），本次为 V2 与新协作者铺路的基建变更
- **技术栈**：Tauri 2 + Rust（lofty / walkdir / reqwest / aes+cbc+rsa）+ Vue 3 + Vite + TS；OpenSpec 规格驱动；pipe 流水线
- **验收标准**：Issue #48 验收（README/CLAUDE.md/codegraph/spec 复核/工作流/图标/CI + 独立复核通过后关闭 #48）

## 拆分方案（用户批准于 2026-08-04，总 PRD 唯一确认点）

| # | name | 域 | dependsOn | slice 来源 |
|---|---|---|---|---|
| 1 | `infra-repo-docs` | docs | — | Issue #48 工作点 1 · README 初始化 |
| 2 | `infra-claude-md-root` | docs | — | Issue #48 工作点 2 · 根级 CLAUDE.md |
| 3 | `infra-codegraph` | infra | — | Issue #48 工作点 3 · codegraph 索引 |
| 4 | `spec-review` | docs | — | Issue #48 工作点 4 · spec 四源复核 |
| 5 | `workflow-optimize` | infra | 4 | Issue #48 工作点 5 · 工作流优化 |
| 6 | `infra-icons` | frontend | — | Issue #48 工作点 6 · 图标三端适配 + 回归修复 |
| 7 | `ci-release` | infra | 6 | Issue #48 工作点 7 · 三端发布 CI |
| 8 | `infra-review-gate` | infra (gate) | 1–7 | Issue #48 工作点 8 · GATE 独立复核门禁 |

**串行执行顺序**：1→2→3→4→5→6→7→8

**拆分要点**：
- 每子项 = 一个 openspec change = 一个分支 = 一个 PR，粒度 = 可独立 CR + 可独立验收 + 可独立合并的最小单元。
- README(S1) 与 CLAUDE.md(S2) 刻意分开：对象不同（用户/贡献者 vs Claude Code 工具链）、验收独立、审查面不同。
- spec 复核(S4) 先于 workflow 优化(S5)：先定稿规格再据以改流程，避免流程改完又被 spec 修订打回。
- 图标(S6) 先于 CI(S7)：发布通道在图标三端产物就位后再启用，避免发版打包失败（资源顺序依赖，非逻辑绑定）。
- S8 `infra-review-gate` 是**门禁**不是普通功能变更：7 项合并后对最终仓库状态做只读独立终审，通过才关闭 #48；不通过挂起上报、阻断关闭、不回滚已合并项。

## 确认记录

- **2026-08-04**：`/pipe:init` 展示 8 项子变更清单，用户确认「继续」（含补充：图标设计文档并入 S6）。总 PRD 批准，`prdConfirmed=true`，`status=ready`。
- `sourceRevision` = 批准时 main 的 commit：`3eecb2cf150d6e4e8564c3a5defb4e1008f44dd4`。
- **Issue 关联**：Epic 总 Issue = `#48`；各子变更 Issue = `#49`~`#56`（对应 `epic.json` items 的 `issue` 字段）。实施时分支提交用 `feat(<issue>): ...`、PR `Closes #<issue>`。

## Artifact 校验结果

全部 8 个子变更已生成完整 OpenSpec artifacts（proposal / specs / design / tasks）并通过 `openspec validate --all --strict`（19 passed, 0 failed，含 11 个既有 spec）：

- `infra-repo-docs`: specs/capability `infra-repo-docs`
- `infra-claude-md-root`: specs/capability `infra-claude-md-root`
- `infra-codegraph`: specs/capability `infra-codegraph`
- `spec-review`: specs/capability `spec-review`
- `workflow-optimize`: specs/capability `workflow-optimize`
- `infra-icons`: specs/capability `infra-icons`
- `ci-release`: specs/capability `ci-release`
- `infra-review-gate`: specs/capability `infra-review-gate`

## 已探明的实施事实（决策输入）

- **icons 回归**：`src-tauri/icons/` 磁盘目录被删（git 索引跟踪 52 文件，v1-skeleton `1104eb5` 提交），属未提交误删回归；源图 `icon/musictag.png`（512×512 RGBA）未跟踪。S6 重生成补回并纳入版本控制。
- **图标设计文档**：`docs/design/musictag-icon-design.md` 磁盘上已存在（用户提供），S6 直接纳入版本控制即可。
- **codegraph**：仓库无 `.codegraph/` 索引；S3 建索引并决策 `.gitignore` 忽略（本地 SQLite 索引产物，非源码）。
- **CI 现状**：`.github/workflows/ci.yml` 为 PR/push 校验门禁（OpenSpec validate + npm build/test + cargo check/test），S7 的发布 CI 与之互补不冲突。
- **spec 复核发现**：S4 设计调研确认 6 处真实不一致点（`embed_cover` 废弃残留 / `pick_cover_file`+`read_cover_path` 遗漏 / `has_lyrics`+`has_cover` 陈旧 / PRD 模块结构停留重构前 / `search_source` 遗漏 / design §10.4 措辞陈旧），以 `src-tauri/src/lib.rs` 实际注册清单为真值基准。

## 断点与续跑

- `cursor` 指向下一个待实施子变更索引（见 `epic.json`）。
- 每个子变更完成后，更新 `epic.json` 该 item 的 `status`/`implementationCommit` 并推进 `cursor`，提交后即可续跑。
- 中断可在任意子变更后恢复：`/pipe:epic infra` 从 `cursor` 继续。
- S8 gate 完成并关闭 #48 后，本 Epic 收尾。
