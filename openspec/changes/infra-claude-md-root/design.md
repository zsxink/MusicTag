# infra-claude-md-root 技术设计

## Context

Claude Code 会自动加载仓库根的 `CLAUDE.md`（以及 `.claude/CLAUDE.md`）作为项目规则。当前项目只有 `.claude/CLAUDE.md`，内容完整但仅存于一处。本变更（Epic「项目基建初始化」子变更 #50，域 docs，无依赖）在仓库根新增一份规范化 `CLAUDE.md`，作为第二入口，与定稿 specs 及 `.claude/CLAUDE.md` 保持一致。

「规范化」在此的含义：以定稿 specs（`docs/V1-PRD.md`、`docs/design/design.md`）为唯一事实来源，将已存在的 `.claude/CLAUDE.md` 内容转述为根级版本——不新增产品决策、不改变任何行为，只让规则在多入口下统一、可追溯。

## Goals / Non-Goals

**Goals**
- 仓库根存在 `CLAUDE.md`，可被 Claude Code 根级自动加载（新会话/子 Agent 无需 `.claude/` 即可对齐规则）。
- 根级 `CLAUDE.md` 覆盖关键章节：项目简介、V1 关键约束、技术栈、常用命令、OpenSpec/pipe 变更管理、GitHub（Issue 驱动）、Git 约定、工作流约定、语言（中文）。
- 与定稿 specs 一致、与 `.claude/CLAUDE.md` 口径一致、零矛盾。

**Non-Goals**
- 不改动 `.claude/CLAUDE.md` 及 `.claude/` 下任何文件。
- 不改产品行为、不改 `src-tauri/` 或 `src/` 代码、不改 `docs/` 定稿文档。
- 不引入二处规则自动同步机制（本变更只保证当前状态一致；同步靠后续变更纪律）。
- 不把 `.claude/CLAUDE.md` 合并/删除（保留既有入口，改动面最小化）。

## Decisions

### D1 根级 `CLAUDE.md` 为独立文件、覆盖既有规则

新建 `/Users/xian/Project/music/MusicTag/CLAUDE.md`，作为完整可独立使用的规则文件（不是对 `.claude/CLAUDE.md` 的引用/软链）。内容为规范化转述版，章节顺序对齐 `.claude/CLAUDE.md` 以利对照维护。

### D2 内容以定稿 specs 为唯一事实来源

「V1 关键约束」「技术栈」「常用命令」等章节逐条转述自：
- `docs/V1-PRD.md`：§1 产品概述、§3 功能需求（FR-4 歌词行为 / FR-8 自动搜索）、§5 标签写入规格、§8 验收标准；
- `docs/design/design.md`：§10 前端架构（10.0 目录分层、10.2 单 store、10.3 Tauri command 契约）。

转述原则：只表述 specs 已拍板内容，不新增、不解释歧义；specs 之间如有措辞差异，以定稿 docs 为最终权威。

### D3 根级版本的关键章节清单

根级 `CLAUDE.md` 包含以下章节（与任务清单 1.x 对应）：
1. 项目是什么——一次一首补全本地 FLAC/MP3 元数据；工具线 · 自用 · 纯本地；目标播放器自研 + Slat Player；无批量/无在线曲库/无账号。
2. 定稿规格（最终权威）——`docs/V1-PRD.md`、`docs/design/design.md`、记忆 `music-tag-v1-spec.md`；新增/修改产品行为先同步文档再改代码。
3. V1 关键约束（已拍板，勿违反）——一次一首、选中即搜、结果不自动写盘、保存=表单全量覆盖、直接写盘、MP3 统一写 ID3v2.4、坏标签只读、保存失败保留可重试、离线降级（九条全量转述）。
4. 技术栈——Tauri 2 + Rust；Vue 3 + Vite + TS（`<script setup>`、单 store 不用 Pinia）；lofty（ID3v2.4 / Vorbis `LYRICS`/`PICTURE` / USLT/APIC）；`image`/`walkdir`/`rfd`/`reqwest`+`serde_json`/`tokio`/`aes`+`cbc`+`rsa`+`rand`；封面 base64 data URL 跨 IPC。
5. 常用命令——前端 `npm run dev`/`build`/`tauri dev`/`tauri build`；后端 `cargo check`/`test`/`clippy`/`fmt`。
6. 规格与变更管理（OpenSpec）——`openspec/` 根、`/opsx:explore`/`propose`/`apply`/`sync`/`archive`、变更在 `openspec/changes/<name>/`、拍板决策变更须同步 docs。
7. 开发流水线——`pipe` 总入口；`/pipe:init`/`/pipe:epic`/`/pipe:epic:status` Epic 拆分；`/cr`/`/verify` 分步；唯一强制确认点=PRD 批准。
8. 多 Agent 协作——7 角色（Leader/Architect/Rust-Dev/Vue-Dev/CR/Verify/Tester）、Workflow 脚本、CR 只读中转、三轮挂起。
9. GitHub——远程 `git@github.com:zsxink/MusicTag.git`、Issue 驱动（变更前必建）、PR `--base main`、`gh` 白名单。
10. Git 约定——每变更一分支、不在 main 直接开发、增量提交、归档在 PR 前、CI 门禁、push + `gh pr create/merge`。
11. 工作流约定——CodeGraph 优先（暂未建索引）、重度 subagent 委派、`pipe` 走新功能、`superpowers:systematic-debugging`、测试驱动、CR 对照规格。
12. 语言与沟通——UI 文案中文、与用户沟通默认中文。

### D4 边界：不改 `.claude/`，改动面最小

git 提交文件面仅含根级 `CLAUDE.md` + 本变更 OpenSpec artifacts（proposal/spec/design/tasks）。`.claude/CLAUDE.md` 保持原样，验收按 spec「不修改 .claude/ 下既有文件」场景核查。

### D5 一致性校对方法

实现完成后逐条对照：
- 根级 `CLAUDE.md` 的九条 V1 约束 ↔ `docs/V1-PRD.md` §3/§5/§8 ↔ `.claude/CLAUDE.md`「V1 关键约束」；
- 技术栈与命令 ↔ `docs/design/design.md` §10 ↔ `.claude/CLAUDE.md`；
- OpenSpec/pipe/GitHub/Git 流程 ↔ `.claude/CLAUDE.md` 对应章节（项目既有约定，已由记忆 `music-tag-v1-spec.md` 背书）。

任一对照发现矛盾 → 以定稿 docs 为准修订根级文档（不改 `.claude/`）。

### D6 验证方式

- 文件存在性 + Claude Code 可加载性：根级 `CLAUDE.md` 存在、为 Markdown、无 YAML frontmatter 冲突（无需 frontmatter）。
- 一致性：人工/只读 diff 校对（D5 三向对照）；无自动化测试（纯文档变更，域 docs）。
- 仓库卫生：`git status` 确认未触碰 `.claude/` 与 `docs/`。

## Risks / Trade-offs

- **二处规则漂移（最大风险）**：根级与 `.claude/` 并存，未来改一处忘另一处会口径分裂。缓解：本变更即要求二者一致；D5 提供三向对照基线；后续规则变更纪律（改行为先同步 docs + 两处 CLAUDE.md）。
- **根级 vs `.claude/` 自动加载优先级差异**：Claude Code 对两处都加载，内容重复但不冲突即可；本变更保证口径一致，避免不同入口给 Agent 不同指令。
- **内容冗余**：两份文件内容相近，维护成本略增。权衡：独立根级文件可完整自足（子 Agent/外部工具无需 `.claude/`），换取低耦合、改动面最小（不动既有文件）。
- **无自动化保障**：纯文档变更不引入测试。缓解：验证环节用只读 diff 校对 + `git status` 卫生检查。

## 任务拆分建议

单文件新增（域 docs），无前后端代码，无依赖顺序并行问题。建议**单 Agent 一次完成**（顺序执行，无分组依赖）：

1. **建根级 `CLAUDE.md`**（对应 D1/D3）：按章节清单撰写完整规范内容，V1 关键约束九条逐条转述。
2. **一致性校对**（对应 D5）：三向对照定稿 specs + `.claude/CLAUDE.md`，修正矛盾。
3. **验证**（对应 D6）：存在性/可加载性检查 + `git status` 卫生确认（不触碰 `.claude/` 与 `docs/`）。

任务间为顺序依赖（先写后校对再验证）；无跨域阻塞，无需多 Agent 并行。
