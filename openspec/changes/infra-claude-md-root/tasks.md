# infra-claude-md-root 任务清单

> 域：docs；无依赖。单文件新增（根级 `CLAUDE.md`），顺序执行：先写 → 校对 → 验证。不做代码改动，不触碰 `.claude/` 与 `docs/`。

## 1. 建根级 CLAUDE.md（design.md D1/D3）

- [ ] 1.1 创建 `/Users/xian/Project/music/MusicTag/CLAUDE.md`，章节完整（与 `.claude/CLAUDE.md` 对齐以便对照维护）：
  - [ ] 项目是什么：一次一首补全本地 FLAC/MP3 元数据；工具线 · 自用 · 纯本地；目标播放器自研 + Slat Player；无批量（V2）/无在线曲库/无账号
  - [ ] 定稿规格（最终权威）：`docs/V1-PRD.md` + `docs/design/design.md` + 记忆 `music-tag-v1-spec.md`；改产品行为先同步文档再改代码
  - [ ] V1 关键约束（已拍板，勿违反）九条全量：一次一首 / 选中即搜 / 结果不自动写盘 / 保存=表单全量覆盖 / 直接写盘 / MP3 统一写 ID3v2.4（勿用 `use_id3v23`）/ 坏标签只读 / 保存失败保留可重试 / 离线降级
  - [ ] 技术栈：Tauri 2 + Rust；Vue 3 + Vite + TS（`<script setup>`、单 store 不用 Pinia）；lofty（ID3v2.4 / Vorbis `LYRICS`/`PICTURE` / USLT/APIC）；`image`/`walkdir`/`rfd`/`reqwest`+`serde_json`/`tokio`/`aes`+`cbc`+`rsa`+`rand`（网易云加密）；封面 base64 data URL 跨 IPC
  - [ ] 常用命令：前端 `npm run dev`/`build`/`tauri dev`/`tauri build`；后端 `cargo check`/`test`/`clippy`/`fmt`
  - [ ] 规格与变更管理（OpenSpec）：`openspec/` 根目录、`/opsx:explore`/`propose`/`apply`/`sync`/`archive`、变更在 `openspec/changes/<name>/`、拍板决策变更须同步 docs
  - [ ] 开发流水线：`pipe` 总入口（前置校验→架构→开发→测试→CR→验证→归档→PR→合并）；`/pipe:init`/`/pipe:epic`/`/pipe:epic:status`；`/cr`/`/verify`；唯一强制确认点=PRD 批准
  - [ ] 多 Agent 协作：7 角色（Leader/Architect/Rust-Dev/Vue-Dev/CR/Verify/Tester）、Workflow 脚本 `.claude/workflows/music-tag-run.js`、CR 只读中转、三轮挂起
  - [ ] GitHub：远程 `git@github.com:zsxink/MusicTag.git`、Issue 驱动（变更前必建）、PR `--base main`、`gh` 白名单
  - [ ] Git 约定：每变更一分支、不在 main 直接开发、增量提交 `feat(<name>): ...`、归档在 PR 前、CI 门禁、push + `gh pr create/merge --squash`、合并后 `git branch -d`
  - [ ] 工作流约定：CodeGraph 优先（暂未建索引）、subagent 重度委派、新功能走 `pipe`、`superpowers:systematic-debugging`、测试驱动、CR 对照规格
  - [ ] 语言与沟通：UI 文案中文、与用户沟通默认中文

## 2. 一致性校对（design.md D5）

- [ ] 2.1 三向对照 V1 关键约束：根级 `CLAUDE.md` ↔ `docs/V1-PRD.md`（§3 功能需求 / §5 标签写入 / §8 验收标准）↔ `.claude/CLAUDE.md`，九条逐条一致
- [ ] 2.2 三向对照技术栈与命令：根级 `CLAUDE.md` ↔ `docs/design/design.md` §10 ↔ `.claude/CLAUDE.md`，无矛盾
- [ ] 2.3 对照 OpenSpec/pipe/GitHub/Git 流程章节 ↔ `.claude/CLAUDE.md`，无矛盾
- [ ] 2.4 确认根级 `CLAUDE.md` 未含 specs 之外新增的产品行为决策；发现矛盾 → 以定稿 docs 为准修订根级文档（不改 `.claude/`）

## 3. 验证（design.md D6）

- [ ] 3.1 文件存在性与可加载性：`/Users/xian/Project/music/MusicTag/CLAUDE.md` 存在、为有效 Markdown、无 frontmatter 冲突（无需 frontmatter）
- [ ] 3.2 仓库卫生：`git status` 确认仅新增根级 `CLAUDE.md` + 本变更 OpenSpec artifacts；`.claude/CLAUDE.md`、`docs/` 未被触碰（spec「不修改 .claude/ 下既有文件」）
- [ ] 3.3 提交 PR 前核对本变更相关 Issue：分支提交 `feat(50): ...`、PR 描述 `Closes #50`、基分支 `main`
