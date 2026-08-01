---
description: 跑后端 Rust 测试（cargo test）
---

运行 `cargo test`，报告：

- 每个测试的通过/失败结果
- 若失败：附上失败输出（具体断言、栈位置），然后走 superpowers:systematic-debugging 流程定位修复，修复后重跑直到全绿。

如调用时带参数（例如 `/test <filter>`），把 filter 传给 `cargo test <filter>`。
