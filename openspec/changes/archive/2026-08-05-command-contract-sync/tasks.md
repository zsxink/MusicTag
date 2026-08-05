# 任务（结构守卫 + 三处契约同步）

> 域 = frontend（唯一代码产物是前端 vitest 结构守卫；三处文档同步非 Rust 代码）。测试先行：先写守卫跑红自证，再同步转绿。
> **依赖顺序**：G1 → G2 → G3 严格串行——G1 守卫先写（红，自证能抓 PRD/config 缺 `get_last_dir`/`save_last_dir`）；G2 文档同步依赖 G1 报错清单（同步后转绿）；G3 提交依赖 G2 全绿。纯前端串行，无 Rust 前置，无需 worktree/并行。

## G1 结构守卫（先写，红）

- [ ] 1.1 新增 `src/styles/command-contract.test.ts`（`// @vitest-environment node` + `node:fs`）：
  - lib.rs 真值集：正则 `/commands::([a-z_]+)::([a-z_]+)/g` → 第 2 组，去重应恰 13
  - design §10.3：切片「### 10.3 Tauri command 契约」→「### 10.4」，正则 `/^\| `([a-z_]+)\(/gm`
  - PRD §7：切片「**Tauri command 全量**」→「> - 前端只管展示」，正则 ``/`([a-z_]+)\(/g``（必须切片，防 §308 正文误中）
  - config.yaml：含「Tauri command 契约」行，正则 `/：([a-z_]+(?:\/[a-z_]+)+)/` → split(`/`)
  - 断言四集相等；失败消息列各源缺/多余 command；各源 count===13 防正则退化
  - **签名层 spot-check**：从 `commands/*.rs` 定义文件提取真值签名，无参 command（`pick_folder`/`pick_cover_file`/`get_last_dir`）须在三源契约表写成 `` `name()` ``（无参）；防「仅名称一致、签名漂移」漏检
- [ ] 1.2 `npm run test`：守卫**预期红**——PRD §7 / config.yaml 报缺 `get_last_dir`/`save_last_dir`（自证守卫可抓本缺陷类别）；design §10.3 绿

## G2 三处契约同步（守卫转绿）

- [ ] 2.1 `docs/V1-PRD.md §7`：文件组补 `get_last_dir() -> Option<String>`（**无参**，tester 实测真值 folder.rs:29 无参）、`save_last_dir(dir) -> ()` 两行（文件类 command 末尾）
- [ ] 2.2 记忆 `music-tag-v1-spec.md`：command 契约清单补 `pick_folder`/`get_last_dir`/`save_last_dir`（仓库外，守卫不覆盖；手动 + GATE #92 复核兜底）
- [ ] 2.3 `openspec/config.yaml`：slash 清单补 `get_last_dir`/`save_last_dir`；修正「与 lib.rs 实际注册一致」表述为 13 个真实注册
- [ ] 2.4 `docs/design/design.md §10.4`：结构守卫清单补 `command-contract.test.ts`
- [ ] 2.5 `npm run test` 全绿（守卫绿 + 无回归）；`npm run build` 通过（vue-tsc 含新测试文件）

## G3 提交与收尾

- [ ] 3.1 提交：`git commit -m "feat(103): command 契约对齐——PRD §7/记忆/config.yaml 补 get_last_dir/save_last_dir/pick_folder + 一致性守卫"`（分支 command-contract-sync，PR Closes #103）
- [ ] 3.2 合并后重跑 GATE #92 复核 → 关闭 Epic #86
