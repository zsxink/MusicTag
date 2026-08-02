---
description: 派 tester subagent 跑测试（cargo test / 冒烟 / 覆盖审计）
---

派 **`tester`** subagent 执行测试，主会话不直接跑 `cargo test`。tester 职责（写进 prompt）：

- 跑 `cargo test`，报告每个测试的通过/失败结果
- 若失败：附上失败输出（具体断言、栈位置），回到主会话走 superpowers:systematic-debugging 定位，由开发角色修复后重跑
- 对照 specs 的 scenarios 做覆盖审计，补测试

如调用时带参数（例如 `/test <filter>`），把 filter 传给 `cargo test <filter>`（由 tester 执行）。
