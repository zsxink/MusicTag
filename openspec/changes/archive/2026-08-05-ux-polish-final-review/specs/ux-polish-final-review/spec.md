# ux-polish-final-review Specification

## Purpose

Epic `v1-ux-polish-layering` 的总复核门禁（GATE）：5 项子变更全部合并回 main 后，对最终仓库状态做只读独立复核，通过才关闭 Epic Issue #86。

## ADDED Requirements

### Requirement: 只读独立复核

总复核 SHALL 在 5 项子变更全部合并回 main 后执行，对**最终仓库状态**做只读复核，不产生功能代码改动。

#### Scenario: 时机正确

- **WHEN** 5 项子变更全部合并回 main
- **THEN** 执行总复核，且只在此时执行（不逐项中途复核）

#### Scenario: 只读无写

- **WHEN** 复核执行
- **THEN** 不修改生产代码、不回滚已合并项，仅读取仓库状态并产出报告

### Requirement: 规格一致性核验

复核 SHALL 校验规格与实现一致：`docs/V1-PRD.md`、`docs/design/design.md`、`openspec` 与代码对齐。

#### Scenario: 规格-实现对齐

- **WHEN** 复核 README/UI/目录记忆/测试分离相关文档
- **THEN** 文档描述与最终实现一致，无残留旧描述（如 §10.4「单测内联」、README 非功能约束措辞、command 契约缺 `get_last_dir`/`save_last_dir`）

### Requirement: 功能验收核验

复核 SHALL 逐一核验 5 项子变更 spec 的验收标准。

#### Scenario: 逐项验收

- **WHEN** 复核
- **THEN** 每项子变更的验收场景被核验：README 文案 v2、文件名字段置顶、歌词框高度、候选折叠、左栏高度、目录记忆（Rust 读写/选择器定位/启动加载）、测试分离（src/ 零 #[cfg(test)]）

### Requirement: 工程门禁

复核 SHALL 校验工程门禁全绿：`cargo test`、`cargo clippy`、`npm run test`、`npm run build`。

#### Scenario: 全绿

- **WHEN** 复核执行验证
- **THEN** 四道门禁全绿，`src/` 生产代码零 `#[cfg(test)]`、无 `test_util` 残留

### Requirement: 无回归核验

复核 SHALL 校验无回归：字段顺序、歌词高度、搜索/保存语义、dirty 拦截不受影响。

#### Scenario: 无回归

- **WHEN** 复核既有行为
- **THEN** 选中即搜、手动点选、保存全量覆盖、dirty 拦截等既有语义与改动前一致（无回归）

### Requirement: 通过/挂起判定

复核通过 SHALL 关闭 Epic Issue #86；不通过 SHALL 挂起上报、阻断 #86 关闭、不回滚已合并项。

#### Scenario: 通过关闭

- **WHEN** 四个维度全部 pass
- **THEN** 关闭 Epic Issue #86，报告含通过证据

#### Scenario: 挂起上报

- **WHEN** 任一维度不通过
- **THEN** 挂起并上报（附失败维度与证据），Epic Issue #86 保持打开，不回滚已合并项
