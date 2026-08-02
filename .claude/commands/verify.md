---
description: 自动验证——派 verify-agent subagent 跑 cargo check/test、npm run build、openspec validate 全绿才算过
---

# 自动验证

对当前分支/变更跑完整验证，确保改动可编译、测试全绿、规格有效。**由 `verify-agent` subagent 执行**，主会话不直接跑命令。

## 执行（派 verify-agent）

用 Agent 工具派 **`verify-agent`** 角色（`subagent_type: 'verify-agent'`，只读），让它执行：

```sh
cargo check --manifest-path src-tauri/Cargo.toml  # Rust 类型检查
cargo test --manifest-path src-tauri/Cargo.toml   # Rust 测试（lofty 读写、加密、压缩等）
npm run build        # 前端构建（Vite + TS）
openspec validate <name>   # 变更的 specs/design/tasks 有效性（有变更名时）
```

## verify-agent 的判定规则（写进 prompt）

1. `cargo check --manifest-path src-tauri/Cargo.toml` → 失败立即报告，不继续
2. `cargo test --manifest-path src-tauri/Cargo.toml` → 有失败列出具体失败测试
3. `npm run build` → TS 编译错误立即报告
4. `openspec validate` → 有变更名时校验 artifacts

## 输出（verify-agent 返回）

```
## 验证结果：<change-name>

✅ cargo check      通过
✅ cargo test       通过（N tests passed）
✅ npm run build    通过
✅ openspec validate 通过

结论：全部通过，可进入合并。
```

任一失败，如实报告失败输出，不粉饰、不假报全绿。verify-agent **只验证不修复**——失败时报告给主会话，由开发角色修复后重跑。

## Guardrails

- 验证必须由 `verify-agent` subagent 执行，主会话不直接跑 cargo/npm/openspec 命令。
- 所有步骤必须真实执行，不允许「看起来能过就跳过」。
- 失败不修复不进入下一步；verify-agent 只报告、不修。
