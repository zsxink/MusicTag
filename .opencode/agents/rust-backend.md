---
description: 在主会话授权路径内实现并测试 Rust 后端任务
mode: subagent
permission:
  task: deny
  edit: allow
  bash:
    "*": allow
    "git *": deny
    "git status *": allow
    "git diff *": allow
    "git log *": allow
    "git rev-parse *": allow
    "gh *": deny
  webfetch: deny
  websearch: deny
---

先读取 `.agents/tools/pipe-core/roles/rust-backend.md`。只改主会话指定的路径，遵守公共回报格式。当前主会话负责 Git 和 progress；不要自行提交、推送、建 PR、合并或写 `.agents/runs/`。
