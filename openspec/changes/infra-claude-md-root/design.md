# infra-claude-md-root 技术设计

## Context

Claude Code 会自动加载仓库根的 `CLAUDE.md`（以及 `.claude/CLAUDE.md`）作为项目规则。当前项目只有 `.claude/CLAUDE.md`，内容详细但仅存于一处。本变更（Epic「项目基建初始化」子变更 #50，域 docs，无依赖）在仓库根新增一份**分层式** `CLAUDE.md`：根级作为**总索引/总览**，与 `.claude/CLAUDE.md`（详细规则）形成层次——根级指路、`.claude/` 承载细节。

「规范化」在此的含义：以定稿 specs（`docs/V1-PRD.md`、`docs/design/design.md`）为唯一事实来源，将已存在的 `.claude/CLAUDE.md` 内容组织成根级**总览版**——不新增产品决策、不改变任何行为、不与 `.claude/` 重复全量细节，只让两层规则多入口下统一、可追溯。

## Goals / Non-Goals

**Goals**
- 仓库根存在 `CLAUDE.md`，可被 Claude Code 根级自动加载（新会话/子 Agent 无需 `.claude/` 即可对齐规则）。
- **层次结构**：根级 `CLAUDE.md` = **总览/索引**（项目是什么、文档入口、关键约束精要、朝向 `.claude/CLAUDE.md` 的指针），`.claude/CLAUDE.md` = **详细规则**（V1 约束与技术细节全量）。
- 根级作为「Claude 总索引」：一页看清项目定位、权威文档、规则入口；细节指向 `.claude/CLAUDE.md`（不重复全量）。
- 与定稿 specs 一致、与 `.claude/CLAUDE.md` 分层不重复、零矛盾。

**Non-Goals**
- **不做根级全量副本**：根级 `CLAUDE.md` 不重复 `.claude/CLAUDE.md` 的全部细节（V1 约束九条、命令全量、7 角色等），只做总览 + 关键精要 + 指针。
- 不改动 `.claude/CLAUDE.md` 及 `.claude/` 下任何文件（`.claude/` 保持详细规则现状）。
- 不改产品行为、不改 `src-tauri/` 或 `src/` 代码、不改 `docs/` 定稿文档。
- 不引入二处规则自动同步机制（本变更只保证当前状态一致；同步靠后续变更纪律）。

## Decisions

### D1 分层：根级 `CLAUDE.md` = 总索引，`.claude/CLAUDE.md` = 详细规则

新建 `/Users/xian/Project/music/MusicTag/CLAUDE.md`，定位为**总索引/总览**（不是 `.claude/CLAUDE.md` 的全量副本，也不是对其的软链）。两层形成层次：
- **根级 `CLAUDE.md`（总览）**：一页看清项目是什么、权威文档入口、关键约束精要、规则入口指针（`.claude/CLAUDE.md`）。
- **`.claude/CLAUDE.md`（详细）**：保持现状，承载 V1 关键约束、技术栈、命令、OpenSpec/pipe、GitHub/Git 约定等全量细节。

### D2 内容以定稿 specs 为唯一事实来源

根级 `CLAUDE.md` 的「总览/精要」逐条转述自：
- `docs/V1-PRD.md`：§1 产品概述、§3 功能需求（FR-4 歌词行为 / FR-8 自动搜索）、§5 标签写入规格、§8 验收标准；
- `docs/design/design.md`：§10 前端架构（10.0 目录分层、10.2 单 store、10.3 Tauri command 契约）。

转述原则：只表述 specs 已拍板内容，不新增、不解释歧义；specs 之间如有措辞差异，以定稿 docs 为最终权威。根级不重复 `.claude/CLAUDE.md` 的细节，但精要必须与 specs 一致。

### D3 根级版本的总览章节结构

根级 `CLAUDE.md`（总索引/总览）包含以下章节（与任务清单 1.x 对应），**精要 + 指针**，不重复 `.claude/CLAUDE.md` 全量：

1. **项目是什么**（一句话 + 链接）——一次一首补全本地 FLAC/MP3 元数据；工具线 · 自用 · 纯本地；目标播放器自研 + Slat Player；无批量（V2）/无在线曲库/无账号。
2. **文档入口（权威）**——`docs/V1-PRD.md`（产品需求）、`docs/design/design.md`（技术设计）、记忆 `music-tag-v1-spec.md`；改产品行为先同步文档再改代码。
3. **V1 关键约束（精要 + 详见 `.claude/CLAUDE.md`）**——九条约束一行一条精要（一次一首 / 选中即搜 / 结果不自动写盘 / 保存=表单全量覆盖 / 直接写盘 / MP3 统一写 ID3v2.4 / 坏标签只读 / 保存失败保留可重试 / 离线降级），每条一行，细节指向 `.claude/CLAUDE.md`。
4. **技术栈（精要）**——Tauri 2 + Rust；Vue 3 + Vite + TS；lofty（ID3v2.4 / Vorbis / USLT/APIC）；其余依赖一句话；封面 base64 data URL 跨 IPC。
5. **规则详情入口**——指向 `.claude/CLAUDE.md`：常用命令、OpenSpec/pipe 变更管理、GitHub/Git 约定、工作流约定、语言、7 角色协作的**全量细节都在那里**。
6. **快速上手**——3 条命令（`npm run tauri dev` / `cargo test --manifest-path src-tauri/Cargo.toml` / `npm run build`）+ 文档入口链接。

> 设计原则：根级回答「这是什么项目、规则在哪」；`.claude/CLAUDE.md` 回答「规则具体是什么」。两层互补，不互相复制全文。

### D4 边界：不改 `.claude/`，改动面最小

git 提交文件面仅含根级 `CLAUDE.md` + 本变更 OpenSpec artifacts（proposal/spec/design/tasks）。`.claude/CLAUDE.md` 保持原样，验收按 spec「不修改 .claude/ 下既有文件」场景核查。

### D5 一致性校对方法

实现完成后逐条对照：
- **分层一致性**：根级 `CLAUDE.md` 的总览/精要 ↔ `.claude/CLAUDE.md` 对应详细规则，确认「精要不与详细冲突、指针指向正确」；
- **规格一致性**：根级精要（V1 约束九条一行精要）↔ `docs/V1-PRD.md` §3/§5/§8 ↔ `.claude/CLAUDE.md`；
- **文档入口正确**：根级 `CLAUDE.md` 里列出的 `docs/V1-PRD.md`、`docs/design/design.md`、`.claude/CLAUDE.md` 路径真实存在。

任一对照发现矛盾 → 以定稿 docs 为准修订根级文档（不改 `.claude/`）。

### D6 验证方式

- 文件存在性 + Claude Code 可加载性：根级 `CLAUDE.md` 存在、为 Markdown、无 YAML frontmatter 冲突（无需 frontmatter）。
- 一致性：人工/只读 diff 校对（D5 三向对照）；无自动化测试（纯文档变更，域 docs）。
- 仓库卫生：`git status` 确认未触碰 `.claude/` 与 `docs/`。

## Risks / Trade-offs

- **层次漂移（最大风险）**：根级（总览）与 `.claude/`（详细）并存，未来改详细忘同步总览、或总览精要偏离规格会口径分裂。缓解：本变更即保证二者分层一致；D5 提供分层对照基线；后续规则变更纪律（改行为先同步 docs + 两层 CLAUDE.md）。
- **根级 vs `.claude/` 自动加载优先级差异**：Claude Code 对两处都加载，内容分层不冲突即可；本变更保证总览与详情一致，避免不同入口给 Agent 不同指令。
- **总览过简/过繁风险**：总览写太简则信息不足（Agent 不点进 `.claude/`），写太繁则退化为副本。权衡：根级固定「精要 + 指针」结构，用「规则详情入口」章节强制指向 `.claude/CLAUDE.md`，控制总览篇幅。
- **无自动化保障**：纯文档变更不引入测试。缓解：验证环节用只读 diff 校对 + `git status` 卫生检查。

## 任务拆分建议

单文件新增（域 docs），无前后端代码，无依赖顺序并行问题。建议**单 Agent 一次完成**（顺序执行，无分组依赖）：

1. **建根级 `CLAUDE.md`（总览/索引版）**（对应 D1/D3）：按总览章节结构撰写——项目是什么、文档入口、V1 约束精要（九条一行）、技术栈精要、规则详情入口（指向 `.claude/CLAUDE.md`）、快速上手。**不重复 `.claude/CLAUDE.md` 全量细节**。
2. **一致性校对**（对应 D5）：分层对照（根级精要 ↔ `.claude/CLAUDE.md` 详细 ↔ 定稿 specs）+ 文档入口路径核查，修正矛盾。
3. **验证**（对应 D6）：存在性/可加载性检查 + `git status` 卫生确认（不触碰 `.claude/` 与 `docs/`）。

任务间为顺序依赖（先写后校对再验证）；无跨域阻塞，无需多 Agent 并行。
