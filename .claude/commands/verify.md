---
description: 自动验证——cargo check/test、npm run build、openspec validate 全绿才算过
---

# 自动验证

对当前分支/变更跑完整验证，确保改动可编译、测试全绿、规格有效。

## 执行

```sh
cargo check          # Rust 类型检查
cargo test           # Rust 测试（lofty 读写、加密、压缩等）
npm run build        # 前端构建（Vite + TS）
openspec validate <name>   # 变更的 specs/design/tasks 有效性（有变更名时）
```

## 顺序与短路

1. `cargo check` → 失败立即停，修复后重跑
2. `cargo test` → 有失败列出具体失败测试，修复后重跑
3. `npm run build` → TS 编译错误立即停
4. `openspec validate` → 有变更名时校验 artifacts

## 输出

```
## 验证结果：<change-name>

✅ cargo check      通过
✅ cargo test       通过（N tests passed）
✅ npm run build    通过
✅ openspec validate 通过

结论：全部通过，可进入合并。
```

任一失败，如实报告失败输出，不粉饰、不假报全绿。

## Guardrails

- 所有步骤必须真实执行，不允许「看起来能过就跳过」。
- 失败不修复不进入下一步。
