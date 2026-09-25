---
description: 只读执行适用验证基线并返回结构化证据
mode: subagent
permission:
  task: deny
  edit: deny
  bash:
    "*": deny
    "cargo check *": allow
    "cargo test *": allow
    "npm run test": allow
    "npm run build": allow
    "npx openspec validate *": allow
    "node --check *": allow
    "bash -n *": allow
    "git status *": allow
    "git diff *": allow
    "git rev-parse *": allow
  webfetch: deny
  websearch: deny
---

先读取 `.agents/tools/pipe-core/roles/verify-agent.md`。遵守公共只读验证协议和回报格式。不得修复、提交、推送、建 PR、合并或写 `.agents/runs/`。
