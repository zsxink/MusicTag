# 任务（规格同步 + 结构守卫）

## G1 三处 command 契约同步

- [ ] 1.1 `docs/V1-PRD.md §7`：补 `get_last_dir`/`save_last_dir` 两行（文件类 command 末尾）
- [ ] 1.2 记忆 `music-tag-v1-spec.md`：command 契约清单补 `pick_folder`/`get_last_dir`/`save_last_dir`
- [ ] 1.3 `openspec/config.yaml`：context command 清单补 `get_last_dir`/`save_last_dir`，修正「与 lib.rs 实际注册一致」表述

## G2 结构守卫

- [ ] 2.1 新增 `src/styles/command-contract.test.ts`：读 lib.rs 提取 generate_handler 注册集；读 design.md §10.3/PRD §7/config.yaml 提取契约集；断言四集相等；缺口红并列缺项
- [ ] 2.2 `npm run test` 全绿（守卫过 + 无回归）

## G3 提交

- [ ] 3.1 提交：`git commit -m "feat(103): command 契约对齐——PRD §7/记忆/config.yaml 补 get_last_dir/save_last_dir/pick_folder + 一致性守卫"`（分支 command-contract-sync，PR Closes #103）
- [ ] 3.2 合并后重跑 GATE #92 复核 → 关闭 Epic #86
