---
description: 验证项目可构建：cargo check + npm run build
---

运行完整的构建验证，确保改动没有破坏编译：

1. 后端：`cargo check`（或 `cargo clippy` 若需 lint）
2. 前端：`npm run build`
3. 若任一失败，如实报告错误输出，不要粉饰；定位并修复后重跑。

结束后给出简明结论：哪一侧通过、哪一侧失败、下一步建议。
