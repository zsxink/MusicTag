# infra-claude-md-root 任务清单

> 域：docs；无依赖。单文件新增（根级 `CLAUDE.md` 总览版），顺序执行：先写 → 校对 → 验证。不做代码改动，不触碰 `.claude/` 与 `docs/`。

## 1. 建根级 CLAUDE.md（总览/索引版，design.md D1/D3）

- [ ] 1.1 创建 `/Users/xian/Project/music/MusicTag/CLAUDE.md`，**总览式**章节（精要 + 指针，不复制 `.claude/CLAUDE.md` 全量）：
  - [ ] 项目是什么：一次一首补全本地 FLAC/MP3 元数据；工具线 · 自用 · 纯本地；目标播放器自研 + Slat Player；无批量（V2）/无在线曲库/无账号
  - [ ] 文档入口（权威）：`docs/V1-PRD.md`（产品需求）+ `docs/design/design.md`（技术设计）+ 记忆 `music-tag-v1-spec.md`；改产品行为先同步文档再改代码
  - [ ] V1 关键约束（精要九条一行）：一次一首 / 选中即搜 / 结果不自动写盘 / 保存=表单全量覆盖 / 直接写盘 / MP3 统一写 ID3v2.4（勿用 `use_id3v23`）/ 坏标签只读 / 保存失败保留可重试 / 离线降级
  - [ ] 技术栈（精要）：Tauri 2 + Rust；Vue 3 + Vite + TS（`<script setup>`、单 store）；lofty（ID3v2.4 / Vorbis / USLT-APIC）
  - [ ] 规则详情入口：**指向 `.claude/CLAUDE.md`**——常用命令、OpenSpec/pipe 变更管理、GitHub/Git 约定、工作流约定、语言、7 角色协作的全量细节都在那里
  - [ ] 快速上手：3 条命令（`npm run tauri dev` / `cargo test --manifest-path src-tauri/Cargo.toml` / `npm run build`）+ 文档入口链接

## 2. 一致性校对（design.md D5）

- [ ] 2.1 分层对照 V1 约束精要：根级 `CLAUDE.md` 九条一行 ↔ `.claude/CLAUDE.md`「V1 关键约束」详细 ↔ `docs/V1-PRD.md`（§3 功能需求 / §5 标签写入 / §8 验收标准），精要为详情的正确浓缩
- [ ] 2.2 分层对照技术栈精要：根级 `CLAUDE.md` ↔ `docs/design/design.md` §10 ↔ `.claude/CLAUDE.md`，无矛盾
- [ ] 2.3 指针路径核查：根级 `CLAUDE.md` 中列出的 `.claude/CLAUDE.md`、`docs/V1-PRD.md`、`docs/design/design.md` 真实存在
- [ ] 2.4 确认根级 `CLAUDE.md` 未含 specs 之外新增的产品行为决策、未整段复制 `.claude/CLAUDE.md` 全文；发现矛盾 → 以定稿 docs 为准修订根级文档（不改 `.claude/`）

## 3. 验证（design.md D6）

- [ ] 3.1 文件存在性与可加载性：`/Users/xian/Project/music/MusicTag/CLAUDE.md` 存在、为有效 Markdown、无 frontmatter 冲突（无需 frontmatter）
- [ ] 3.2 仓库卫生：`git status` 确认仅新增根级 `CLAUDE.md` + 本变更 OpenSpec artifacts；`.claude/CLAUDE.md`、`docs/` 未被触碰（spec「不修改 .claude/ 下既有文件」）
- [ ] 3.3 提交 PR 前核对本变更相关 Issue：分支提交 `feat(50): ...`、PR 描述 `Closes #50`、基分支 `main`
