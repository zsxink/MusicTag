# infra-claude-md-root 增量规格

## ADDED Requirements

### Requirement: 根级 CLAUDE.md 存在且可被 Claude Code 加载

仓库根 SHALL 存在 `CLAUDE.md`，且为 Claude Code 根级自动加载的 Markdown 规则文件（`/Users/xian/Project/music/MusicTag/CLAUDE.md`）。

#### Scenario: 文件存在

- **WHEN** 检查仓库根目录
- **THEN** `CLAUDE.md` 存在于仓库根，且为有效 Markdown 文本

#### Scenario: Claude Code 可加载

- **WHEN** Claude Code 从仓库根进入项目（或任意子目录向上探测到根）
- **THEN** 根级 `CLAUDE.md` 作为项目规则自动加载，无需 `.claude/` 目录存在

### Requirement: 内容与定稿 specs 一致无矛盾

根级 `CLAUDE.md` 中的项目规则 SHALL 与定稿规格（`docs/V1-PRD.md`、`docs/design/design.md`）一致，V1 关键约束与技术方案转述无矛盾、无新增擅自决策。

#### Scenario: 关键约束逐条对齐

- **WHEN** 对照 `docs/V1-PRD.md`（§1–§5、§8 验收标准）与 `docs/design/design.md`（§10 前端架构、Tauri command 契约）逐条核查根级 `CLAUDE.md` 的「V1 关键约束」章节
- **THEN** 以下约束全部转述一致：一次一首、选中即搜（仅缺失的歌词/封面自动搜索、已有不搜）、结果不自动写盘（候选手动点选）、保存=表单全量覆盖（空字段即清空删除）、直接写盘（写回原路径、无备份撤销）、MP3 统一写 ID3v2.4（勿用 `use_id3v23`）、坏标签只读、保存失败保留可重试（绝不假报已保存）、离线降级

#### Scenario: 技术栈与契约对齐

- **WHEN** 对照定稿设计核查技术栈与命令章节
- **THEN** 技术栈（Tauri 2 + Rust / Vue 3 + Vite + TS / lofty 标签读写 / base64 data URL 跨 IPC 封面）、常用命令、OpenSpec 变更管理与 `pipe` 流水线的描述与 specs 无矛盾

#### Scenario: 无新增产品决策

- **WHEN** 核查根级 `CLAUDE.md` 涉及产品行为的描述
- **THEN** 不含 specs 之外新增的产品约束/行为决策；涉及规格差异时以定稿 docs 为最终权威

### Requirement: 规范化后与 .claude/CLAUDE.md 口径一致

根级 `CLAUDE.md` SHALL 与现有 `.claude/CLAUDE.md` 的项目规则口径一致，不引入互相矛盾的内容。

#### Scenario: 二处规则不矛盾

- **WHEN** 对比根级 `CLAUDE.md` 与 `.claude/CLAUDE.md` 的对应章节（项目简介、V1 约束、技术栈、命令、OpenSpec/pipe、GitHub、Git 约定、语言）
- **THEN** 二处表述相互印证、无冲突；根级文档可作为独立入口使用

#### Scenario: 规则更新需同步

- **WHEN** 未来任一文档中的项目规则被修改
- **THEN** 另一处文档同步更新，保持口径一致（本变更仅要求当前状态一致，不强制后续自动同步机制）

### Requirement: 不修改 .claude/ 下既有文件

本变更 SHALL 只新增根级 `CLAUDE.md`，不改动 `.claude/` 目录下任何既有文件。

#### Scenario: .claude/CLAUDE.md 原样保留

- **WHEN** 检查 `.claude/CLAUDE.md` 在变更前后的内容
- **THEN** 该文件内容与变更前完全一致，未被本变更增删改

#### Scenario: 变更文件面最小

- **WHEN** 检查本变更的提交文件清单
- **THEN** 仅新增仓库根 `CLAUDE.md`（外加 OpenSpec 变更生命周期 artifacts），不含 `.claude/` 内文件的修改
