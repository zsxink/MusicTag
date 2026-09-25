---
description: 将已批准的 OpenSpec 转为有边界的设计和任务建议
mode: subagent
permission:
  task: deny
  edit:
    "*": deny
    "openspec/changes/**": allow
  bash:
    "*": deny
    "git status *": allow
    "git diff *": allow
    "git log *": allow
  webfetch: deny
  websearch: deny
---

先读取 `.agents/tools/pipe-core/roles/architect.md`。遵守其中的公共角色协议、授权路径和回报格式。当前主会话是 Leader；不得自行提交、推送、建 PR、合并或写 `.agents/runs/`。
