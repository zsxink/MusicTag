## Why

`rust-review-hardening`（Issue #194 / PR #195）的只读 CR 通过了全部 blocker/major，但留下 4 条 minor 观察项。逐条核实后，其中 3 条是真实且可修的文档/注释/测试强度问题，第 4 条归因有误（CR 指向 `docs/design/design.md`，实际文本在已归档的变更设计快照里，不应回改历史归档）。

这些遗留不影响运行时行为，但会误导后续读者与维护者：注释说「第一个 front cover」而实现是「优先 `CoverFront`、无则第一张」；command 契约守卫的注释写 19 而断言 22；封面回退测试未证明回退确实来自首图。本次只做这三处收敛，零产品行为变更。

GitHub Issue: #196

## What Changes

- 修正两处陈旧注释：`src-tauri/src/commands/cover.rs` 与 `src-tauri/src/service/cover.rs` 的取图描述由「第一个 front cover」改为「优先 `CoverFront`，无则第一张，APE 原生回退不变」，与 #194 落地实现一致。仅改注释，不改函数体。
- 修正 `src/styles/command-contract.test.ts` 两处注释的 command 数量（19 → 22），与同文件既有断言（`toHaveLength(22)`）及 `lib.rs` 实际注册集一致。仅改注释，不改断言与提取逻辑。
- 强化封面回退测试断言：`export_falls_back_to_first_picture_without_front_cover` 增加「回读标签内图片顺序与类型」的早检，证明标签确有两张非 front 图片且首图是构造的 `CoverBack`，使「回退到第一张」的断言不再可能空转绿；同时在多图 front-cover 用例中补默认导出扩展名的断言（按其 MIME 推断）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `cover-embed`：「封面预览与导出优先取 front cover」的测试证据强度提升——回退场景 SHALL 由 fixture 早检证明图片顺序与类型，导出扩展名 SHALL 在该场景内被断言。requirement 行为本身不变。

## Impact

- `src-tauri/src/commands/cover.rs`、`src-tauri/src/service/cover.rs`：仅注释行。
- `src/styles/command-contract.test.ts`：仅注释行。
- `src-tauri/tests/export_cover.rs`：新增断言。
- 不改变任何 V1 约束（一次一首、保存全量覆盖、直接写盘、撞名拒绝、离线降级）；不引入新依赖；不新增/重命名 Tauri command；不改前端 `src/` 逻辑；不改归档的历史设计文档。
