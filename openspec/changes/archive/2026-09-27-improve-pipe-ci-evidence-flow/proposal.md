# Proposal: 改进 pipe 验证与恢复

## GitHub Issue
GitHub Issue: #136

## Why
Issue #128 的 pipe 在集成阶段连续发现 OpenSpec 全量校验不一致、Rust fixture 依赖未安装等问题；恢复时还需要手工构造大型 checkpoint JSON，`status` 输出包含完整 manifest。现有规范也没有说明 CR 通过后，新的 CI 失败如何进入有界复审。

## What Changes
- 让 Verify 与仓库 CI 的 OpenSpec 和构建/测试命令保持一致，并要求设计和测试阶段识别外部测试依赖、检查 fixture 场景与有效性。
- 明确 CR 通过后出现集成期 CI 修复时，追加的定向只读复审如何记录，避免把新范围误计为同一修复循环的第四轮。
- 为 progress CLI 增加 checkpoint JSON 文件输入和紧凑状态视图，降低手工录入和恢复时读取 manifest 的成本。

## Impact
- Affected specs: `pipe-native`
- Affected code: `.agents/skills/pipe/WORKFLOW.md`, `.agents/skills/pipe/SKILL.md`, `.agents/tools/pipe-native/progress-cli.js`, `.agents/tools/pipe-native/progress.js`
- No product runtime behavior changes.
