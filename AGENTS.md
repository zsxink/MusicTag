# MusicTag — 项目约定与 pipe 入口（Codex 项目级指令）

> 本文件是**跨模型项目约定 + pipe 流水线入口触发方式**（P5 落地闭环）。只放入口指针与项目约定，不承载角色文案——角色文案单一来源在 `.agents/tools/pipe-core/roles/`。

## 项目是什么

MusicTag 是一个跨平台桌面应用：**一次一首**地给本地裸 FLAC/MP3 补全元数据（歌名、作者、专辑、封面、歌词）。Tauri 2 + Rust 外壳、Vue 3 + Vite + TypeScript 前端、`lofty` 标签读写。工具线 · 自用 · 纯本地取向。

## 权威文档

- `docs/V1-PRD.md` —— 产品需求文档（含验收标准），产品行为最终权威
- `docs/design/design.md` —— 技术设计（Tauri command 契约 §10、前端结构）
- 变更规格在 `openspec/changes/<name>/`（proposal → specs → design → tasks）

改产品行为：**先同步上面两份文档，再改代码**。

## V1 关键约束（已拍板，勿违反）

- 一次一首：无批量编辑
- 选中即搜：选中那一刻仅对缺失的歌词/封面自动联网搜索（网易云+QQ+咪咕并发聚合）；已有则不搜
- 结果不自动写盘：候选列表展示、手动点选才填入；切歌即弃
- 保存 = 表单全量覆盖：填了就存、不填即清空删除；无空字段保护
- 直接写盘：无备份、无撤销；标签始终写回原路径；改名独立动作；撞名拒绝覆盖
- MP3 统一写 ID3v2.4（lofty 默认，勿用 `use_id3v23`）
- 坏标签只读：读标签失败 → 表单只读禁用，提示「标签损坏，只读」
- 保存失败：表单内容保留可重试，顶栏标「✕ 保存失败：原因」，dirty 保持 true
- 离线降级：会话内首次自动搜索全源失败 → 标记离线，后续选中不再自动搜，只留手动搜索按钮

## pipe 流水线入口（本文件核心）

任何新功能 / 行为修改 / Bug 修复，**先走 pipe 流水线**，由模型无关编排核心 `.agents/tools/pipe-core/` 驱动多 Agent（7 角色）完成「前置校验 → 架构 → 开发 → 测试 → CR → 最终验证 → 集成」。

**触发方式**（在会话说「跑 pipe <change>」即识别本入口）：

```bash
# 单变更
node .agents/tools/pipe-core/run.js <change> --driver codex

# Epic（按 dependsOn DAG 就绪集 ≤3 并行，worktree 隔离）
node .agents/tools/pipe-core/run.js --epic <epic> --driver codex

# 断点续跑（从失败/挂起节点继续）
node .agents/tools/pipe-core/run.js <change> --driver codex --resume

# 静态自检（fail-closed）
node .agents/tools/pipe-core/run.js --self-check
```

- 角色文案单一来源：`.agents/tools/pipe-core/roles/`（codex driver 拼入 prompt）。
- 节点状态落盘 `.agents/runs/<change>/state.json`（gitignore）；epic 并行状态 `.agents/runs/<epic>/epic-state.json`。
- 涉及用户决策（CR 三轮不过 / 验证反复不过 / 需求歧义）→ 退出 `suspended`（exit 3），交主会话决策后 `--resume` 续跑，流水线内不自动拍板。

## Git / Issue 约定

- **Issue 驱动**：任何变更动手前必须先建 GitHub Issue 作为锚点；PR 描述引用 `Closes #<issue>`。
- **每变更一分支**：分支名 = change 名（kebab-case），从 main 开；不在 main 上直接开发；merge PR 是回到 main 的唯一方式。
- 开发期间增量提交 `feat(<change>): <任务>`，进度可追溯、崩溃可恢复。
- 归档 `/opsx:archive` 在提交 PR 前执行：规格改动进分支，与代码一起进 PR。

## 常用命令

```sh
npm run tauri dev       # 起 Tauri 开发窗口
npm run build           # 前端构建
npm run test            # 前端测试
cargo check --manifest-path src-tauri/Cargo.toml   # 后端类型检查
cargo test --manifest-path src-tauri/Cargo.toml    # 后端测试
node --test .agents/tools/pipe-core/test/*.test.js   # 编排核心单测（glob，目录形式在 Node ≥22 会失败）
npx openspec validate <change> --strict --no-interactive
```

## 语言

- 代码标识符、注释遵循周围既有风格；UI 文案用中文；与用户沟通默认中文。
- 报告结果如实：失败/挂起就停，不粉饰、不假报全绿。
