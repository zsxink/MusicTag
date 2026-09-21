# Pipe

Run the shared workflow core with the OpenCode runtime adapter:

```sh
node .agents/tools/pipe-core/run.js "$1" --driver opencode
```

Use `--resume` for a failed or suspended run. The core owns state, DAG,
permissions, validation, and integration; this command is only an entry shell.
