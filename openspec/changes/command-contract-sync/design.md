# design — command-contract-sync（Tauri command 契约对齐）

> GATE #92 挂起修复变更（Issue #103）。纯规格同步 + 结构守卫，无生产代码改动。

## 技术方案

### D1. command 契约真值基准

`src-tauri/src/lib.rs` `generate_handler!` 实际注册 **13 个 command**（真值基准）：

```
pick_folder, list_songs, get_last_dir, save_last_dir, open_song,
save_song, rename_song, pick_cover_file, read_cover_path,
search_song, search_source, fetch_lyric, download_cover
```

`dir-memory`（#91）只同步了 `design.md §10.3`（13 个），PRD §7（11 个）、记忆 spec（10 个）、openspec/config.yaml（11 个）三处契约表未同步。

### D2. 三处同步内容

| 文档 | 现状 | 同步为 |
|---|---|---|
| `docs/V1-PRD.md §7` | 11 个 command | 补 `get_last_dir`/`save_last_dir`（文件类） |
| 记忆 `music-tag-v1-spec.md` | 10 个 command | 补 `pick_folder`/`get_last_dir`/`save_last_dir` |
| `openspec/config.yaml` context | 11 个 command | 补 `get_last_dir`/`save_last_dir` |

### D3. 结构守卫

新增 vitest 守卫（前端 `src/` 下，与 `design-layering.test.ts`/`layering.test.ts` 同哲学——结构断言）：
- 读 `src-tauri/src/lib.rs` 提取 `generate_handler![...]` 注册的 command 名集合（正则匹配 `commands::\w+::(\w+)`）
- 从 `docs/design/design.md §10.3` 契约表提取 command 名集合（grep 表行）
- 从 `docs/V1-PRD.md §7` 提取（grep `command 全量` 段）
- 从 `openspec/config.yaml` 提取
- 断言四处集合与 lib.rs 注册集相等；缺口 → 测试红并列出缺的 command

记忆 `music-tag-v1-spec.md` 在仓库外（`~/.claude/.../memory/`），不纳入守卫（无法在 CI 读取）；守卫覆盖仓库内三源（design/PRD/config.yaml）。

### D4. 变更域判定

纯文档 + 前端结构守卫：不触 Rust 生产代码、不触 Tauri 契约运行时、不触前端业务逻辑。域 = infra（规格一致性修复）。

## 关键决策

- **真值基准 = lib.rs 实际注册**（代码是唯一事实来源；文档跟随代码）。
- **守卫覆盖仓库内三源**：记忆 spec 在仓库外无法 CI 断言，故守卫只覆盖 design/PRD/config.yaml；记忆同步靠本次手动完成 + GATE 复核兜底。
- **不改 lib.rs**：lib.rs 已正确注册 13 command，缺的只是文档同步。

## 任务拆分

### G1 三处 command 契约同步
- [ ] 1.1 `docs/V1-PRD.md §7`：补 `get_last_dir(dir) -> Option<String>`、`save_last_dir(dir) -> ()` 两行（文件类 command 末尾）
- [ ] 1.2 记忆 `music-tag-v1-spec.md`：command 契约清单补 `pick_folder`/`get_last_dir`/`save_last_dir`
- [ ] 1.3 `openspec/config.yaml`：context command 清单补 `get_last_dir`/`save_last_dir`，并修正「与 lib.rs 实际注册一致」表述

### G2 结构守卫
- [ ] 2.1 新增 `src/styles/command-contract.test.ts`：读 lib.rs 提取 generate_handler 注册集；读 design.md §10.3/PRD §7/config.yaml 提取契约集；断言四集相等；缺口红并列缺项
- [ ] 2.2 `npm run test` 全绿（守卫过 + 无回归）

### G3 提交
- [ ] 3.1 `git commit -m "feat(103): command 契约对齐——PRD §7/记忆/config.yaml 补 get_last_dir/save_last_dir/pick_folder + 一致性守卫"`（分支 command-contract-sync，PR Closes #103）
- [ ] 3.2 合并后重跑 GATE #92 复核 → 关闭 Epic #86
