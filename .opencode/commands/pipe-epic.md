# Pipe Epic

```sh
node .agents/tools/pipe-core/run.js --epic "$1" --driver opencode
```

The core schedules ready `dependsOn` items in batches of at most three, each
inside an isolated worktree.
