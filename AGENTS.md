# MusicTag — 项目约定与 pipe 入口（Claude Code / Codex / OpenCode）

> 本文件是跨 Agent 项目约定与 pipe 入口。公共角色规则的唯一来源是 `.agents/tools/pipe-core/roles/`；跨宿主的执行协议是 `.agents/skills/pipe/WORKFLOW.md`。

## 项目是什么

MusicTag 是一个跨平台桌面应用：一次一首地给本地裸 FLAC/MP3 补全元数据（歌名、作者、专辑、封面、歌词）。技术栈为 Tauri 2、Rust、Vue 3、Vite、TypeScript 和 `lofty`。

## 权威文档

- `docs/V1-PRD.md`：产品需求与验收标准
- `docs/design/design.md`：技术设计与 Tauri command 契约
- `openspec/changes/<name>/`：proposal、specs、design、tasks

改变产品行为前，先同步前两份文档，再修改代码。

## V1 关键约束

- 一次一首，无批量编辑。
- 选中时仅为缺失歌词或封面自动联网搜索；已有内容不搜索。
- 候选只展示，用户手动点选才填入；切歌即弃。
- 保存全量覆盖，空字段即删除。
- 直接写回原文件，无备份、无撤销；改名独立且撞名拒绝覆盖。
- MP3 写 ID3v2.4，禁止 `use_id3v23`。
- 坏标签只读；保存失败保留表单和 dirty 状态。
- 首次自动搜索全源网络失败后会话离线降级。

## pipe 流水线入口

任何新功能、行为修改或 Bug 修复先走 pipe。用户在 Codex 会话说“跑 pipe `<change>`”时，**当前主会话 Agent 就是 Leader**：读取 `.agents/skills/pipe/SKILL.md` 与 `.agents/skills/pipe/WORKFLOW.md`，执行 `bootstrap → architect → spec-gate → dev → tester → cr → verify → integrate`。

- 主会话用宿主的原生子 Agent 能力派发 Architect、开发、Tester、CR 和 Verify；不得通过 `node`、`codex exec`、`claude -p` 或 OpenCode CLI 启动 Agent。
- 启动或恢复时先读取 `openspec/changes/<change>/tasks.md` 与 `.agents/runs/<change>/progress.md`，再核对分支、worktree、Git HEAD/diff、提交、PR 与 CI 事实。
- 主会话是 `progress.md` 与开发阶段任务勾选的唯一写入者。子 Agent 只在授权路径写入，不能写 Git index/HEAD，也不能提交、推送、建 PR 或合并。
- 子 Agent 回报 `DONE`、`NEEDS_PARENT_DECISION` 或 `FAILED`，并附证据。主会话能依据已批准规格回答实现问题、重派和有界修复；产品范围、规格冲突、不可逆外部动作或无法判断的问题才升级给用户。宿主权限提示仍由宿主处理。
- CR 必须只读；CR 三轮仍有 blocker/major 或验证反复失败时，记录原因并挂起。不得绕过 CR、Verify 或扩大已批准规格。
- 没有能保障所需最小权限的原生子 Agent 时，停止在写入前并报告，不回退到 CLI driver。

### Epic

`/pipe:epic <epic>` 由当前主会话读取 `openspec/epics/<epic>/epic.json` 的 `dependsOn` 图。每个子变更使用独立分支、worktree 和 Markdown 进度，最多并行三个无依赖项；只有前置项已在远端合并才解锁后继项。

## Git / Issue 约定

- 动手前先建 GitHub Issue；PR 描述使用 `Closes #<issue>`。
- 每变更一条同名 kebab-case 分支，从 main 创建；不得直接在 main 开发。
- 主会话在每个 Dev/Tester checkpoint 后审计差异与授权路径，再用 `feat(<change>): <任务>` 提交。提交 SHA 写入 `progress.md`。
- Integrate 先归档变更，再提交、推送、创建或复用 PR、核对 required CI、合并并核对远端事实。merge PR 是回到 main 的唯一方式。

## 常用命令

```sh
npm run tauri dev
npm run build
npm run test
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
npx openspec validate <change> --strict --no-interactive
```

## 语言

- 代码标识符和注释遵循周围既有风格；UI 文案用中文。
- 与用户沟通默认中文；失败或挂起如实说明。
