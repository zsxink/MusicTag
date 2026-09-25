---
schemaVersion: 1
kind: change
change: <change>
issue: <issue-number-or-null>
branch: <branch>
worktree: <absolute-worktree-path>
owner: <host:main-session-id>
updatedAt: <ISO-8601>
---

# Native pipe progress: <change>

This file is written only by the main-session Agent. `tasks.md` remains the
versioned delivery checklist; this file records runtime ownership, evidence and
the next safe action for a recovery session.

## Current checkpoint

- Phase: `<phase>`
- Next step: `<next-step>`
- Owner: `<host:main-session-id>`

## Phases

| Phase | Status | Attempt | Agent | Evidence |
| --- | --- | ---: | --- | --- |
| bootstrap | pending | 0 | — | — |
| architect | pending | 0 | — | — |
| spec-gate | pending | 0 | — | — |
| dev | pending | 0 | — | — |
| tester | pending | 0 | — | — |
| cr | pending | 0 | — | — |
| verify | pending | 0 | — | — |
| integrate | pending | 0 | — | — |

## Tasks

The main Agent records task ownership and evidence here after checking the
matching entry in `openspec/changes/<change>/tasks.md`.

## Decisions

Record an in-scope parent decision, its specification basis, and the child task
that resumes from it. Product or scope decisions remain suspended until the
user answers.

## Resume checks

On recovery, compare this file with branch, worktree, commits, source files,
OpenSpec tasks and remote PR/CI facts. A historical success is only a candidate
until its recorded evidence is verified again.

<!-- pipe-native-progress
<machine-readable JSON written by progress.js>
-->
